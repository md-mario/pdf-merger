// ADR-001: Teste PDF-Merge-Logik mit gemockten Abhängigkeiten
// ADR-010: Tests für inkrementelle Merge-Logik
// ADR-011: Tests für Blob-Lease-Verhalten
jest.mock("../src/infrastructure/blobStorage");
jest.mock("../src/utils/pdfReaderAsync");
jest.mock("pdf-lib");

import { mergeWithMarker, extractDatasets, mergeIncrementally, findInsertionPageForReservation } from "../src/services/pdf-merger";
import {
  downloadBlob,
  uploadBlob,
  blobExists,
  downloadBlobIfExists,
  uploadBlobIfNotExists,
  acquireOutputBlobLease,
  uploadBlobWithLease,
} from "../src/infrastructure/blobStorage";
import { getPageTexts, extractReservationNumber } from "../src/utils/pdfReaderAsync";
import { PDFDocument } from "pdf-lib";
import { InvocationContext } from "@azure/functions";

const mockDownloadBlob = downloadBlob as jest.MockedFunction<typeof downloadBlob>;
const mockUploadBlob = uploadBlob as jest.MockedFunction<typeof uploadBlob>;
const mockBlobExists = blobExists as jest.MockedFunction<typeof blobExists>;
const mockDownloadBlobIfExists = downloadBlobIfExists as jest.MockedFunction<typeof downloadBlobIfExists>;
const mockUploadBlobIfNotExists = uploadBlobIfNotExists as jest.MockedFunction<typeof uploadBlobIfNotExists>;
const mockAcquireLease = acquireOutputBlobLease as jest.MockedFunction<typeof acquireOutputBlobLease>;
const mockUploadWithLease = uploadBlobWithLease as jest.MockedFunction<typeof uploadBlobWithLease>;
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

      // ADR-013: Output-Dateiname = Input-Dateiname
      expect(result.outputFileName).toBe("Master.pdf");
      expect(result.processedDatasets).toBe(2);
      expect(result.warnings).toHaveLength(0);
      expect(mockUploadBlob).toHaveBeenCalledWith(
        "pdf-output",
        "Master.pdf",
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

// ─── ADR-010: findInsertionPageForReservation ─────────────────────────────────

describe("findInsertionPageForReservation", () => {
  it("sollte die Marker-Seite für eine Reservierungsnummer zurückgeben", () => {
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 2, text: "Summe: Netto 100 EUR" },
    ];
    expect(findInsertionPageForReservation(pageTexts, "202174945")).toBe(2);
  });

  it("sollte null zurückgeben wenn keine Reservierungsnummer passt", () => {
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 999" },
      { pageNumber: 2, text: "Summe: Netto 100 EUR" },
    ];
    expect(findInsertionPageForReservation(pageTexts, "202174945")).toBeNull();
  });

  it("sollte null zurückgeben wenn kein Marker vorhanden", () => {
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 2, text: "Kein Marker" },
    ];
    expect(findInsertionPageForReservation(pageTexts, "202174945")).toBeNull();
  });

  it("sollte Reservierungsnummer über mehrere Seiten hinweg tracken", () => {
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 2, text: "Zwischentext ohne Marker" },
      { pageNumber: 3, text: "Summe: Netto 108,68 EUR" },
    ];
    expect(findInsertionPageForReservation(pageTexts, "202174945")).toBe(3);
  });

  it("sollte korrekte Seite bei mehreren Reservierungen zurückgeben", () => {
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 100" },
      { pageNumber: 2, text: "Summe: Netto 50 EUR" },
      { pageNumber: 3, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 4, text: "Summe: Netto 200 EUR" },
    ];
    expect(findInsertionPageForReservation(pageTexts, "202174945")).toBe(4);
    expect(findInsertionPageForReservation(pageTexts, "100")).toBe(2);
  });

  it("sollte nicht auf bereits verarbeitete Reservierungen matchen", () => {
    // Res 100 wurde bereits verarbeitet (Marker auf S.2), Res 200 folgt
    // Suche nach Res 100 darf nicht Marker von Res 200 (S.4) zurückgeben
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 100" },
      { pageNumber: 2, text: "Summe: Netto 50 EUR" },      // Marker für 100
      { pageNumber: 3, text: "Reservierungsnummer: 200" },
      { pageNumber: 4, text: "Summe: Netto 200 EUR" },     // Marker für 200
    ];
    expect(findInsertionPageForReservation(pageTexts, "100")).toBe(2);
  });
});

// ─── ADR-010 + ADR-011: mergeIncrementally ───────────────────────────────────

describe("mergeIncrementally", () => {
  const mockLease = {
    leaseId: "test-lease-id",
    release: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetPageTexts.mockResolvedValue([
      { pageNumber: 1, text: "Reservierungsnummer: 202174945 Summe: Netto 100 EUR" },
    ]);
    mockExtractReservationNumber.mockImplementation((text) => {
      const m = text.match(/Reservierungsnummer: (\d+)/);
      return m ? m[1] : null;
    });

    const mockMasterDoc = {
      getPageIndices: jest.fn().mockReturnValue([0]),
      copyPages: jest.fn().mockResolvedValue([{}]),
      insertPage: jest.fn(),
      save: jest.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    };
    const mockDetailDoc = { getPageIndices: jest.fn().mockReturnValue([0]) };
    (mockPDFDocument.load as jest.Mock)
      .mockResolvedValueOnce(mockMasterDoc)
      .mockResolvedValue(mockDetailDoc);

    mockDownloadBlob.mockResolvedValue(Buffer.from("%PDF-1.4 mock"));
    mockBlobExists
      .mockResolvedValueOnce(true)  // output exists
      .mockResolvedValueOnce(true); // detail exists
    mockAcquireLease.mockResolvedValue(mockLease);
    mockUploadWithLease.mockResolvedValue(undefined);
    mockUploadBlobIfNotExists.mockResolvedValue(undefined);
  });

  it("sollte Detail-PDF inkrementell einfügen und Lease korrekt verwalten (ADR-011)", async () => {
    const context = createMockContext();
    await mergeIncrementally("Master.pdf", "202174945", "202174945.pdf", context);

    expect(mockAcquireLease).toHaveBeenCalledWith("pdf-output", "Master.pdf");
    expect(mockUploadWithLease).toHaveBeenCalledWith(
      "pdf-output",
      "Master.pdf",
      expect.any(Buffer),
      "test-lease-id"
    );
    expect(mockLease.release).toHaveBeenCalled();
  });

  it("sollte Output-PDF aus Master initialisieren wenn noch nicht vorhanden (ADR-010)", async () => {
    mockBlobExists.mockReset();
    mockBlobExists
      .mockResolvedValueOnce(false) // output existiert noch nicht
      .mockResolvedValueOnce(true); // detail exists

    const context = createMockContext();
    await mergeIncrementally("Master.pdf", "202174945", "202174945.pdf", context);

    expect(mockUploadBlobIfNotExists).toHaveBeenCalledWith(
      "pdf-output",
      "Master.pdf",
      expect.any(Buffer)
    );
  });

  it("sollte Lease immer freigeben – auch bei Fehler (ADR-011 finally)", async () => {
    mockDownloadBlob
      .mockResolvedValueOnce(Buffer.from("%PDF master")) // master download
      .mockRejectedValueOnce(new Error("Download-Fehler")); // output download schlägt fehl

    const context = createMockContext();
    await expect(mergeIncrementally("Master.pdf", "202174945", "202174945.pdf", context)).rejects.toThrow();
    expect(mockLease.release).toHaveBeenCalled();
  });

  it("sollte Warnung ausgeben und weitermachen wenn kein Marker gefunden (ADR-003)", async () => {
    mockGetPageTexts.mockResolvedValue([
      { pageNumber: 1, text: "Kein passender Marker" },
    ]);
    mockExtractReservationNumber.mockReturnValue(null);

    const context = createMockContext();
    await mergeIncrementally("Master.pdf", "202174945", "202174945.pdf", context);

    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining("Kein Marker")
    );
    expect(mockUploadWithLease).not.toHaveBeenCalled();
    expect(mockLease.release).toHaveBeenCalled();
  });

  it("sollte Warnung ausgeben wenn Detail-PDF fehlt (ADR-003)", async () => {
    mockBlobExists.mockReset();
    mockBlobExists
      .mockResolvedValueOnce(true)  // output exists
      .mockResolvedValueOnce(false); // detail missing

    const context = createMockContext();
    await mergeIncrementally("Master.pdf", "202174945", "202174945.pdf", context);

    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining("Detail-PDF nicht gefunden")
    );
    expect(mockUploadWithLease).not.toHaveBeenCalled();
    expect(mockLease.release).toHaveBeenCalled();
  });
});
