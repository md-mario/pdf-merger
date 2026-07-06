// ADR-006: Output-Interfaces

export interface VerarbeitungsDatensatz {
  reservierungsnummer: string;
  markerSeite: number;
  detailPdfName: string;
  detailPdfExists: boolean;
}

export interface VerarbeitungsStatus {
  masterPdf: string;
  datensaetze: VerarbeitungsDatensatz[];
  startZeit: Date;
  endZeit?: Date;
  fehler: string[];
  status: "erfolgreich" | "fehlgeschlagen" | "in-progress";
}

export interface MergeResult {
  outputFileName: string;
  processedDatasets: number;
  warnings: string[];
}
