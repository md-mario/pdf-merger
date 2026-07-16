// ADR-017: Queue Message Typ für MasterPDF-Ereignisse

export interface MasterPdfEvent {
  eventType: "MasterPdfUpserted";
  timestamp: string;
  partitionKey: "MasterPDFs";
  rowKey: string;
  masterPdfName: string;
  status: "new" | "pending" | "completed" | "failed";
  missingDetails: string[];
  missingDetailCount: number;
  downloadPath: string;
}
