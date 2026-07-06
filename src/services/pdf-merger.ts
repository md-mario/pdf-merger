// ADR-001: pdf-lib für Manipulation, pdf-parse für Extraktion
// ADR-002: Blob Storage Container: pdf-input, pdf-details, pdf-output
// ADR-003: Warnungen bei fehlenden Detail-PDFs, kein Abbruch
import { PDFDocument } from "pdf-lib";
import { InvocationContext } from "@azure/functions";
import { downloadBlob, uploadBlob, blobExists } from "../infrastructure/blobStorage";
import { getPageTexts, extractReservationNumber } from "../utils/pdfReaderAsync";
import { Datensatz, PageText } from "../contracts/input";
import { MergeResult } from "../contracts/output";

const INPUT_CONTAINER = "pdf-input";
const DETAILS_CONTAINER = "pdf-details";
const OUTPUT_CONTAINER = "pdf-output";
const OUTPUT_FILENAME = "Master_mit_Details_automatisch.pdf";

/**
 * Extrahiert Datensätze (Reservierungsnummer + Marker-Seite) aus der Master-PDF.
 * Gemäß SCOPE: Die letzte erkannte Reservierungsnummer wird dem nächsten Marker zugeordnet.
 */
export async function extractDatasets(
  masterBuffer: Buffer,
  context: InvocationContext
): Promise<Datensatz[]> {
  const pageTexts: PageText[] = await getPageTexts(masterBuffer);
  const datasets: Datensatz[] = [];
  const markerRegex = /Summe:\s*Netto\s+[\d.,]+\s*EUR/i;
  let currentReservation: { wert: string; seite: number } | null = null;

  for (const page of pageTexts) {
    const reservationNumber = extractReservationNumber(page.text);
    if (reservationNumber) {
      currentReservation = { wert: reservationNumber, seite: page.pageNumber };
    }

    const markerMatch = page.text.match(markerRegex);
    if (markerMatch) {
      if (!currentReservation) {
        context.warn(
          `WARN: Marker "${markerMatch[0]}" auf Seite ${page.pageNumber} ohne vorherige Reservierungsnummer`
        );
        continue;
      }
      datasets.push({
        reservierungsnummer: currentReservation,
        marker: { seite: page.pageNumber, text: markerMatch[0] },
        detailPdfName: `${currentReservation.wert}.pdf`,
        detailPdfExists: false,
      });
      currentReservation = null;
    }
  }

  return datasets;
}

/**
 * Führt die Master-PDF mit den verfügbaren Detail-PDFs zusammen.
 * - Lädt Master-PDF aus pdf-input
 * - Fügt Detail-PDFs nach der jeweiligen Marker-Seite ein (ADR-001: pdf-lib)
 * - Lädt Ergebnis in pdf-output hoch
 */
export async function mergeWithMarker(
  masterFileName: string,
  reservationNumbers: string[],
  context: InvocationContext
): Promise<MergeResult> {
  const warnings: string[] = [];

  const masterBuffer = await downloadBlob(INPUT_CONTAINER, masterFileName);
  const masterDoc = await PDFDocument.load(masterBuffer);
  const datasets = await extractDatasets(masterBuffer, context);

  // Nur Datensätze berücksichtigen, für die eine Reservierungsnummer erwartet wird
  const relevantDatasets = datasets.filter((d) =>
    reservationNumbers.includes(d.reservierungsnummer.wert)
  );

  // Einfügungen von hinten nach vorne verarbeiten, damit Seitenindizes korrekt bleiben
  const insertions: Array<{ afterPageIndex: number; detailBuffer: Buffer }> = [];

  for (const dataset of relevantDatasets) {
    const exists = await blobExists(DETAILS_CONTAINER, dataset.detailPdfName);
    if (!exists) {
      const msg = `WARN: Detail-PDF nicht gefunden: ${dataset.detailPdfName}`;
      context.warn(msg);
      warnings.push(msg);
      continue;
    }
    dataset.detailPdfExists = true;
    const detailBuffer = await downloadBlob(DETAILS_CONTAINER, dataset.detailPdfName);
    insertions.push({
      afterPageIndex: dataset.marker.seite, // 1-basiert → Insert-Index = markerSeite (0-based index after the marker page)
      detailBuffer,
    });
  }

  // Absteigend sortieren, damit spätere Einfügungen frühere Indizes nicht verschieben
  insertions.sort((a, b) => b.afterPageIndex - a.afterPageIndex);

  for (const insertion of insertions) {
    const detailDoc = await PDFDocument.load(insertion.detailBuffer);
    const copiedPages = await masterDoc.copyPages(detailDoc, detailDoc.getPageIndices());
    for (let i = 0; i < copiedPages.length; i++) {
      masterDoc.insertPage(insertion.afterPageIndex + i, copiedPages[i]);
    }
  }

  const mergedBytes = await masterDoc.save();
  await uploadBlob(OUTPUT_CONTAINER, OUTPUT_FILENAME, Buffer.from(mergedBytes));

  context.log(
    `PDF-Merger: ${OUTPUT_FILENAME} erstellt – ${insertions.length} Detail-PDFs eingefügt`
  );

  return {
    outputFileName: OUTPUT_FILENAME,
    processedDatasets: insertions.length,
    warnings,
  };
}
