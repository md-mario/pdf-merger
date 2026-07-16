// ADR-006: TypeScript-Interfaces für interne Datenhaltung

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface Reservierungsnummer {
  wert: string;
  seite: number;
}

export interface Marker {
  seite: number;
  text: string;
}

export interface Datensatz {
  reservierungsnummer: Reservierungsnummer;
  marker: Marker;
  detailPdfName: string;
  detailPdfExists: boolean;
}

// Azure Table Storage entities

export interface MasterPdfRow {
  partitionKey: string;
  rowKey: string;
  etag?: string;
  timestamp?: Date;
  status: "new" | "pending" | "completed" | "failed";
  reservationNumbers: string; // JSON-serialized string[]
  missingDetails: string;     // JSON-serialized string[]
  sharePointItemId?: string;  // SharePoint-Listen-Item-ID für direktes Update ohne Suchabfrage
}

export interface DetailPdfRow {
  partitionKey: string;
  rowKey: string;
  etag?: string;
  timestamp?: Date;
  status: "matched" | "unmatched";
  matchedMaster: string;
}
