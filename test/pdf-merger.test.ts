// ADR-001: Teste PDF-Merge-Logik mit gemockten Abhängigkeiten
jest.mock("../src/infrastructure/blobStorage");
jest.mock("../src/utils/pdfReaderAsync");
jest.mock("pdf-lib");

import { mergeWithMarker, extractDatasets } from "../src/services/pdf-merger";
import {
  downloadBlob,
  uploadBlob,
  blobExists,
} from "../src/infrastructure/blobStorage";
import { getPageTexts, extractReservationNumber } from "../src/utils/pdfReaderAsync";
import { PDFDocument } from "pdf-lib";
import { InvocationContext } from "@azure/functions";

const mockDownloadBlob = downloadBlob as jest.MockedFunction<typeof downloadBlob>;
const mockUploadBlob = uploadBlob as jest.MockedFunction<typeof uploadBlob>;
const mockBlobExists = blobExists as jest.MockedFunction<typeof blobExists>;
const mockGetPageTexts = getPageTexts as jest.MockedFunction<typeof getPageTexts>;
const mockExtractReservationNumber = extractReservationNumber as jest.MockedFunction<
  typeof extractReservationNumber
>;
const mockPDFDocument = PDFDocument as jest.Mocked<typeof PDFDocument>;

function createMockContext(): InvocationContext {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    triggerMetadata: {},
    invocationId: "test-invocation",
    functionName: "test",
    options: {},
    retryContext: undefined,
    traceContext: { traceParent: "", traceState: "", attributes: {} },
    extraInputs: { get: jest.fn() },
    extraOutputs: { set: jest.fn() },
  } as unknown as InvocationContext;
}

describe("PDF Merger Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Standard-Mock: getPageTexts gibt zwei Seiten zurück
    mockGetPageTexts.mockResolvedValue([
      { pageNumber: 1, text: "Reservierungsnummer: 202174945 Summe: Netto 100 EUR" },
      { pageNumber: 2, text: "Reservierungsnummer: 20169310 Summe: Netto 200 EUR" },
    ]);

    // Standard-Mock: extractReservationNumber
    mockExtractReservationNumber.mockImplementation((text) => {
      const match = text.match(/Reservierungsnummer: (\d+)/);
      return match ? match[1] : null;
    });

    // Standard-Mock: PDFDocument
    const mockMasterDoc = {
      getPageIndices: jest.fn().mockReturnValue([0]),
      copyPages: jest.fn().mockResolvedValue([{}]),
      insertPage: jest.fn(),
      save: jest.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    };
    const mockDetailDoc = {
      getPageIndices: jest.fn().mockReturnValue([0]),
    };
    (mockPDFDocument.load as jest.Mock)
      .mockResolvedValueOnce(mockMasterDoc)
      .mockResolvedValue(mockDetailDoc);

    // Standard-Mock: Blob-Operationen
    mockDownloadBlob.mockResolvedValue(Buffer.from("%PDF-1.4 mock"));
    mockBlobExists.mockResolvedValue(true);
    mockUploadBlob.mockResolvedValue(undefined);
  });

  describe("extractDatasets", () => {
    it("sollte Datensätze aus Seiten mit Reservierungsnummer und Marker extrahieren", async () => {
      const context = createMockContext();
      const datasets = await extractDatasets(Buffer.from("mock"), context);

      expect(datasets.length).toBe(2);
      expect(datasets[0].reservierungsnummer.wert).toBe("202174945");
      expect(datasets[0].marker.seite).toBe(1);
      expect(datasets[0].detailPdfName).toBe("202174945.pdf");
      expect(datasets[1].reservierungsnummer.wert).toBe("20169310");
    });

    it("sollte Warnung ausgeben wenn Marker ohne vorherige Reservierungsnummer", async () => {
      mockGetPageTexts.mockResolvedValue([
        { pageNumber: 1, text: "Summe: Netto 100 EUR" },
      ]);
      mockExtractReservationNumber.mockReturnValue(null);

      const context = createMockContext();
      const datasets = await extractDatasets(Buffer.from("mock"), context);

      expect(datasets.length).toBe(0);
      expect(context.warn).toHaveBeenCalledWith(
        expect.stringContaining("ohne vorherige Reservierungsnummer")
      );
    });
  });

  describe("mergeWithMarker", () => {
    it("sollte Detail-PDFs nach dem Marker einfügen und Ergebnis zurückgeben", async () => {
      const context = createMockContext();
      const result = await mergeWithMarker(
        "Master.pdf",
        ["202174945", "20169310"],
        context
      );

      expect(result.outputFileName).toBe("Master_mit_Details_automatisch.pdf");
      expect(result.processedDatasets).toBe(2);
      expect(result.warnings).toHaveLength(0);
      expect(mockUploadBlob).toHaveBeenCalledWith(
        "pdf-output",
        "Master_mit_Details_automatisch.pdf",
        expect.any(Buffer)
      );
    });

    it("sollte Warnung ausgeben wenn Detail-PDF fehlt (ADR-003: kein Abbruch)", async () => {
      mockBlobExists.mockResolvedValue(false);

      const context = createMockContext();
      const result = await mergeWithMarker("Master.pdf", ["202174945"], context);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("WARN: Detail-PDF nicht gefunden");
      expect(result.processedDatasets).toBe(0);
      // Upload wird trotzdem ausgeführt (ohne Detail-Seiten)
      expect(mockUploadBlob).toHaveBeenCalled();
    });
  });
});
