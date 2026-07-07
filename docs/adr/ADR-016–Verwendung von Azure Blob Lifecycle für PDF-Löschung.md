# ADR 016 – Verwendung von Azure Blob Lifecycle für PDF-Löschung

## Status
Accepted

---

## Kontext

Im System werden PDF-Dateien im Azure Blob Storage abgelegt.  
Diese umfassen folgende Typen:

- Detail-PDF
- Master-PDF

Für diese Dateien besteht die Anforderung:

- Automatische Löschung nach einer definierten Anzahl von Tagen
- Unterschiedliche Aufbewahrungsdauer für Detail- und Master-PDFs
- Konfigurierbarkeit der Aufbewahrungsdauer

Zusätzlich gelten folgende Rahmenbedingungen:

- Der Löschprozess muss vollständig automatisiert erfolgen
- Der Betrieb soll wartungsarm und skalierbar sein
- Es dürfen keine zusätzlichen Services zur Datenbereinigung eingeführt werden

---

## Entscheidung

Für die automatische Löschung von PDF-Dateien wird der **Native Azure Blob Lifecycle** verwendet.

---

## Konkretisierung der Entscheidung

### Lifecycle-Strategie

- Der Azure Blob Lifecycle wird als zentrale Löschmechanik eingesetzt
- Die Löschung erfolgt basierend auf dem Alter der Dateien

---

### Konfiguration der Aufbewahrungsdauer

- Die TTL (Time To Live) wird pro PDF-Typ statisch definiert
- Es werden zwei getrennte Konfigurationswerte verwendet:

  - `DETAIL_PDF_TTL_DAYS`
  - `MASTER_PDF_TTL_DAYS`

- Die Konfiguration erfolgt ausschließlich auf Infrastruktur-Ebene (z. B. IaC)

---

### Klassifizierung der Dateien

Damit Lifecycle-Regeln angewendet werden können, müssen PDFs eindeutig unterscheidbar sein.

Dies erfolgt über:

- Prefix (z. B. Container- oder Pfadstruktur)  
  **oder**
- Blob Index Tags (z. B. `type=detail`, `type=master`)

---

### Lifecycle-Regeln

- Für jeden PDF-Typ wird eine eigene Lifecycle-Regel definiert
- Jede Regel besteht aus:
  - Filter (Prefix oder Tag)
  - TTL (Tage bis zur Löschung)

---

## Nicht erlaubte Nutzung

Die folgenden Szenarien sind explizit ausgeschlossen:

- Dynamische TTL pro Dokument  
  (z. B. individuelle Ablaufdaten je Datei)

- Businesslogische Löschentscheidungen im Lifecycle  
  (z. B. abhängig von Status, Kunde oder Prozesszustand)

---

## Begründung

### Nutzung nativer Plattformfunktionalität

Der Azure Blob Lifecycle ist eine vollständig gemanagte, skalierbare Funktion der Plattform und benötigt keinen zusätzlichen Betriebsaufwand.

---

### Reduktion technischer Komplexität

Durch den Einsatz des nativen Lifecycle:

- entfällt die Notwendigkeit zusätzlicher Services
- entfällt Scheduling- und Job-Logik
- wird die Architektur vereinfacht

---

### Trennung von Verantwortung

- Lifecycle = technische Datenaufbewahrung
- Anwendung = Business-Logik

Diese klare Trennung verhindert Vermischung von Infrastruktur und Fachlogik.

---

### Deterministisches Verhalten

Die Löschregeln sind:

- deklarativ definiert
- transparent nachvollziehbar
- eindeutig testbar

---

## Konsequenzen

### Positive

- Kein zusätzlicher Cleanup-Prozess erforderlich
- Minimaler Betriebsaufwand
- Hohe Skalierbarkeit
- Klare und einfache Regeldefinition
- Vorhersehbares Verhalten durch deklarative Policies

---

### Negative

- TTL ist nicht dynamisch pro Dokument anpassbar
- Änderungen der TTL erfordern Anpassung der Lifecycle-Policy (Deployment)
- Keine Unterstützung komplexer Business-Logik

---

### Technische Implikationen

- Jede PDF-Datei muss eindeutig klassifizierbar sein
- Lifecycle-Regeln müssen separat gepflegt werden für:
  - Detail-PDF
  - Master-PDF

- TTL wird als Infrastruktur-Konfiguration behandelt

---

## Architekturregel

> Der Blob Storage dient als temporärer Speicher.  
> Persistenz mit fachlicher Relevanz darf nicht vom Lifecycle abhängig sein.

---

## Risiken

- Falsch konfigurierte TTL kann zu Datenverlust führen
- Fehlende Klassifizierung verhindert korrekte Löschung

---

## Nächste Schritte

- Definition der Klassifizierungsstrategie (Prefix vs. Tags)
- Implementierung der Lifecycle-Policy im Storage Account
- Integration der TTL-Werte in Infrastruktur (z. B. Terraform oder Bicep)
- Validierung in Testumgebung mit verkürzten TTLs
