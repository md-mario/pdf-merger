// ADR-005: Blob Storage Trigger auf Container "pdf-input"
// ADR-008: context.log für Entwicklungsumgebung
// ADR-015: Normalisierung von Dateinamen mit SCI-Präfix (Rescan)
// ADR-017: Queue-Message nach MasterPDF-Upsert
import { app, InvocationContext } from "@azure/functions";
import { getPageTexts, extractReservationNumber } from "../utils/pdfReaderAsync";
import { normalizeFileName } from "../utils/fileNameUtils";
import {
  upsertMasterPdfEntity,
  listUnmatchedDetailEntities,
  upsertDetailPdfEntity,
  updateMasterPdfMissingDetails,
} from "../infrastructure/tableStorage";
import { mergeIncrementally } from "../services/pdf-merger";
import { sendMasterPdfEvent } from "../infrastructure/queueStorage";

/**
 * Verarbeitet eine neu hochgeladene Master-PDF:
 * - Extrahiert Reservierungsnummern seitenweise
 * - Speichert Eintrag in Table Storage (MasterPDFs) mit Status "pending"
 */
export async function masterTrigger(
  blob: Buffer,
  context: InvocationContext,
  name: string
): Promise<void> {
  context.log(`masterTrigger: Verarbeite "${name}"`);

  const pageTexts = await getPageTexts(blob);
  const reservationNumbers: string[] = [];

  for (const page of pageTexts) {
    const number = extractReservationNumber(page.text);
    if (number && !reservationNumbers.includes(number)) {
      reservationNumbers.push(number);
    }
  }

  if (reservationNumbers.length === 0) {
    context.warn(`WARN: Keine Reservierungsnummern in "${name}" gefunden`);
  }

  await upsertMasterPdfEntity(
    name,
    "new",
    reservationNumbers,
    reservationNumbers // missingDetails = alle Reservierungsnummern initial
  );

  // ADR-017: Queue-Event nach initialem Upsert
  await sendMasterPdfEvent({
    eventType: "MasterPdfUpserted",
    timestamp: new Date().toISOString(),
    partitionKey: "MasterPDFs",
    rowKey: name,
    masterPdfName: name,
    status: "new",
    missingDetails: reservationNumbers,
    missingDetailCount: reservationNumbers.length,
    downloadPath: `/api/download/${encodeURIComponent(name)}`,
  });

  context.log(
    `masterTrigger: "${name}" gespeichert – ${reservationNumbers.length} Reservierungsnummer(n): ${reservationNumbers.join(", ")}`
  );

  // Rescan: "unmatched" Detail-PDFs verarbeiten, die vor dem Master hochgeladen wurden
  // ADR-012: Prefix-Matching (gleiche Logik wie detailTrigger)
  const unmatchedDetails = await listUnmatchedDetailEntities();
  for (const detail of unmatchedDetails) {
    // ADR-015: SCI-Präfix entfernen vor dem Prefix-Matching
    const detailNameWithoutExt = normalizeFileName(detail.rowKey).replace(/\.pdf$/i, "");
    const matchedResNum = reservationNumbers.find((resNum) =>
      detailNameWithoutExt.startsWith(resNum)
    );
    if (!matchedResNum) continue;

    context.log(
      `masterTrigger: Rescan – Detail "${detail.rowKey}" nachträglich verarbeitet für Reservierung "${matchedResNum}"`
    );

    await upsertDetailPdfEntity(detail.rowKey, "matched", name);
    const updatedMissing = await updateMasterPdfMissingDetails(name, matchedResNum);
    await mergeIncrementally(name, matchedResNum, detail.rowKey, context);

    // ADR-017: Queue-Event nach Rescan-Update
    const updatedStatus = updatedMissing.length === 0 ? "completed" : "pending";
    await sendMasterPdfEvent({
      eventType: "MasterPdfUpserted",
      timestamp: new Date().toISOString(),
      partitionKey: "MasterPDFs",
      rowKey: name,
      masterPdfName: name,
      status: updatedStatus,
      missingDetails: updatedMissing,
      missingDetailCount: updatedMissing.length,
      downloadPath: `/api/download/${encodeURIComponent(name)}`,
    });
  }
}

// Registrierung nur außerhalb von Testumgebungen (ADR-008)
if (process.env["NODE_ENV"] !== "test") {
  app.storageBlob("masterTrigger", {
    path: "pdf-input/{name}",
    connection: "AZURE_STORAGE_CONNECTION_STRING",
    handler: async (blob: Buffer, context: InvocationContext) => {
      const name = context.triggerMetadata?.["name"] as string | undefined;
      if (!name || !name.toLowerCase().endsWith(".pdf")) {
        context.log(`masterTrigger: "${name ?? "(unbekannt)"}" ist keine PDF – wird ignoriert`);
        return;
      }
      await masterTrigger(blob, context, name);
    },
  });
}
