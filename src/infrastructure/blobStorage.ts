// ADR-002: Azure Blob Storage für Input/Output der PDFs
import { BlobServiceClient } from "@azure/storage-blob";

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
