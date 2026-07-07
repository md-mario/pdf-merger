// ADR-001: pdf-lib für Manipulation, pdf-parse für Extraktion
// ADR-002: Blob Storage Container: pdf-input, pdf-details, pdf-output
// ADR-003: Warnungen bei fehlenden Detail-PDFs, kein Abbruch
// ADR-010: Inkrementelle Erstellung der Output-PDF
// ADR-011: Blob Storage Lease für Concurrency-Kontrolle
import { PDFDocument } from "pdf-lib";
import { InvocationContext } from "@azure/functions";
import {
  downloadBlob,
  uploadBlob,
  blobExists,
  downloadBlobIfExists,
  uploadBlobIfNotExists,
  acquireOutputBlobLease,
  uploadBlobWithLease,
} from "../infrastructure/blobStorage";
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

// ─── ADR-010: Inkrementelle PDF-Erstellung ────────────────────────────────────

/**
 * Findet die Seitennummer (1-basiert) des Markers für eine gegebene Reservierungsnummer.
 * Durchsucht die Seiten in Reihenfolge: erste passende Kombination aus Res.-Nr. + Marker.
 * Gibt null zurück wenn kein Marker gefunden (ADR-003: kein Abbruch).
 */
export function findInsertionPageForReservation(
  pageTexts: PageText[],
  reservationNumber: string
): number | null {
  const markerRegex = /Summe:\s*Netto\s+[\d.,]+\s*EUR/i;
  let currentResNum: string | null = null;

  for (const page of pageTexts) {
    const found = extractReservationNumber(page.text);
    if (found) {
      currentResNum = found;
    }

    if (markerRegex.test(page.text)) {
      if (currentResNum === reservationNumber) {
        return page.pageNumber; // 1-basiert; Einfügen bei Index = pageNumber
      }
      // Marker gehört zu einer anderen Reservierung → zurücksetzen
      currentResNum = null;
    }
  }
  return null;
}

/**
 * ADR-010 + ADR-011: Inkrementelles Einfügen einer einzelnen Detail-PDF.
 *
 * Ablauf:
 *  1. Sicherstellen dass Output-Blob existiert (ggf. aus Master initialisieren)
 *  2. Blob-Lease erwerben (exklusiver Schreibzugriff, ADR-011)
 *  3. Aktuelle Output-PDF laden
 *  4. Einfügeposition für diese Reservierungsnummer bestimmen
 *  5. Detail-PDF nach der Marker-Seite einfügen (ADR-012: Blob-Name ggf. mit Extra-Ziffern)
 *  6. Ergebnis mit Lease hochladen
 *  7. Lease freigeben (immer, auch bei Fehler)
 */
export async function mergeIncrementally(
  masterFileName: string,
  reservationNumber: string,
  detailBlobName: string, // ADR-012: tatsächlicher Blob-Name (z. B. "201468964.pdf" für Res.Nr. "20146896")
  context: InvocationContext
): Promise<void> {
  const masterBuffer = await downloadBlob(INPUT_CONTAINER, masterFileName);

  // Schritt 1: Output-Blob initialisieren wenn noch nicht vorhanden (ADR-010)
  if (!(await blobExists(OUTPUT_CONTAINER, OUTPUT_FILENAME))) {
    try {
      await uploadBlobIfNotExists(OUTPUT_CONTAINER, OUTPUT_FILENAME, masterBuffer);
      context.log(`mergeIncrementally: Output-PDF initialisiert aus "${masterFileName}"`);
    } catch {
      // 412 = anderer Prozess hat inzwischen erstellt – kein Problem
    }
  }

  // Schritt 2: Blob-Lease erwerben (ADR-011)
  let lease: { leaseId: string; release: () => Promise<void> };
  try {
    lease = await acquireOutputBlobLease(OUTPUT_CONTAINER, OUTPUT_FILENAME);
  } catch (err: unknown) {
    const msg = `WARN: Blob-Lease für "${OUTPUT_FILENAME}" nicht verfügbar: ${String(err)}`;
    context.warn(msg);
    throw err; // Azure Functions Retry-Mechanismus greift
  }

  try {
    // Schritt 3: Aktuelle Output-PDF laden
    const currentBuffer = await downloadBlob(OUTPUT_CONTAINER, OUTPUT_FILENAME);
    const pageTexts = await getPageTexts(currentBuffer);

    // Schritt 4: Einfügeposition bestimmen
    const insertionPage = findInsertionPageForReservation(pageTexts, reservationNumber);
    if (insertionPage === null) {
      context.warn(
        `WARN: Kein Marker "Summe: Netto" für Reservierungsnummer "${reservationNumber}" in Output-PDF gefunden`
      );
      return;
    }

    // Schritt 5: Detail-PDF prüfen und laden (ADR-012: Blob-Name kommt vom Caller)
    if (!(await blobExists(DETAILS_CONTAINER, detailBlobName))) {
      context.warn(`WARN: Detail-PDF nicht gefunden: ${detailBlobName}`);
      return;
    }

    const detailBuffer = await downloadBlob(DETAILS_CONTAINER, detailBlobName);
    const workingDoc = await PDFDocument.load(currentBuffer);
    const detailDoc = await PDFDocument.load(detailBuffer);
    const copiedPages = await workingDoc.copyPages(detailDoc, detailDoc.getPageIndices());

    for (let i = 0; i < copiedPages.length; i++) {
      workingDoc.insertPage(insertionPage + i, copiedPages[i]);
    }

    // Schritt 6: Ergebnis mit Lease hochladen
    const mergedBytes = await workingDoc.save();
    await uploadBlobWithLease(
      OUTPUT_CONTAINER,
      OUTPUT_FILENAME,
      Buffer.from(mergedBytes),
      lease.leaseId
    );

    context.log(
      `mergeIncrementally: "${detailBlobName}" nach Seite ${insertionPage} eingefügt (Lease: ${lease.leaseId})`
    );
  } finally {
    // Schritt 7: Lease immer freigeben (ADR-011)
    await lease.release();
  }
}
