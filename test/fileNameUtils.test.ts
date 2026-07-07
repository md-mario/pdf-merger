import { normalizeFileName } from "../src/utils/fileNameUtils";

describe("normalizeFileName (ADR-015)", () => {
  it("sollte SCI-Präfix entfernen", () => {
    expect(normalizeFileName("SCI-201468964.pdf")).toBe("201468964.pdf");
  });

  it("sollte SCI-Präfix bei Master-Dateien entfernen", () => {
    expect(normalizeFileName("SCI-Master.pdf")).toBe("Master.pdf");
  });

  it("sollte Dateinamen ohne Präfix unverändert lassen", () => {
    expect(normalizeFileName("201468964.pdf")).toBe("201468964.pdf");
    expect(normalizeFileName("Master.pdf")).toBe("Master.pdf");
  });

  it("sollte nur das führende SCI- entfernen, nicht mittendrin", () => {
    expect(normalizeFileName("report-SCI-123.pdf")).toBe("report-SCI-123.pdf");
  });

  it("sollte leere Zeichenkette unverändert lassen", () => {
    expect(normalizeFileName("")).toBe("");
  });
});
