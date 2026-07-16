jest.mock("@azure/functions", () => ({
  app: { storageQueue: jest.fn() },
}));
jest.mock("../src/infrastructure/sharePointClient");
jest.mock("../src/infrastructure/tableStorage");

import { postProcessTrigger } from "../src/functions/postProcessTrigger";
import { syncToSharePoint } from "../src/infrastructure/sharePointClient";
import { getMasterPdfEntity, saveSharePointItemId } from "../src/infrastructure/tableStorage";
import { MasterPdfEvent } from "../src/models/masterPdfEvent";
import { MasterPdfRow } from "../src/contracts/input";
import { InvocationContext } from "@azure/functions";

const mockSyncToSharePoint = syncToSharePoint as jest.MockedFunction<typeof syncToSharePoint>;
const mockGetEntity = getMasterPdfEntity as jest.MockedFunction<typeof getMasterPdfEntity>;
const mockSaveItemId = saveSharePointItemId as jest.MockedFunction<typeof saveSharePointItemId>;

function createMockContext(): InvocationContext {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    invocationId: "test-invocation",
    functionName: "postProcessTrigger",
    options: {},
    retryContext: undefined,
    traceContext: { traceParent: "", traceState: "", attributes: {} },
    extraInputs: { get: jest.fn() },
    extraOutputs: { set: jest.fn() },
  } as unknown as InvocationContext;
}

const pendingEvent: MasterPdfEvent = {
  eventType: "MasterPdfUpserted",
  timestamp: "2026-07-08T10:00:00Z",
  partitionKey: "MasterPDFs",
  rowKey: "Master.pdf",
  masterPdfName: "Master.pdf",
  status: "pending",
  missingDetails: ["202174945"],
  missingDetailCount: 1,
  downloadPath: "/api/download/Master.pdf",
};

const completedEvent: MasterPdfEvent = {
  ...pendingEvent,
  status: "completed",
  missingDetails: [],
  missingDetailCount: 0,
};

const entityWithoutItemId: MasterPdfRow = {
  partitionKey: "MasterPDFs",
  rowKey: "Master.pdf",
  status: "pending",
  reservationNumbers: JSON.stringify(["202174945"]),
  missingDetails: JSON.stringify(["202174945"]),
};

const entityWithItemId: MasterPdfRow = {
  ...entityWithoutItemId,
  sharePointItemId: "existing-sp-item-123",
};

describe("postProcessTrigger (ADR-017)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEntity.mockResolvedValue(entityWithoutItemId);
    mockSyncToSharePoint.mockResolvedValue("new-sp-item-456");
    mockSaveItemId.mockResolvedValue(undefined);
  });

  it("sollte SharePoint-Sync aufrufen (pending)", async () => {
    const context = createMockContext();
    await postProcessTrigger(pendingEvent, context);
    expect(mockSyncToSharePoint).toHaveBeenCalledWith(pendingEvent, undefined);
  });

  it("sollte SharePoint-Sync aufrufen (completed)", async () => {
    const context = createMockContext();
    await postProcessTrigger(completedEvent, context);
    expect(mockSyncToSharePoint).toHaveBeenCalledWith(completedEvent, undefined);
  });

  it("sollte gespeicherte SharePoint-Item-ID an syncToSharePoint übergeben (ADR-020)", async () => {
    mockGetEntity.mockResolvedValue(entityWithItemId);
    const context = createMockContext();
    await postProcessTrigger(pendingEvent, context);
    expect(mockSyncToSharePoint).toHaveBeenCalledWith(pendingEvent, "existing-sp-item-123");
  });

  it("sollte neue SharePoint-Item-ID speichern wenn noch keine vorhanden (ADR-020)", async () => {
    const context = createMockContext();
    await postProcessTrigger(pendingEvent, context);
    expect(mockSaveItemId).toHaveBeenCalledWith("Master.pdf", "new-sp-item-456");
  });

  it("sollte keine Item-ID speichern wenn bereits eine vorhanden ist (ADR-020)", async () => {
    mockGetEntity.mockResolvedValue(entityWithItemId);
    const context = createMockContext();
    await postProcessTrigger(pendingEvent, context);
    expect(mockSaveItemId).not.toHaveBeenCalled();
  });

  it("sollte den Fehler weiterwerfen wenn SharePoint-Sync fehlschlägt (ADR-017: Retry)", async () => {
    mockSyncToSharePoint.mockRejectedValue(new Error("SharePoint not available"));
    const context = createMockContext();
    await expect(postProcessTrigger(pendingEvent, context)).rejects.toThrow("SharePoint not available");
    expect(context.error).toHaveBeenCalled();
  });

  it("sollte Erfolg loggen nach SharePoint-Sync", async () => {
    const context = createMockContext();
    await postProcessTrigger(completedEvent, context);
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining("SharePoint-Sync abgeschlossen")
    );
  });
});
