// ADR-005: Blob Storage Trigger auf Container "pdf-details"
// ADR-003: Warnung bei nicht-zuordenbaren Detail-PDFs, kein Abbruch
// ADR-003: ETag-Retry-Logik für Race Conditions
import { app, InvocationContext } from "@azure/functions";
import {
  listPendingMasterEntities,
  updateMasterPdfMissingDetails,
  upsertDetailPdfEntity,
} from "../infrastructure/tableStorage";
import { mergeWithMarker } from "../services/pdf-merger";

/**
 * Verarbeitet eine neu hochgeladene Detail-PDF:
 * - Sucht zugehörige Master-PDF in Table Storage (MasterPDFs, Status "pending")
 * - Aktualisiert missingDetails (ETag-gesichert gegen Race Conditions)
 * - Sobald alle Details vorhanden: startet PDF-Merge
 */
export async function detailTrigger(
  _blob: Buffer,
  context: InvocationContext,
  name: string
): Promise<void> {
  context.log(`detailTrigger: Verarbeite "${name}"`);

  const reservationNumber = name.replace(/\.pdf$/i, "");
  const pendingMasters = await listPendingMasterEntities();

  const matchedMaster = pendingMasters.find((m) => {
    const missing: string[] = JSON.parse(m.missingDetails);
    return missing.includes(reservationNumber);
  });

  if (!matchedMaster) {
    context.warn(
      `WARN: Kein Master-PDF im Status "pending" für Detail-PDF "${name}" gefunden`
    );
    await upsertDetailPdfEntity(name, "unmatched", "");
    return;
  }

  await upsertDetailPdfEntity(name, "matched", matchedMaster.rowKey);
  context.log(`detailTrigger: "${name}" matched mit Master "${matchedMaster.rowKey}"`);

  // ETag-gesichertes Update (ADR-003: Race Condition Handling)
  const updatedMissing = await updateMasterPdfMissingDetails(
    matchedMaster.rowKey,
    reservationNumber
  );

  context.log(
    `detailTrigger: Verbleibende Details für "${matchedMaster.rowKey}": ${updatedMissing.length}`
  );

  if (updatedMissing.length === 0) {
    context.log(
      `detailTrigger: Alle Details vorhanden – starte PDF-Merge für "${matchedMaster.rowKey}"`
    );
    const reservationNumbers: string[] = JSON.parse(matchedMaster.reservationNumbers);
    await mergeWithMarker(matchedMaster.rowKey, reservationNumbers, context);
  }
}

// Registrierung nur außerhalb von Testumgebungen (ADR-008)
if (process.env["NODE_ENV"] !== "test") {
  app.storageBlob("detailTrigger", {
    path: "pdf-details/{name}",
    connection: "AZURE_STORAGE_CONNECTION_STRING",
    handler: async (blob: Buffer, context: InvocationContext) => {
      const name = context.triggerMetadata?.["name"] as string | undefined;
      if (!name || !name.toLowerCase().endsWith(".pdf")) {
        context.log(`detailTrigger: "${name ?? "(unbekannt)"}" ist keine PDF – wird ignoriert`);
        return;
      }
      await detailTrigger(blob, context, name);
    },
  });
}
