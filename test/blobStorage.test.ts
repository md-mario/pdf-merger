// ADR-011: Tests für Blob Storage Lease (acquireOutputBlobLease)
// ADR-010: Tests für downloadBlobIfExists, uploadBlobIfNotExists
jest.mock("@azure/storage-blob");

import { BlobServiceClient } from "@azure/storage-blob";
import {
  downloadBlobIfExists,
  acquireOutputBlobLease,
  uploadBlobWithLease,
  uploadBlobIfNotExists,
} from "../src/infrastructure/blobStorage";

// ─── Mock-Infrastruktur ───────────────────────────────────────────────────────

const mockReleaseLease = jest.fn().mockResolvedValue(undefined);
const mockAcquireLease = jest.fn();
const mockLeaseClient = {
  acquireLease: mockAcquireLease,
  releaseLease: mockReleaseLease,
  leaseId: "mock-lease-id",
};

const mockBlobExists = jest.fn();
const mockDownload = jest.fn();
const mockUpload = jest.fn();
const mockBlobClient = {
  exists: mockBlobExists,
  download: mockDownload,
  getBlobLeaseClient: jest.fn().mockReturnValue(mockLeaseClient),
};
const mockBlockBlobClient = {
  upload: mockUpload,
};
const mockContainerClient = {
  getBlobClient: jest.fn().mockReturnValue(mockBlobClient),
  getBlockBlobClient: jest.fn().mockReturnValue(mockBlockBlobClient),
};

(BlobServiceClient.fromConnectionString as jest.Mock).mockReturnValue({
  getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
});

// ─── downloadBlobIfExists ─────────────────────────────────────────────────────

describe("downloadBlobIfExists", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sollte Buffer zurückgeben wenn Blob existiert", async () => {
    mockBlobExists.mockResolvedValue(true);
    const chunks = [Buffer.from("PDF-Inhalt")];
    mockDownload.mockResolvedValue({
      readableStreamBody: {
        on: (event: string, cb: (chunk?: unknown) => void) => {
          if (event === "data") chunks.forEach((c) => cb(c));
          if (event === "end") cb();
          return { on: jest.fn() };
        },
      },
    });

    const result = await downloadBlobIfExists("pdf-output", "output.pdf");
    expect(result).not.toBeNull();
    expect(result?.toString()).toBe("PDF-Inhalt");
  });

  it("sollte null zurückgeben wenn Blob nicht existiert", async () => {
    mockBlobExists.mockResolvedValue(false);
    const result = await downloadBlobIfExists("pdf-output", "output.pdf");
    expect(result).toBeNull();
    expect(mockDownload).not.toHaveBeenCalled();
  });
});

// ─── acquireOutputBlobLease (ADR-011) ────────────────────────────────────────

describe("acquireOutputBlobLease", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sollte Lease beim ersten Versuch erwerben", async () => {
    mockAcquireLease.mockResolvedValue(undefined);

    const lease = await acquireOutputBlobLease("pdf-output", "output.pdf");

    expect(mockAcquireLease).toHaveBeenCalledTimes(1);
    expect(mockAcquireLease).toHaveBeenCalledWith(30);
    expect(lease.leaseId).toBe("mock-lease-id");
  });

  it("sollte bei 409 (LeaseAlreadyPresent) retry durchführen (ADR-011)", async () => {
    const leaseConflict = Object.assign(new Error("Conflict"), { statusCode: 409 });
    mockAcquireLease
      .mockRejectedValueOnce(leaseConflict)
      .mockRejectedValueOnce(leaseConflict)
      .mockResolvedValueOnce(undefined); // dritter Versuch erfolgreich

    const lease = await acquireOutputBlobLease("pdf-output", "output.pdf", 30, 5, 0);

    expect(mockAcquireLease).toHaveBeenCalledTimes(3);
    expect(lease.leaseId).toBe("mock-lease-id");
  });

  it("sollte nach maxRetries einen Fehler werfen", async () => {
    const leaseConflict = Object.assign(new Error("Conflict"), { statusCode: 409 });
    mockAcquireLease.mockRejectedValue(leaseConflict);

    await expect(
      acquireOutputBlobLease("pdf-output", "output.pdf", 30, 3, 0)
    ).rejects.toThrow("Blob-Lease nicht verfügbar nach 3 Versuchen");
  });

  it("sollte nicht-409-Fehler sofort weiterwerfen", async () => {
    const notFoundError = Object.assign(new Error("Not Found"), { statusCode: 404 });
    mockAcquireLease.mockRejectedValue(notFoundError);

    await expect(
      acquireOutputBlobLease("pdf-output", "output.pdf", 30, 5, 0)
    ).rejects.toThrow("Not Found");
    expect(mockAcquireLease).toHaveBeenCalledTimes(1);
  });

  it("sollte release()-Funktion zurückgeben die die Lease freigibt", async () => {
    mockAcquireLease.mockResolvedValue(undefined);
    const lease = await acquireOutputBlobLease("pdf-output", "output.pdf");

    await lease.release();
    expect(mockReleaseLease).toHaveBeenCalled();
  });
});

// ─── uploadBlobWithLease (ADR-011) ────────────────────────────────────────────

describe("uploadBlobWithLease", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sollte Blob mit Lease-Bedingung hochladen", async () => {
    mockUpload.mockResolvedValue(undefined);
    const data = Buffer.from("%PDF-1.4");

    await uploadBlobWithLease("pdf-output", "output.pdf", data, "my-lease-id");

    expect(mockUpload).toHaveBeenCalledWith(data, data.length, expect.objectContaining({
      conditions: { leaseId: "my-lease-id" },
    }));
  });
});

// ─── uploadBlobIfNotExists (ADR-010) ─────────────────────────────────────────

describe("uploadBlobIfNotExists", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sollte Blob mit ifNoneMatch-Bedingung hochladen", async () => {
    mockUpload.mockResolvedValue(undefined);
    const data = Buffer.from("%PDF-1.4");

    await uploadBlobIfNotExists("pdf-output", "output.pdf", data);

    expect(mockUpload).toHaveBeenCalledWith(data, data.length, expect.objectContaining({
      conditions: { ifNoneMatch: "*" },
    }));
  });

  it("sollte 412-Fehler (Blob already exists) weiterwerfen", async () => {
    const conflictError = Object.assign(new Error("Precondition Failed"), { statusCode: 412 });
    mockUpload.mockRejectedValue(conflictError);

    await expect(
      uploadBlobIfNotExists("pdf-output", "output.pdf", Buffer.from("data"))
    ).rejects.toThrow("Precondition Failed");
  });
});
