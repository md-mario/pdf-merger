// Mocks müssen vor den Imports stehen
jest.mock("@azure/functions", () => ({
  app: { storageBlob: jest.fn() },
}));
jest.mock("../src/infrastructure/tableStorage");
jest.mock("../src/utils/pdfReaderAsync");
jest.mock("../src/services/pdf-merger");

import { masterTrigger } from "../src/functions/masterTrigger";
import {
  upsertMasterPdfEntity,
  listUnmatchedDetailEntities,
  upsertDetailPdfEntity,
  updateMasterPdfMissingDetails,
} from "../src/infrastructure/tableStorage";
import { mergeIncrementally } from "../src/services/pdf-merger";
import { getPageTexts, extractReservationNumber } from "../src/utils/pdfReaderAsync";
import { InvocationContext } from "@azure/functions";
import { DetailPdfRow } from "../src/contracts/input";

const mockUpsertMaster = upsertMasterPdfEntity as jest.MockedFunction<typeof upsertMasterPdfEntity>;
const mockListUnmatched = listUnmatchedDetailEntities as jest.MockedFunction<typeof listUnmatchedDetailEntities>;
const mockUpsertDetail = upsertDetailPdfEntity as jest.MockedFunction<typeof upsertDetailPdfEntity>;
const mockUpdateMissing = updateMasterPdfMissingDetails as jest.MockedFunction<typeof updateMasterPdfMissingDetails>;
const mockMergeIncrementally = mergeIncrementally as jest.MockedFunction<typeof mergeIncrementally>;
const mockGetPageTexts = getPageTexts as jest.MockedFunction<typeof getPageTexts>;
const mockExtractReservationNumber = extractReservationNumber as jest.MockedFunction<typeof extractReservationNumber>;

function createMockContext(): InvocationContext {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    triggerMetadata: {},
    invocationId: "test-invocation",
    functionName: "masterTrigger",
    options: {},
    retryContext: undefined,
    traceContext: { traceParent: "", traceState: "", attributes: {} },
    extraInputs: { get: jest.fn() },
    extraOutputs: { set: jest.fn() },
  } as unknown as InvocationContext;
}

function makeUnmatchedDetail(rowKey: string): DetailPdfRow {
  return { partitionKey: "DetailPDFs", rowKey, status: "unmatched", matchedMaster: "" };
}

describe("Master Trigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsertMaster.mockResolvedValue(undefined);
    mockListUnmatched.mockResolvedValue([]);
    mockUpsertDetail.mockResolvedValue(undefined);
    mockUpdateMissing.mockResolvedValue([]);
    mockMergeIncrementally.mockResolvedValue(undefined);
    mockGetPageTexts.mockResolvedValue([
      { pageNumber: 1, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 2, text: "Reservierungsnummer: 20169310" },
    ]);
    mockExtractReservationNumber.mockImplementation((text) => {
      const match = text.match(/Reservierungsnummer: (\d+)/);
      return match ? match[1] : null;
    });
  });

  it("sollte MasterPDFs-Eintrag mit Status pending erstellen", async () => {
    const context = createMockContext();
    await masterTrigger(Buffer.from("mock pdf"), context, "Master.pdf");

    expect(mockUpsertMaster).toHaveBeenCalledWith(
      "Master.pdf",
      "pending",
      ["202174945", "20169310"],
      ["202174945", "20169310"]
    );
    expect(context.warn).not.toHaveBeenCalled();
  });

  it("sollte Warnung ausgeben wenn keine Reservierungsnummern gefunden", async () => {
    mockGetPageTexts.mockResolvedValue([{ pageNumber: 1, text: "Kein Match hier" }]);
    mockExtractReservationNumber.mockReturnValue(null);

    const context = createMockContext();
    await masterTrigger(Buffer.from("mock pdf"), context, "Master.pdf");

    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining('Keine Reservierungsnummern in "Master.pdf" gefunden')
    );
    expect(mockUpsertMaster).toHaveBeenCalledWith("Master.pdf", "pending", [], []);
  });

  it("sollte Reservierungsnummern deduplizieren", async () => {
    mockGetPageTexts.mockResolvedValue([
      { pageNumber: 1, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 2, text: "Reservierungsnummer: 202174945" },
    ]);
    mockExtractReservationNumber.mockReturnValue("202174945");

    const context = createMockContext();
    await masterTrigger(Buffer.from("mock pdf"), context, "Master.pdf");

    expect(mockUpsertMaster).toHaveBeenCalledWith(
      "Master.pdf",
      "pending",
      ["202174945"],
      ["202174945"]
    );
  });

  describe("Rescan: Details vor Master hochgeladen", () => {
    it("sollte keine Rescan-Aktion ausführen wenn keine unmatched Details vorhanden", async () => {
      mockListUnmatched.mockResolvedValue([]);

      const context = createMockContext();
      await masterTrigger(Buffer.from("mock pdf"), context, "Master.pdf");

      expect(mockUpsertDetail).not.toHaveBeenCalled();
      expect(mockMergeIncrementally).not.toHaveBeenCalled();
    });

    it("sollte unmatched Detail nachträglich verarbeiten wenn Prefix passt (ADR-012)", async () => {
      mockListUnmatched.mockResolvedValue([
        makeUnmatchedDetail("202174945_extra.pdf"),
      ]);
      mockUpdateMissing.mockResolvedValue([]);

      const context = createMockContext();
      await masterTrigger(Buffer.from("mock pdf"), context, "Master.pdf");

      expect(mockUpsertDetail).toHaveBeenCalledWith("202174945_extra.pdf", "matched", "Master.pdf");
      expect(mockUpdateMissing).toHaveBeenCalledWith("Master.pdf", "202174945");
      expect(mockMergeIncrementally).toHaveBeenCalledWith(
        "Master.pdf", "202174945", "202174945_extra.pdf", context
      );
    });

    it("sollte unmatched Detail überspringen wenn kein Prefix passt", async () => {
      mockListUnmatched.mockResolvedValue([
        makeUnmatchedDetail("999999999.pdf"), // gehört zu anderem Master
      ]);

      const context = createMockContext();
      await masterTrigger(Buffer.from("mock pdf"), context, "Master.pdf");

      expect(mockUpsertDetail).not.toHaveBeenCalled();
      expect(mockMergeIncrementally).not.toHaveBeenCalled();
    });

    it("sollte mehrere passende unmatched Details verarbeiten", async () => {
      mockListUnmatched.mockResolvedValue([
        makeUnmatchedDetail("202174945.pdf"),
        makeUnmatchedDetail("20169310.pdf"),
        makeUnmatchedDetail("999999999.pdf"), // kein Match
      ]);
      mockUpdateMissing.mockResolvedValue([]);

      const context = createMockContext();
      await masterTrigger(Buffer.from("mock pdf"), context, "Master.pdf");

      expect(mockUpsertDetail).toHaveBeenCalledTimes(2);
      expect(mockMergeIncrementally).toHaveBeenCalledTimes(2);
      expect(mockMergeIncrementally).toHaveBeenCalledWith("Master.pdf", "202174945", "202174945.pdf", context);
      expect(mockMergeIncrementally).toHaveBeenCalledWith("Master.pdf", "20169310", "20169310.pdf", context);
    });
  });
});

