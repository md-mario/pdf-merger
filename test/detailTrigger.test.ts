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
import { mergeWithMarker } from "../src/services/pdf-merger";
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
const mockMerge = mergeWithMarker as jest.MockedFunction<typeof mergeWithMarker>;

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
    mockUpdateMissing.mockResolvedValue(["20169310"]); // 20169310 noch fehlend
    mockUpsertDetail.mockResolvedValue(undefined);
    mockMerge.mockResolvedValue({
      outputFileName: "Master_mit_Details_automatisch.pdf",
      processedDatasets: 2,
      warnings: [],
    });
  });

  it("sollte DetailPDFs-Eintrag als matched speichern und missingDetails aktualisieren", async () => {
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "202174945.pdf");

    expect(mockUpsertDetail).toHaveBeenCalledWith("202174945.pdf", "matched", "Master.pdf");
    expect(mockUpdateMissing).toHaveBeenCalledWith("Master.pdf", "202174945");
  });

  it("sollte Merge nicht starten wenn noch Details fehlen", async () => {
    mockUpdateMissing.mockResolvedValue(["20169310"]); // noch offen
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "202174945.pdf");

    expect(mockMerge).not.toHaveBeenCalled();
  });

  it("sollte Merge starten wenn alle Details vorhanden sind", async () => {
    mockUpdateMissing.mockResolvedValue([]); // alle Details vorhanden
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "20169310.pdf");

    expect(mockMerge).toHaveBeenCalledWith(
      "Master.pdf",
      ["202174945", "20169310"],
      context
    );
  });

  it("sollte Warnung ausgeben und als unmatched speichern wenn kein Master gefunden", async () => {
    mockListPending.mockResolvedValue([]); // kein passender Master
    const context = createMockContext();
    await detailTrigger(Buffer.from("mock"), context, "999999.pdf");

    expect(context.warn).toHaveBeenCalledWith(
      expect.stringContaining('Kein Master-PDF im Status "pending"')
    );
    expect(mockUpsertDetail).toHaveBeenCalledWith("999999.pdf", "unmatched", "");
    expect(mockMerge).not.toHaveBeenCalled();
  });
});
