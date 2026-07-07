// ADR-002: Azure Table Storage für Metadaten
// ADR-003: ETag-basierte Optimistic Concurrency für Race-Condition-Handling
import { TableClient } from "@azure/data-tables";
import { MasterPdfRow, DetailPdfRow } from "../contracts/input";

const connectionString =
  process.env["AZURE_STORAGE_CONNECTION_STRING"] ?? "UseDevelopmentStorage=true";

function getTableClient(tableName: string): TableClient {
  return TableClient.fromConnectionString(connectionString, tableName);
}

// ─── MasterPDFs ───────────────────────────────────────────────────────────────

export async function upsertMasterPdfEntity(
  rowKey: string,
  status: MasterPdfRow["status"],
  reservationNumbers: string[],
  missingDetails: string[]
): Promise<void> {
  const client = getTableClient("MasterPDFs");
  await client.upsertEntity<MasterPdfRow>(
    {
      partitionKey: "MasterPDFs",
      rowKey,
      status,
      reservationNumbers: JSON.stringify(reservationNumbers),
      missingDetails: JSON.stringify(missingDetails),
    },
    "Merge"
  );
}

export async function getMasterPdfEntity(rowKey: string): Promise<MasterPdfRow | null> {
  const client = getTableClient("MasterPDFs");
  try {
    const entity = await client.getEntity<MasterPdfRow>("MasterPDFs", rowKey);
    return entity as MasterPdfRow;
  } catch {
    return null;
  }
}

/**
 * Entfernt eine Reservierungsnummer aus der missingDetails-Liste.
 * Verwendet ETag-basiertes Optimistic Locking mit Retry-Logik (ADR-003).
 * Gibt die aktualisierte missingDetails-Liste zurück.
 */
export async function updateMasterPdfMissingDetails(
  masterRowKey: string,
  removedReservationNumber: string,
  maxRetries = 3
): Promise<string[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const entity = await getMasterPdfEntity(masterRowKey);
    if (!entity) {
      throw new Error(`Master-Eintrag nicht gefunden: ${masterRowKey}`);
    }

    const missing: string[] = JSON.parse(entity.missingDetails);
    const updatedMissing = missing.filter((n) => n !== removedReservationNumber);
    const updatedStatus: MasterPdfRow["status"] =
      updatedMissing.length === 0 ? "completed" : "pending";

    try {
      const client = getTableClient("MasterPDFs");
      await client.updateEntity<MasterPdfRow>(
        {
          partitionKey: "MasterPDFs",
          rowKey: masterRowKey,
          status: updatedStatus,
          reservationNumbers: entity.reservationNumbers,
          missingDetails: JSON.stringify(updatedMissing),
        },
        "Replace",
        { etag: entity.etag }
      );
      return updatedMissing;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 412 && attempt < maxRetries - 1) {
        // ETag-Konflikt: anderen Request abwarten und erneut versuchen
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `ETag-Konflikt nicht auflösbar nach ${maxRetries} Versuchen für ${masterRowKey}`
  );
}

export async function listPendingMasterEntities(): Promise<MasterPdfRow[]> {
  const client = getTableClient("MasterPDFs");
  const results: MasterPdfRow[] = [];
  const entities = client.listEntities<MasterPdfRow>({
    queryOptions: {
      filter: `PartitionKey eq 'MasterPDFs' and status eq 'pending'`,
    },
  });
  for await (const entity of entities) {
    results.push(entity as MasterPdfRow);
  }
  return results;
}

// ─── DetailPDFs ───────────────────────────────────────────────────────────────

export async function upsertDetailPdfEntity(
  rowKey: string,
  status: DetailPdfRow["status"],
  matchedMaster: string
): Promise<void> {
  const client = getTableClient("DetailPDFs");
  await client.upsertEntity<DetailPdfRow>(
    {
      partitionKey: "DetailPDFs",
      rowKey,
      status,
      matchedMaster,
    },
    "Merge"
  );
}

export async function listUnmatchedDetailEntities(): Promise<DetailPdfRow[]> {
  const client = getTableClient("DetailPDFs");
  const results: DetailPdfRow[] = [];
  const entities = client.listEntities<DetailPdfRow>({
    queryOptions: {
      filter: `PartitionKey eq 'DetailPDFs' and status eq 'unmatched'`,
    },
  });
  for await (const entity of entities) {
    results.push(entity as DetailPdfRow);
  }
  return results;
}
