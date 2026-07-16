// ADR-017: Queue Trigger – PostProcess für MasterPDF-Ereignisse
// Empfängt MasterPdfUpserted-Events und synchronisiert den Zustand in SharePoint.
// Fehler im PostProcess blockieren nicht die PDF-Verarbeitung (Fire-and-Forget via Queue).
// ADR-020: SharePoint-Item-ID wird in Table Storage gespeichert für direktes Update.
import { app, InvocationContext } from "@azure/functions";
import { MasterPdfEvent } from "../models/masterPdfEvent";
import { syncToSharePoint } from "../infrastructure/sharePointClient";
import { getMasterPdfEntity, saveSharePointItemId } from "../infrastructure/tableStorage";

/**
 * Verarbeitet ein MasterPdfUpserted-Event aus der Queue:
 * - Liest gespeicherte SharePoint-Item-ID aus Table Storage (ADR-020)
 * - Synchronisiert den Zustand in SharePoint (ADR-017)
 * - Speichert neu erzeugte SharePoint-Item-ID für spätere direkte Updates (ADR-020)
 */
export async function postProcessTrigger(
  event: MasterPdfEvent,
  context: InvocationContext
): Promise<void> {
  context.log(
    `postProcessTrigger: Empfangen – rowKey="${event.rowKey}" status="${event.status}" missingDetailCount=${event.missingDetailCount}`
  );

  try {
    // ADR-020: Gespeicherte SharePoint-Item-ID laden, um direktes PATCH zu ermöglichen
    const entity = await getMasterPdfEntity(event.rowKey);
    const storedItemId = entity?.sharePointItemId;

    const returnedItemId = await syncToSharePoint(event, storedItemId);

    // Neue Item-ID persistieren, damit zukünftige Updates kein Search-Query benötigen
    if (!storedItemId && returnedItemId) {
      await saveSharePointItemId(event.rowKey, returnedItemId);
    }

    context.log(`postProcessTrigger: SharePoint-Sync abgeschlossen für "${event.rowKey}"`);
  } catch (err) {
    // ADR-017: SharePoint-Fehler → PostProcess-Fehler, kein PDF-Verarbeitungsfehler
    context.error(`postProcessTrigger: SharePoint-Sync fehlgeschlagen für "${event.rowKey}":`, err);
    throw err; // Queue-Retry auslösen
  }
}

// Registrierung nur außerhalb von Testumgebungen (ADR-008)
if (process.env["NODE_ENV"] !== "test") {
  app.storageQueue("postProcessTrigger", {
    queueName: "master-pdf-events",
    connection: "AZURE_STORAGE_CONNECTION_STRING",
    handler: async (message: unknown, context: InvocationContext): Promise<void> => {
      const raw = typeof message === "string" ? message : JSON.stringify(message);
      const event = JSON.parse(raw) as MasterPdfEvent;
      await postProcessTrigger(event, context);
    },
  });
}
