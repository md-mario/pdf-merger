// ADR-001: Teste pdf-parse-basierte Seitenextraktion
// Mock muss vor den Imports deklariert werden
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
            items: [
              { str: "Reservierungsnummer: 202174945" },
              { str: " " },
              { str: "Summe: Netto 100 EUR" },
            ],
          }),
        },
        {
          getTextContent: async () => ({
            items: [{ str: "Reservierungsnummer: 20169310" }, { str: " Weitere Details" }],
          }),
        },
        {
          getTextContent: async () => ({
            items: [{ str: "Summe: Netto 200 EUR" }],
          }),
        },
      ];
      if (options?.pagerender) {
        for (const page of pages) {
          await options.pagerender(page);
        }
      }
      return { text: "mock text", numpages: pages.length };
    }
  )
);

import { getPageTexts, extractReservationNumber, findMarkerPage } from "../src/utils/pdfReaderAsync";

describe("PDF Text Extractor", () => {
  it("sollte Text pro Seite extrahieren", async () => {
    const pdfBuffer = Buffer.from("mock pdf content");
    const pageTexts = await getPageTexts(pdfBuffer);

    expect(pageTexts.length).toBe(3);
    expect(pageTexts[0].pageNumber).toBe(1);
    expect(pageTexts[1].pageNumber).toBe(2);
  });

  it("sollte Marker-Seite korrekt identifizieren", async () => {
    const pdfBuffer = Buffer.from("mock pdf content");
    const pageTexts = await getPageTexts(pdfBuffer);

    expect(pageTexts.some((p) => p.text.includes("Summe: Netto"))).toBe(true);
  });

  it("sollte Reservierungsnummer aus Text extrahieren", () => {
    expect(extractReservationNumber("Reservierungsnummer: 202174945")).toBe("202174945");
    expect(extractReservationNumber("Reservierungsnummer 20169310 weitere Text")).toBe("20169310");
    expect(extractReservationNumber("Kein Match hier")).toBeNull();
  });

  it("sollte findMarkerPage korrekte Seite zurückgeben", () => {
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 2, text: "Summe: Netto 108,68 EUR weitere Details" },
    ];
    expect(findMarkerPage(pageTexts)).toBe(2);
  });

  it("sollte null zurückgeben wenn kein Marker vorhanden", () => {
    const pageTexts = [
      { pageNumber: 1, text: "Reservierungsnummer: 202174945" },
      { pageNumber: 2, text: "Keine Summe hier" },
    ];
    expect(findMarkerPage(pageTexts)).toBeNull();
  });
});
