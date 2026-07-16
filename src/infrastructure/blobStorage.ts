// ADR-002: Azure Blob Storage für Input/Output der PDFs
// ADR-011: Blob Storage Lease für pessimistisches Locking der Output-PDF
// ADR-018: SAS URL-Erzeugung für Download-Function
import { BlobServiceClient, BlobSASPermissions } from "@azure/storage-blob";

const connectionString =
  process.env["AZURE_STORAGE_CONNECTION_STRING"] ?? "UseDevelopmentStorage=true";

function getBlobServiceClient(): BlobServiceClient {
  return BlobServiceClient.fromConnectionString(connectionString);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export async function downloadBlob(containerName: string, blobName: string): Promise<Buffer> {
  const client = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlobClient(blobName);
  const response = await client.download();
  if (!response.readableStreamBody) {
    throw new Error(`Kein Stream für Blob ${blobName} in Container ${containerName}`);
  }
  return streamToBuffer(response.readableStreamBody);
}

export async function uploadBlob(
  containerName: string,
  blobName: string,
  data: Buffer
): Promise<void> {
  const client = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlockBlobClient(blobName);
  await client.upload(data, data.length, {
    blobHTTPHeaders: { blobContentType: "application/pdf" },
  });
}

export async function blobExists(containerName: string, blobName: string): Promise<boolean> {
  const client = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlobClient(blobName);
  return client.exists();
}

// ─── ADR-010: Inkrementelle Output-PDF ───────────────────────────────────────

/**
 * Lädt einen Blob herunter. Gibt null zurück wenn der Blob nicht existiert.
 */
export async function downloadBlobIfExists(
  containerName: string,
  blobName: string
): Promise<Buffer | null> {
  const client = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlobClient(blobName);
  if (!(await client.exists())) return null;
  const response = await client.download();
  if (!response.readableStreamBody) return null;
  return streamToBuffer(response.readableStreamBody);
}

/**
 * Lädt einen Blob nur hoch wenn er noch nicht existiert (conditional put).
 * Wirft einen Fehler mit statusCode 412 wenn der Blob bereits vorhanden ist.
 */
export async function uploadBlobIfNotExists(
  containerName: string,
  blobName: string,
  data: Buffer
): Promise<void> {
  const client = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlockBlobClient(blobName);
  await client.upload(data, data.length, {
    blobHTTPHeaders: { blobContentType: "application/pdf" },
    conditions: { ifNoneMatch: "*" },
  });
}

// ─── ADR-011: Blob Lease (pessimistisches Locking) ───────────────────────────

export interface BlobLease {
  leaseId: string;
  release: () => Promise<void>;
}

/**
 * Erwirbt einen exklusiven Blob-Lease für die Output-PDF.
 * Retry-Logik bei 409 (Lease bereits vergeben) mit exponentiellem Backoff.
 * ADR-011: Lease vor Schreibzugriff, Release nach Verarbeitung.
 */
export async function acquireOutputBlobLease(
  containerName: string,
  blobName: string,
  leaseDurationSec = 30,
  maxRetries = 5,
  retryDelayMs = 500
): Promise<BlobLease> {
  const blobClient = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlobClient(blobName);
  const leaseClient = blobClient.getBlobLeaseClient();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await leaseClient.acquireLease(leaseDurationSec);
      return {
        leaseId: leaseClient.leaseId,
        release: async () => { await leaseClient.releaseLease(); },
      };
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 409) {
          if (attempt < maxRetries - 1) {
            // LeaseAlreadyPresent – warten und erneut versuchen (ADR-011)
            await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
            continue;
          }
          break; // Alle Versuche aufgebraucht → Custom-Fehler unten
        }
        throw err; // Nicht-409-Fehler sofort weiterwerfen
    }
  }
  throw new Error(
    `WARN: Blob-Lease nicht verfügbar nach ${maxRetries} Versuchen für "${blobName}"`
  );
}

/**
 * Lädt einen Blob mit aktivem Lease hoch (schreibgeschützter Exklusivzugriff).
 */
export async function uploadBlobWithLease(
  containerName: string,
  blobName: string,
  data: Buffer,
  leaseId: string
): Promise<void> {
  const client = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlockBlobClient(blobName);
  await client.upload(data, data.length, {
    blobHTTPHeaders: { blobContentType: "application/pdf" },
    conditions: { leaseId },
  });
}

// ─── ADR-018: SAS URL für Download-Function ───────────────────────────────────

/**
 * Erzeugt einen kurzlebigen, schreibgeschützten SAS-Link für einen Blob.
 * SAS-Token wird NICHT gespeichert – nur zur Laufzeit erzeugt (ADR-018).
 */
export async function createReadOnlySasUrl(
  containerName: string,
  blobName: string,
  expiresInMinutes = 5
): Promise<string> {
  const blobClient = getBlobServiceClient()
    .getContainerClient(containerName)
    .getBlobClient(blobName);
  return blobClient.generateSasUrl({
    permissions: BlobSASPermissions.from({ read: true }),
    expiresOn: new Date(Date.now() + expiresInMinutes * 60 * 1000),
  });
}
