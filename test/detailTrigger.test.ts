jest.mock("@azure/functions", () => ({
  app: { storageBlob: jest.fn() },
}));
jest.mock("../src/infrastructure/tableStorage");
jest.mock("../src/services/pdf-merger");

import { detailTrigger } from "../src/functions/detailTrigger";
import {
  listPendingMasterEntities,
  updateMasterPdfMissingDetails,
  upsertDetailPdfEntity,
} from "../src/infrastructure/tableStorage";
import { mergeIncrementally } from "../src/services/pdf-merger";
import { MasterPdfRow } from "../src/contracts/input";
import { InvocationContext } from "@azure/functions";

const mockListPending = listPendingMasterEntities as jest.MockedFunction<
  typeof listPendingMasterEntities
>;
const mockUpdateMissing = updateMasterPdfMissingDetails as jest.MockedFunction<
  typeof updateMasterPdfMissingDetails
>;
const mockUpsertDetail = upsertDetailPdfEntity as jest.MockedFunction<
  typeof upsertDetailPdfEntity
>;
const mockMergeIncrementally = mergeIncrementally as jest.MockedFunction<
  typeof mergeIncrementally
>;

function createMockContext(): InvocationContext {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    triggerMetadata: {},
    invocationId: "test-invocation",
    functionName: "detailTrigger",
    options: {},
    retryContext: undefined,
    traceContext: { traceParent: "", traceState: "", attributes: {} },
    extraInputs: { get: jest.fn() },
    extraOutputs: { set: jest.fn() },
  } as unknown as InvocationContext;
}

const masterEntity: MasterPdfRow = {
  partitionKey: "MasterPDFs",
  rowKey: "Master.pdf",
  status: "pending",
  reservationNumbers: JSON.stringify(["202174945", "20169310"]),
  missingDetails: JSON.stringify(["202174945", "20169310"]),
  etag: '"test-etag"',
};

describe("Detail Trigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListPending.mockResolvedValue([masterEntity]);
    mockUpdateMissing.mockResolvedValue(["20169310"]);
    mockUpsertDetail.mockResolvedValue(undefined);
    mockMergeIncrementally.mockResolvedValue(undefined);
  });

  it("sollte DetailPDFs-Eintrag als matched speichern und missingDetails aktualisieren", async () => {
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "202174945.pdf");

    expect(mockUpsertDetail).toHaveBeenCalledWith("202174945.pdf", "matched", "Master.pdf");
    expect(mockUpdateMissing).toHaveBeenCalledWith("Master.pdf", "202174945");
  });

  // ADR-010: mergeIncrementally wird nach JEDEM Match aufgerufen (nicht erst am Ende)
  it("sollte mergeIncrementally nach jedem Match aufrufen – auch wenn noch Details fehlen", async () => {
    mockUpdateMissing.mockResolvedValue(["20169310"]); // noch offen
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "202174945.pdf");

    expect(mockMergeIncrementally).toHaveBeenCalledWith(
      "Master.pdf",
      "202174945",
      "202174945.pdf",
      context
    );
  });

  it("sollte mergeIncrementally auch beim letzten Detail aufrufen", async () => {
    mockUpdateMissing.mockResolvedValue([]); // alle Details vorhanden
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "20169310.pdf");

    expect(mockMergeIncrementally).toHaveBeenCalledWith(
      "Master.pdf",
      "20169310",
      "20169310.pdf",
      context
    );
  });

  it("sollte Warnung ausgeben und als unmatched speichern wenn kein Master gefunden", async () => {
    mockListPending.mockResolvedValue([]);
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "999999.pdf");

    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining('Kein Master-PDF im Status "pending"')
    );
    expect(mockUpsertDetail).toHaveBeenCalledWith("999999.pdf", "unmatched", "");
    expect(mockMergeIncrementally).not.toHaveBeenCalled();
  });

  it("sollte mergeIncrementally NICHT aufrufen wenn kein Match", async () => {
    mockListPending.mockResolvedValue([]);
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "000000.pdf");

    expect(mockMergeIncrementally).not.toHaveBeenCalled();
  });

  it("sollte Reservierungsnummer korrekt aus Dateinamen extrahieren", async () => {
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "202174945.pdf");

    expect(mockUpdateMissing).toHaveBeenCalledWith("Master.pdf", "202174945");
    expect(mockMergeIncrementally).toHaveBeenCalledWith("Master.pdf", "202174945", "202174945.pdf", context);
  });

  // ADR-012: Prefix-Matching
  it("sollte Detail-PDF per Prefix-Matching zuordnen (Dateiname beginnt mit Res.-Nr.)", async () => {
    // Reservierungsnummer in Master: "202174945"
    // Dateiname Detail-PDF:          "2021749450.pdf" (extra Ziffer am Ende)
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "2021749450.pdf");

    expect(mockUpsertDetail).toHaveBeenCalledWith("2021749450.pdf", "matched", "Master.pdf");
    expect(mockUpdateMissing).toHaveBeenCalledWith("Master.pdf", "202174945");
    expect(mockMergeIncrementally).toHaveBeenCalledWith(
      "Master.pdf",
      "202174945",
      "2021749450.pdf",
      context
    );
  });

  it("sollte keine Zuordnung bei nicht-passendem Prefix ausgeben", async () => {
    // "99202174945" beginnt NICHT mit "202174945"
    mockListPending.mockResolvedValue([masterEntity]);
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "99202174945.pdf");

    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining('Kein Master-PDF im Status "pending"')
    );
    expect(mockMergeIncrementally).not.toHaveBeenCalled();
  });

  // ADR-015: SCI-Präfix-Tests
  describe("SCI-Präfix Normalisierung (ADR-015)", () => {
    it("sollte SCI-präfixierte Detail-PDF korrekt zuordnen", async () => {
      const context = createMockContext();
      await detailTrigger(Buffer.from("mock"), context, "SCI-202174945.pdf");

      expect(mockUpsertDetail).toHaveBeenCalledWith("SCI-202174945.pdf", "matched", "Master.pdf");
      expect(mockUpdateMissing).toHaveBeenCalledWith("Master.pdf", "202174945");
      expect(mockMergeIncrementally).toHaveBeenCalledWith(
        "Master.pdf", "202174945", "SCI-202174945.pdf", context
      );
    });

    it("sollte SCI-präfixierte Detail-PDF per Prefix-Matching zuordnen (extra Ziffern)", async () => {
      const context = createMockContext();
      await detailTrigger(Buffer.from("mock"), context, "SCI-2021749450.pdf");

      expect(mockUpsertDetail).toHaveBeenCalledWith("SCI-2021749450.pdf", "matched", "Master.pdf");
      expect(mockUpdateMissing).toHaveBeenCalledWith("Master.pdf", "202174945");
    });

    it("sollte SCI-präfixierte Detail-PDF als unmatched markieren wenn keine Reservierung passt", async () => {
      const context = createMockContext();
      await detailTrigger(Buffer.from("mock"), context, "SCI-999999.pdf");

      expect(context.warn).toHaveBeenCalledWith(
        expect.stringContaining('Kein Master-PDF im Status "pending"')
      );
      expect(mockUpsertDetail).toHaveBeenCalledWith("SCI-999999.pdf", "unmatched", "");
    });
  });
});
