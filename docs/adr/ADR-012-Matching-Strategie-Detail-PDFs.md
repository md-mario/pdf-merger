## ADR-012: Matching-Strategie für Detail-PDFs

### Status
  
Accepted

### Kontext
  
Die Lösung verarbeitet eine **Master.pdf**, aus der **Reservierungsnummern** extrahiert werden (siehe ADR-001 und ADR-006).

Zusätzlich existieren **Detail-PDFs**, die anhand der Reservierungsnummer den Datensätzen zugeordnet werden müssen.

Problem:
- Die **Reservierungsnummer in der Master.pdf** stimmt **nicht exakt** mit dem Dateinamen der Detail-PDF überein.
- Stattdessen enthält der Dateiname eine **erweiterte Variante** der Reservierungsnummer.

Beispiel:
- Reservierungsnummer (Master.pdf): `20146896`
- Detail-PDF: `201468964.pdf`

Anforderung:
- Eine robuste Zuordnung zwischen Master-Datensatz und Detail-PDF.


### Supersedes
- ADR-006 (Teilbereich: detailPdfName Matching)


---

### Entscheidung
  
Verwendung eines **Prefix-Matchings** zur Zuordnung der Detail-PDFs:

- Eine Detail-PDF wird einem Datensatz zugeordnet, wenn:
  
```text
Dateiname beginnt mit der Reservierungsnummer
