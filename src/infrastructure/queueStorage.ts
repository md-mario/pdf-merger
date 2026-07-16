// ADR-017: Queue Storage Client für MasterPDF-Ereignisse
import { QueueServiceClient } from "@azure/storage-queue";
import { MasterPdfEvent } from "../models/masterPdfEvent";

const QUEUE_NAME = "master-pdf-events";

const connectionString =
  process.env["AZURE_STORAGE_CONNECTION_STRING"] ?? "UseDevelopmentStorage=true";

function getQueueClient() {
  return QueueServiceClient.fromConnectionString(connectionString).getQueueClient(QUEUE_NAME);
}

/**
 * Sendet ein MasterPdfUpserted-Event in die Queue.
 * Die Queue wird automatisch angelegt, falls sie noch nicht existiert.
 */
export async function sendMasterPdfEvent(event: MasterPdfEvent): Promise<void> {
  const client = getQueueClient();
  await client.createIfNotExists();
  // @azure/storage-queue kodiert Nachrichten intern als Base64
  await client.sendMessage(JSON.stringify(event));
}
