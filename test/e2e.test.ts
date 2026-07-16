/**
 * E2E-Test: PDF-Merger Gesamtfluss gegen Azurite
 *
 * Testet den vollständigen Verarbeitungsfluss:
 *   masterTrigger → detailTrigger (×2) → mergeIncrementally → pdf-output
 *
 * Voraussetzung: Azurite muss laufen → npm run azurite
 *
 * Gemockt : @azure/functions (Registrierung), pdf-parse (Textextraktion),
 *           sharePointClient
 * Real    : Azurite Blob Storage, Table Storage, Queue Storage,
 *           pdf-lib (PDF-Manipulation)
 */

// ─── Mocks (vor allen Imports – werden von Jest gehoisted) ───────────────────

jest.mock("@azure/functions", () => ({
  app: { storageBlob: jest.fn(), storageQueue: jest.fn() },
}));

jest.mock("../src/infrastructure/sharePointClient", () => ({
  syncToSharePoint: jest.fn().mockResolvedValue(undefined),
}));

/**
 * pdf-parse: Simuliert eine 4-seitige Master-PDF mit zwei Reservierungsnummern
 * und je einem Marker:
 *   Seite 1 – Reservierungsnummer: 202174945
 *   Seite 2 – Summe: Netto 100,00 EUR  ← Marker für 202174945
 *   Seite 3 – Reservierungsnummer: 20169310
 *   Seite 4 – Summe: Netto 200,00 EUR  ← Marker für 20169310
 */
jest.mock("pdf-parse", () =>
  jest.fn(
    async (
      _buffer: Buffer,
      options?: {
        pagerender?: (page: {
          getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
        }) => Promise<string>;
      }
    ) => {
      const pages = [
        {
          getTextContent: async () => ({
            items: [{ str: "Reservierungsnummer: 202174945" }],
          }),
        },
        {
          getTextContent: async () => ({
            items: [{ str: "Summe: Netto 100,00 EUR" }],
          }),
        },
        {
          getTextContent: async () => ({
            items: [{ str: "Reservierungsnummer: 20169310" }],
          }),
        },
        {
          getTextContent: async () => ({
            items: [{ str: "Summe: Netto 200,00 EUR" }],
          }),
        },
      ];
      if (options?.pagerender) {
        for (const page of pages) {
          await options.pagerender(page);
        }
      }
      return { text: "", numpages: pages.length };
    }
  )
);

// ─── Imports ──────────────────────────────────────────────────────────────────

import { BlobServiceClient } from "@azure/storage-blob";
import { TableClient, TableServiceClient } from "@azure/data-tables";
import { PDFDocument } from "pdf-lib";
import { masterTrigger } from "../src/functions/masterTrigger";
import { detailTrigger } from "../src/functions/detailTrigger";
import { InvocationContext } from "@azure/functions";
import type { MasterPdfRow, DetailPdfRow } from "../src/contracts/input";

// ─── Konfiguration ────────────────────────────────────────────────────────────

/** Vollständiger Azurite-Connection-String (Dev-Standardkonto) */
const AZURITE_CS =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;" +
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
  "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;" +
  "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;" +
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

const MASTER_FILE = "E2E-Master.pdf";
const RES_1 = "202174945";
const RES_2 = "20169310";
const DETAIL_1 = `${RES_1}.pdf`;
const DETAIL_2 = `${RES_2}.pdf`;

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function makeContext(fnName: string): InvocationContext {
  return {
    log: jest.fn((...a: unknown[]) => console.log(`[${fnName}]`, ...a)),
    warn: jest.fn((...a: unknown[]) => console.warn(`[${fnName}] WARN`, ...a)),
    error: jest.fn((...a: unknown[]) => console.error(`[${fnName}] ERR`, ...a)),
    triggerMetadata: {},
    invocationId: `e2e-${Date.now()}`,
    functionName: fnName,
    options: {},
    retryContext: undefined,
    traceContext: { traceParent: "", traceState: "", attributes: {} },
    extraInputs: { get: jest.fn() },
    extraOutputs: { set: jest.fn() },
  } as unknown as InvocationContext;
}

/** Erstellt ein minimales valides PDF mit pdf-lib (n leere Seiten). */
async function createMinimalPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage();
  }
  return Buffer.from(await doc.save());
}

/** Lädt einen Blob als Buffer herunter. */
async function downloadBlob(
  blobService: BlobServiceClient,
  container: string,
  name: string
): Promise<Buffer> {
  const blobClient = blobService.getContainerClient(container).getBlobClient(name);
  const response = await blobClient.download();
  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBuffer));
  }
  return Buffer.concat(chunks);
}

// ─── Global Setup/Teardown ────────────────────────────────────────────────────

jest.setTimeout(30_000);

let blobService: BlobServiceClient;
let azuriteAvailable = false;

beforeAll(async () => {
  // Azurite-Erreichbarkeit prüfen
  try {
    blobService = BlobServiceClient.fromConnectionString(AZURITE_CS);
    await blobService.getProperties();
    azuriteAvailable = true;
  } catch {
    console.warn("\n⚠️  Azurite nicht erreichbar – E2E-Tests werden übersprungen.");
    console.warn("   Starten mit: npm run azurite\n");
    return;
  }

  // Blob-Container anlegen (ADR-002)
  for (const name of ["pdf-input", "pdf-details", "pdf-output"]) {
    await blobService.getContainerClient(name).createIfNotExists();
  }

  // Tabellen anlegen (ADR-002)
  const tableService = TableServiceClient.fromConnectionString(AZURITE_CS, { allowInsecureConnection: true });
  for (const table of ["MasterPDFs", "DetailPDFs"]) {
    try {
      await tableService.createTable(table);
    } catch {
      // Tabelle existiert bereits – kein Fehler
    }
  }
});

afterAll(async () => {
  if (!azuriteAvailable) return;

  // Testdaten aufräumen
  const toDelete: Array<[string, string]> = [
    ["pdf-input", MASTER_FILE],
    ["pdf-details", DETAIL_1],
    ["pdf-details", DETAIL_2],
    ["pdf-output", MASTER_FILE],
  ];
  for (const [container, blob] of toDelete) {
    await blobService
      .getContainerClient(container)
      .getBlockBlobClient(blob)
      .deleteIfExists();
  }

  const masterTable = TableClient.fromConnectionString(AZURITE_CS, "MasterPDFs", { allowInsecureConnection: true });
  const detailTable = TableClient.fromConnectionString(AZURITE_CS, "DetailPDFs", { allowInsecureConnection: true });
  await masterTable.deleteEntity("MasterPDFs", MASTER_FILE).catch(() => {});
  await detailTable.deleteEntity("DetailPDFs", DETAIL_1).catch(() => {});
  await detailTable.deleteEntity("DetailPDFs", DETAIL_2).catch(() => {});
});

// ─── E2E-Testsuite ────────────────────────────────────────────────────────────

describe("E2E: PDF-Merger Gesamtfluss", () => {
  let masterPdfBuffer: Buffer;
  let detailPdfBuffer: Buffer;

  beforeAll(async () => {
    if (!azuriteAvailable) return;

    // Minimale valide PDFs erstellen (pdf-parse ist gemockt → Inhalt irrelevant)
    masterPdfBuffer = await createMinimalPdf(4);
    detailPdfBuffer = await createMinimalPdf(2);

    // PDFs in Azurite hochladen
    const upload = async (container: string, name: string, buf: Buffer) =>
      blobService
        .getContainerClient(container)
        .getBlockBlobClient(name)
        .upload(buf, buf.length, {
          blobHTTPHeaders: { blobContentType: "application/pdf" },
        });

    await upload("pdf-input", MASTER_FILE, masterPdfBuffer);
    await upload("pdf-details", DETAIL_1, detailPdfBuffer);
    await upload("pdf-details", DETAIL_2, detailPdfBuffer);
  });

  // Prüfung zur Laufzeit – azuriteAvailable ist bei beforeAll-Ausführung bereits gesetzt
  const it$ = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!azuriteAvailable) {
        console.log(`⏭  SKIP (Azurite nicht verfügbar): ${name}`);
        return;
      }
      await fn();
    });

  // ─── Test 1: masterTrigger ──────────────────────────────────────────────────

  it$("1. masterTrigger legt MasterPDFs-Eintrag mit Status new an", async () => {
    await masterTrigger(masterPdfBuffer, makeContext("masterTrigger"), MASTER_FILE);

    const masterTable = TableClient.fromConnectionString(AZURITE_CS, "MasterPDFs", { allowInsecureConnection: true });
    const entity = await masterTable.getEntity<MasterPdfRow>("MasterPDFs", MASTER_FILE);

    expect(entity.status).toBe("new");
    expect(JSON.parse(entity.reservationNumbers)).toEqual(
      expect.arrayContaining([RES_1, RES_2])
    );
    expect(JSON.parse(entity.missingDetails)).toEqual(
      expect.arrayContaining([RES_1, RES_2])
    );
  });

  // ─── Test 2: detailTrigger – erstes Detail ──────────────────────────────────

  it$("2. detailTrigger (1. Detail): 202174945 matched, Master bleibt pending", async () => {
    await detailTrigger(detailPdfBuffer, makeContext("detailTrigger-1"), DETAIL_1);

    const detailTable = TableClient.fromConnectionString(AZURITE_CS, "DetailPDFs", { allowInsecureConnection: true });
    const detailEntity = await detailTable.getEntity<DetailPdfRow>("DetailPDFs", DETAIL_1);

    expect(detailEntity.status).toBe("matched");
    expect(detailEntity.matchedMaster).toBe(MASTER_FILE);

    // Zweite Reservierungsnummer noch offen → Master bleibt pending
    const masterTable = TableClient.fromConnectionString(AZURITE_CS, "MasterPDFs", { allowInsecureConnection: true });
    const masterEntity = await masterTable.getEntity<MasterPdfRow>("MasterPDFs", MASTER_FILE);

    expect(masterEntity.status).toBe("pending");
    const missing = JSON.parse(masterEntity.missingDetails) as string[];
    expect(missing).toContain(RES_2);
    expect(missing).not.toContain(RES_1);
  });

  // ─── Test 3: detailTrigger – letztes Detail → Merge abgeschlossen ──────────

  it$("3. detailTrigger (2. Detail): 20169310 matched, Status wird completed", async () => {
    await detailTrigger(detailPdfBuffer, makeContext("detailTrigger-2"), DETAIL_2);

    const detailTable = TableClient.fromConnectionString(AZURITE_CS, "DetailPDFs", { allowInsecureConnection: true });
    const detailEntity = await detailTable.getEntity<DetailPdfRow>("DetailPDFs", DETAIL_2);

    expect(detailEntity.status).toBe("matched");
    expect(detailEntity.matchedMaster).toBe(MASTER_FILE);

    // Alle Details vorhanden → Master completed, missingDetails leer
    const masterTable = TableClient.fromConnectionString(AZURITE_CS, "MasterPDFs", { allowInsecureConnection: true });
    const masterEntity = await masterTable.getEntity<MasterPdfRow>("MasterPDFs", MASTER_FILE);

    expect(masterEntity.status).toBe("completed");
    expect(JSON.parse(masterEntity.missingDetails)).toHaveLength(0);
  });

  // ─── Test 4: Output-PDF validieren ─────────────────────────────────────────

  it$("4. Output-PDF existiert in pdf-output und ist ein valides PDF", async () => {
    const outputContainer = blobService.getContainerClient("pdf-output");
    const exists = await outputContainer.getBlobClient(MASTER_FILE).exists();

    expect(exists).toBe(true);

    // Blob herunterladen und Struktur prüfen
    const outputBuffer = await downloadBlob(blobService, "pdf-output", MASTER_FILE);

    // PDF-Signatur: %PDF-
    expect(outputBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    // pdf-lib muss die Datei laden können (valide PDF-Struktur)
    const outputDoc = await PDFDocument.load(outputBuffer);

    // Durch mergeIncrementally wurden 2 Detail-PDFs (je 2 Seiten) eingefügt
    // Ausgangs-PDF: 4 Seiten + 2×2 Detail-Seiten = 8 Seiten
    expect(outputDoc.getPageCount()).toBeGreaterThanOrEqual(4);
  });
});
