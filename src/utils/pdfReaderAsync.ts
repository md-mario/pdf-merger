// ADR-001: pdf-parse für Textextraktion (seitenweise)
import pdfParse from "pdf-parse";
import { PageText } from "../contracts/input";

interface PdfPageData {
  getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
}

/**
 * Extrahiert Text pro Seite aus einem PDF-Buffer.
 * Verwendet pdf-parse mit dem pagerender-Callback für seitenweise Extraktion.
 */
export async function getPageTexts(buffer: Buffer): Promise<PageText[]> {
  const pageTexts: PageText[] = [];

  await pdfParse(buffer, {
    pagerender: (pageData: PdfPageData) => {
      return pageData.getTextContent().then((textContent) => {
        const text = textContent.items.map((item) => item.str).join(" ");
        pageTexts.push({
          pageNumber: pageTexts.length + 1,
          text,
        });
        return text;
      });
    },
  });

  return pageTexts;
}

/**
 * Extrahiert die Reservierungsnummer aus einem Seitentext.
 * Format: "Reservierungsnummer: <Zahl>" (case-insensitive)
 */
export function extractReservationNumber(text: string): string | null {
  const match = text.match(/Reservierungsnummer[:\s]+(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Findet die erste Seite mit dem Marker "Summe: Netto X EUR".
 * Gibt die Seitennummer (1-basiert) zurück oder null.
 */
export function findMarkerPage(pageTexts: PageText[]): number | null {
  const markerRegex = /Summe:\s*Netto\s+[\d.,]+\s*EUR/i;
  const page = pageTexts.find((p) => markerRegex.test(p.text));
  return page ? page.pageNumber : null;
}
