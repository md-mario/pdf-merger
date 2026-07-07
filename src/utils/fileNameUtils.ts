// ADR-015: Normalisierung von Dateinamen mit bekannten Präfixen (z.B. "SCI-")
// Der originale Blob-Name bleibt unverändert – Normalisierung nur für Matching-Operationen.

const KNOWN_PREFIXES = ["SCI-"];

/**
 * Entfernt bekannte Präfixe (ADR-015) vom Dateinamen.
 * Beispiel: "SCI-201468964.pdf" → "201468964.pdf"
 */
export function normalizeFileName(fileName: string): string {
  for (const prefix of KNOWN_PREFIXES) {
    if (fileName.startsWith(prefix)) {
      return fileName.substring(prefix.length);
    }
  }
  return fileName;
}
