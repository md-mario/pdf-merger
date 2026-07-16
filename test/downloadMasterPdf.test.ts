jest.mock("@azure/functions", () => ({
  app: { http: jest.fn() },
}));
jest.mock("../src/infrastructure/tableStorage");
jest.mock("../src/infrastructure/blobStorage");

import { downloadMasterPdf } from "../src/functions/downloadMasterPdf";
import { getMasterPdfEntity } from "../src/infrastructure/tableStorage";
import { blobExists, createReadOnlySasUrl } from "../src/infrastructure/blobStorage";
import { MasterPdfRow } from "../src/contracts/input";
import { HttpRequest, InvocationContext } from "@azure/functions";

const mockGetEntity = getMasterPdfEntity as jest.MockedFunction<typeof getMasterPdfEntity>;
const mockBlobExists = blobExists as jest.MockedFunction<typeof blobExists>;
const mockCreateSasUrl = createReadOnlySasUrl as jest.MockedFunction<typeof createReadOnlySasUrl>;

function createMockContext(): InvocationContext {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    invocationId: "test-invocation",
    functionName: "downloadMasterPdf",
    options: {},
    retryContext: undefined,
    traceContext: { traceParent: "", traceState: "", attributes: {} },
    extraInputs: { get: jest.fn() },
    extraOutputs: { set: jest.fn() },
  } as unknown as InvocationContext;
}

function createMockRequest(rowKey?: string): HttpRequest {
  return {
    params: rowKey ? { rowKey } : {},
    headers: new Headers(),
    url: `http://localhost/api/download/${rowKey ?? ""}`,
    method: "GET",
  } as unknown as HttpRequest;
}

const completedEntity: MasterPdfRow = {
  partitionKey: "MasterPDFs",
  rowKey: "Master.pdf",
  status: "completed",
  reservationNumbers: JSON.stringify(["202174945"]),
  missingDetails: JSON.stringify([]),
};

describe("downloadMasterPdf (ADR-018)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEntity.mockResolvedValue(completedEntity);
    mockBlobExists.mockResolvedValue(true);
    mockCreateSasUrl.mockResolvedValue("https://storage.example.com/pdf-output/Master.pdf?sas=token");
  });

  it("sollte 400 zurückgeben wenn kein rowKey angegeben", async () => {
    const result = await downloadMasterPdf(createMockRequest(), createMockContext());
    expect(result.status).toBe(400);
  });

  it("sollte 404 zurückgeben wenn Entity nicht gefunden", async () => {
    mockGetEntity.mockResolvedValue(null);
    const result = await downloadMasterPdf(createMockRequest("Master.pdf"), createMockContext());
    expect(result.status).toBe(404);
  });

  it("sollte 409 zurückgeben wenn Status 'new'", async () => {
    mockGetEntity.mockResolvedValue({ ...completedEntity, status: "new" });
    const result = await downloadMasterPdf(createMockRequest("Master.pdf"), createMockContext());
    expect(result.status).toBe(409);
  });

  it("sollte 302 zurückgeben wenn Status 'pending' (partielles Output vorhanden)", async () => {
    mockGetEntity.mockResolvedValue({ ...completedEntity, status: "pending" });
    const result = await downloadMasterPdf(createMockRequest("Master.pdf"), createMockContext());
    expect(result.status).toBe(302);
  });

  it("sollte 404 zurückgeben wenn Blob nicht existiert", async () => {
    mockBlobExists.mockResolvedValue(false);
    const result = await downloadMasterPdf(createMockRequest("Master.pdf"), createMockContext());
    expect(result.status).toBe(404);
  });

  it("sollte 302 Redirect mit SAS-URL zurückgeben bei Erfolg (ADR-018)", async () => {
    const result = await downloadMasterPdf(createMockRequest("Master.pdf"), createMockContext());
    expect(result.status).toBe(302);
    const location = (result.headers as Record<string, string>)?.["Location"];
    expect(location).toBe("https://storage.example.com/pdf-output/Master.pdf?sas=token");
  });

  it("sollte SAS-URL mit korrektem Container und Blob-Name erzeugen", async () => {
    await downloadMasterPdf(createMockRequest("Master.pdf"), createMockContext());
    expect(mockCreateSasUrl).toHaveBeenCalledWith("pdf-output", "Master.pdf", 5);
  });

  it("sollte SAS-Token nicht loggen", async () => {
    const context = createMockContext();
    await downloadMasterPdf(createMockRequest("Master.pdf"), context);
    const logCalls = (context.log as jest.Mock).mock.calls.flat().join(" ");
    expect(logCalls).not.toContain("sas=token");
  });
});
