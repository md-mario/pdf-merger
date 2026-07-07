# Scope: PDF-Merger mit dynamischer Detail-PDF-Einbindung

## Ziel
Erstellung einer vollautomatischen TypeScript-Lösung, die mehrere Detail-PDFs dynamisch in eine `Master.pdf` einfügt, basierend auf Reservierungsnummern und dem Marker `"Summe: Netto X EUR"`.

---

## Funktionale Anforderungen

### 1. Input-Verarbeitung
- [ ] Extraktion von Text aus der `Master.pdf` (seitenweise).
- [ ] Erkennung von Reservierungsnummern im Format `Reservierungsnummer: \d+` pro Seite.
- [ ] Erkennung des Markers `"Summe: Netto X EUR"` (unabhängig vom Betrag `X`).

### 2. Detail-PDF-Zuordnung
- [ ] Suche nach Detail-PDFs im selben Ordner wie `Master.pdf`, benannt nach der Reservierungsnummer (z. B. `202174945.pdf`).
- [ ] Einfügen der Detail-PDF **nach der Seite**, auf der der Marker `"Summe: Netto X EUR"` gefunden wurde.

### 3. Output
- [ ] Erstellung einer neuen PDF (`output/<Name_der_Master-PDF>`) mit allen eingefügten Detail-PDFs.
- [ ] Warnung im Log, falls eine Detail-PDF nicht existiert (Fortsetzung des Skripts).

---

## Nicht-funktionale Anforderungen
- Laufzeitumgebung: **Azure Function App (Node.js 20)**.
- Fehlertoleranz: Warnung bei fehlenden Detail-PDFs, Abbruch nur bei kritischen Fehlern (z. B. `Master.pdf` nicht gefunden).
- Performance:
  - Maximal 100 Seiten pro `Master.pdf`.
  - Maximal 50 MB pro PDF.
  - Zeitlimit: 5 Minuten pro Verarbeitung.
- Logging: Protokollierung aller Schritte (z. B. gefundene Reservierungsnummern, fehlende PDFs).

---

## Akzeptanzkriterien (GIVEN-WHEN-THEN)

| ID  | Beschreibung                                                                                     |
|-----|-------------------------------------------------------------------------------------------------|
| AC1 | GIVEN eine `Master.pdf` mit 1 Datensatz (Reservierungsnummer `202174945` und Marker `"Summe: Netto 100 EUR"` auf Seite 1) AND eine Detail-PDF `202174945.pdf` existiert WHEN das Skript ausgeführt wird THEN enthält die Ausgabe-PDF die Detail-PDF nach Seite 1. |
| AC2 | GIVEN eine `Master.pdf` mit 2 Datensätzen (Reservierungsnummern `202174945` und `20169310`, Marker auf Seite 1 und 3) AND Detail-PDFs `202174945.pdf` und `20169310.pdf` existieren WHEN das Skript ausgeführt wird THEN enthält die Ausgabe-PDF beide Detail-PDFs nach den jeweiligen Marker-Seiten. |
| AC3 | GIVEN eine `Master.pdf` mit einem Datensatz (Reservierungsnummer `202174945`, Marker auf Seite 2) AND die Detail-PDF `202174945.pdf` **existiert nicht** WHEN das Skript ausgeführt wird THEN wird eine Warnung geloggt AND die Verarbeitung wird fortgesetzt. |
| AC4 | GIVEN eine `Master.pdf` **existiert nicht** WHEN das Skript ausgeführt wird THEN wird ein Fehler geloggt AND das Skript bricht ab. |
| AC5 | GIVEN eine `Master.pdf` mit einem Datensatz, bei dem die Reservierungsnummer auf Seite 1 und der Marker auf Seite 2 steht WHEN das Skript ausgeführt wird THEN wird die Detail-PDF nach Seite 2 eingefügt. |

---

## Nicht-Ziele
- [ ] Keine manuelle Nachbearbeitung der PDFs.
- [ ] Keine GUI oder Benutzeroberfläche.
- [ ] Keine Unterstützung für andere Marker als `"Summe: Netto X EUR"`.
- [ ] Keine Verarbeitung von PDFs außerhalb des Ordners der `Master.pdf`.

---

## Abgrenzung
- Die Lösung verarbeitet **nur** PDFs im selben Ordner wie `Master.pdf`.
- Detail-PDFs **müssen** exakt nach der Reservierungsnummer benannt sein (z. B. `202174945.pdf`).
- Die Reservierungsnummer und der Marker können auf **unterschiedlichen Seiten** stehen. In diesem Fall wird die **letzte erkannt Reservierungsnummer** verwendet.