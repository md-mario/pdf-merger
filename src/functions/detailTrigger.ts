// ADR-005: Blob Storage Trigger auf Container "pdf-details"
// ADR-003: Warnung bei nicht-zuordenbaren Detail-PDFs, kein Abbruch
// ADR-003: ETag-Retry-Logik für Race Conditions
// ADR-010: Inkrementelles Einfügen nach jedem Detail-Match
// ADR-011: Blob-Lease über mergeIncrementally
// ADR-012: Prefix-Matching für Detail-PDF-Zuordnung
// ADR-015: Normalisierung von Dateinamen mit SCI-Präfix
import { app, InvocationContext } from "@azure/functions";
import {
  listPendingMasterEntities,
  updateMasterPdfMissingDetails,
  upsertDetailPdfEntity,
} from "../infrastructure/tableStorage";
import { mergeIncrementally } from "../services/pdf-merger";
import { normalizeFileName } from "../utils/fileNameUtils";

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

  // ADR-015: SCI-Präfix entfernen – Matching basiert auf normalisiertem Namen
  const normalizedName = normalizeFileName(name);
  const detailNameWithoutExt = normalizedName.replace(/\.pdf$/i, "");
  const pendingMasters = await listPendingMasterEntities();

  // ADR-012: Prefix-Matching – Detail-PDF-Name beginnt mit Reservierungsnummer
  // Beispiel: "201468964" beginnt mit Reservierungsnummer "20146896"
  const matchedMaster = pendingMasters.find((m) => {
    const missing: string[] = JSON.parse(m.missingDetails);
    return missing.some((resNum) => detailNameWithoutExt.startsWith(resNum));
  });

  if (!matchedMaster) {
    context.warn(
      `WARN: Kein Master-PDF im Status "pending" für Detail-PDF "${name}" gefunden`
    );
    await upsertDetailPdfEntity(name, "unmatched", "");
    return;
  }

  // Matchende Reservierungsnummer per Prefix bestimmen
  const missingList: string[] = JSON.parse(matchedMaster.missingDetails);
  const matchedReservationNumber = missingList.find((resNum) =>
    detailNameWithoutExt.startsWith(resNum)
  );
  if (!matchedReservationNumber) {
    // Defensiver Guard – sollte durch den obigen find nicht auftreten
    context.warn(
      `WARN: Reservierungsnummer für "${name}" nach Match nicht mehr auffindbar`
    );
    await upsertDetailPdfEntity(name, "unmatched", "");
    return;
  }

  await upsertDetailPdfEntity(name, "matched", matchedMaster.rowKey);
  context.log(
    `detailTrigger: "${name}" matched mit Reservierung "${matchedReservationNumber}" in Master "${matchedMaster.rowKey}"`
  );

  // ETag-gesichertes Update (ADR-003: Race Condition Handling)
  const updatedMissing = await updateMasterPdfMissingDetails(
    matchedMaster.rowKey,
    matchedReservationNumber
  );

  context.log(
    `detailTrigger: Verbleibende Details für "${matchedMaster.rowKey}": ${updatedMissing.length}`
  );

  // ADR-010: Inkrementelles Einfügen bei jedem Match (nicht erst am Ende)
  // ADR-012: tatsächlichen Blob-Namen übergeben (ggf. mit Extra-Ziffern)
  await mergeIncrementally(matchedMaster.rowKey, matchedReservationNumber, name, context);
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
