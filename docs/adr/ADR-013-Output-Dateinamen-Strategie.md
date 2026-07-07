## ADR-013: Output-Dateinamen-Strategie

### Status
  
Accepted

---

### Kontext
  
Die Lösung erzeugt eine neue PDF, die aus einer Master.pdf und zugehörigen Detail-PDFs zusammengesetzt wird (siehe ADR-010).

Bisherige Definitionen sahen einen statischen Output-Dateinamen vor (z. B. "Master_mit_Details_automatisch.pdf").

Probleme eines statischen Namens:
- Keine eindeutige Zuordnung zur ursprünglichen Master.pdf
- Risiko des Überschreibens bei Verarbeitung mehrerer Dateien
- Erhöhter Debugging-Aufwand (Zuordnung Input ↔ Output unklar)

Zusätzlich:
- Die Verarbeitung erfolgt in Azure Blob Storage mit getrennten Containern für Input und Output (siehe ADR-002)

---

### Entscheidung
  
Der Dateiname der Output-PDF entspricht exakt dem Dateinamen der Master-PDF.

Technisch:

```typescript
const outputFileName = inputFileName;