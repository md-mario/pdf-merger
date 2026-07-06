// Mocks müssen vor den Imports stehen
jest.mock("@azure/functions", () => ({
  app: { storageBlob: jest.fn() },
}));
jest.mock("../src/infrastructure/tableStorage");
jest.mock("../src/utils/pdfReaderAsync");

import { masterTrigger } from "../src/functions/masterTrigger";
import { upsertMasterPdfEntity } from "../src/infrastructure/tableStorage";
import { getPageTexts, extractReservationNumber } from "../src/utils/pdfReaderAsync";
import { InvocationContext } from "@azure/functions";

const mockUpsertMaster = upsertMasterPdfEntity as jest.MockedFunction<
  typeof upsertMasterPdfEntity
>;
const mockGetPageTexts = getPageTexts as jest.MockedFunction<typeof getPageTexts>;
const mockExtractReservationNumber = extractReservationNumber as jest.MockedFunction<
  typeof extractReservationNumber
>;

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

describe("Master Trigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsertMaster.mockResolvedValue(undefined);
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
    mockGetPageTexts.mockResolvedValue([
      { pageNumber: 1, text: "Kein Match hier" },
    ]);
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
      { pageNumber: 2, text: "Reservierungsnummer: 202174945" }, // Duplikat
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
});
