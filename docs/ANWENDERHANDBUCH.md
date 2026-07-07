# Anwenderhandbuch – PDF-Merger

**Version:** 1.0  
**Umgebung:** Azure (Dev: `pdfmerger-dev-rg`, West Europe)  
**Letzte Aktualisierung:** 2026-07-07

---

## Inhaltsverzeichnis

1. [Systemübersicht](#1-systemübersicht)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Dateinamen-Konventionen](#3-dateinamen-konventionen)
4. [Verarbeitungsszenarien](#4-verarbeitungsszenarien)
5. [Schritt-für-Schritt: Dateien hochladen](#5-schritt-für-schritt-dateien-hochladen)
6. [Verarbeitungsablauf im Detail](#6-verarbeitungsablauf-im-detail)
7. [Ergebnis abrufen](#7-ergebnis-abrufen)
8. [Automatische Dateilöschung](#8-automatische-dateilöschung)
9. [Status und Monitoring](#9-status-und-monitoring)
10. [Fehlerfälle und Verhalten](#10-fehlerfälle-und-verhalten)
11. [Technische Referenz](#11-technische-referenz)

---

## 1. Systemübersicht

Der **PDF-Merger** ist ein vollautomatischer Azure-Dienst, der **Detail-PDFs** (z. B. Rechnungsseiten) nach Reservierungsnummer in eine **Master-PDF** einfügt.

```
         pdf-input/           pdf-details/          pdf-output/
         ──────────           ────────────          ───────────
         Master.pdf    ──►    202174945.pdf   ──►   Master.pdf
                       ──►    20169310.pdf           (mit Details)
```

### Wie es funktioniert

1. Du lädst eine **Master-PDF** in den Container `pdf-input` hoch
2. Du lädst **Detail-PDFs** in den Container `pdf-details` hoch
3. Der Dienst erkennt automatisch die Reservierungsnummern in der Master-PDF
4. Die passenden Detail-PDFs werden **nach der jeweiligen „Summe: Netto X EUR"-Seite** eingefügt
5. Die fertige Output-PDF erscheint im Container `pdf-output` unter demselben Namen wie die Master-PDF

---

## 2. Voraussetzungen

### Zugriff auf den Azure Blob Storage

Du benötigst Lese-/Schreibzugriff auf das Storage Account:

| Umgebung | Storage Account | Resource Group |
|---|---|---|
| **Dev** | `pdfmergerdevstorage` | `pdfmerger-dev-rg` |
| **Prod** | `pdfmergerprodstg` | _(noch nicht produktiv)_ |

### Empfohlene Tools zum Hochladen

- **Azure Storage Explorer** (Desktop-App) – [Download](https://azure.microsoft.com/de-de/products/storage/storage-explorer/)
- **Azure Portal** → Storage Account → Container → Datei hochladen
- **Azure CLI**: `az storage blob upload ...`

### PDF-Anforderungen

| Kriterium | Wert |
|---|---|
| Format | Textbasiertes PDF (kein gescanntes Bild-PDF) |
| Max. Seiten Master-PDF | 100 Seiten |
| Max. Dateigröße | 50 MB pro PDF |
| Max. Verarbeitungszeit | 5 Minuten |

---

## 3. Dateinamen-Konventionen

### Master-PDF (→ Container `pdf-input`)

| Format | Beispiel | Verhalten |
|---|---|---|
| Beliebiger Name | `Master.pdf` | ✅ Wird verarbeitet |
| Mit SCI-Präfix | `SCI-Master.pdf` | ✅ Wird verarbeitet (Präfix ignoriert) |

Die Master-PDF **muss** im Text folgende Muster enthalten:
- **Reservierungsnummer**: `Reservierungsnummer: 202174945` (pro Seite)
- **Marker**: `Summe: Netto X EUR` (X = beliebiger Betrag)

### Detail-PDFs (→ Container `pdf-details`)

| Format | Beispiel | Passende Reservierungsnummer |
|---|---|---|
| Exakt | `202174945.pdf` | `202174945` |
| Mit Suffix | `2021749450.pdf` | `202174945` (Prefix-Matching) |
| Mit SCI-Präfix | `SCI-202174945.pdf` | `202174945` |
| SCI + Suffix | `SCI-2021749450.pdf` | `202174945` |

> **Wichtig:** Der Dateiname der Detail-PDF muss **mit der Reservierungsnummer beginnen** (nach Entfernung des SCI-Präfixes).

---

## 4. Verarbeitungsszenarien

### Szenario A: Master zuerst, dann Details (Standard)

```
1. Master.pdf   → pdf-input   (Trigger startet sofort)
2. 202174945.pdf → pdf-details (Trigger matcht gegen Master)
3. 20169310.pdf  → pdf-details (Trigger komplettiert die Master)
   → Master.pdf erscheint in pdf-output ✅
```

### Szenario B: Details zuerst, dann Master

```
1. 202174945.pdf → pdf-details (kein Master → gespeichert als "unmatched")
2. 20169310.pdf  → pdf-details (kein Master → gespeichert als "unmatched")
3. Master.pdf    → pdf-input   (Trigger findet unmatched Details → verarbeitet sie)
   → Master.pdf erscheint in pdf-output ✅
```

> Beide Szenarien werden vollautomatisch unterstützt. Die Reihenfolge des Hochladens spielt keine Rolle.

### Szenario C: Fehlende Detail-PDF

```
1. Master.pdf   → pdf-input   (enthält Reservierungsnummern A und B)
2. A.pdf        → pdf-details (wird eingebunden)
   Keine B.pdf vorhanden
   → Master.pdf erscheint in pdf-output, aber ohne Detail B
   → WARN-Meldung im Log: "Detail-PDF nicht gefunden: B.pdf"
```

> Das System bricht **nicht ab**, sondern verarbeitet alle vorhandenen Details.

---

## 5. Schritt-für-Schritt: Dateien hochladen

### Mit Azure Storage Explorer

1. Storage Explorer öffnen
2. Verbinde mit `pdfmergerdevstorage` (Subscription: `4ec91d73-...`)
3. Navigiere zu **Blob Containers**

**Master hochladen:**
- Container `pdf-input` öffnen
- Klick auf „Upload" → Datei auswählen
- ✅ Verarbeitung startet automatisch

**Details hochladen:**
- Container `pdf-details` öffnen
- Klick auf „Upload" → Dateien auswählen (Mehrfachauswahl möglich)
- ✅ Jede Datei triggert automatisch die Verarbeitung

### Mit Azure CLI

```bash
# Master hochladen
az storage blob upload \
  --account-name pdfmergerdevstorage \
  --container-name pdf-input \
  --name "Master.pdf" \
  --file "./Master.pdf"

# Detail hochladen
az storage blob upload \
  --account-name pdfmergerdevstorage \
  --container-name pdf-details \
  --name "202174945.pdf" \
  --file "./202174945.pdf"
```

---

## 6. Verarbeitungsablauf im Detail

```
Master.pdf hochgeladen (pdf-input)
│
├─ Text wird seitenweise extrahiert
├─ Reservierungsnummern werden erkannt (Format: "Reservierungsnummer: \d+")
├─ Marker "Summe: Netto X EUR" wird pro Seite erkannt
├─ Eintrag in MasterPDFs-Tabelle: Status = "pending"
│
└─ Rescan: Gibt es bereits "unmatched" Detail-PDFs, die passen?
   ├─ JA → werden sofort verarbeitet (Szenario B)
   └─ NEIN → warten auf Detail-Uploads

Detail-PDF hochgeladen (pdf-details)
│
├─ Suche nach passender Master (Status "pending")
├─ Prefix-Matching: Dateiname beginnt mit Reservierungsnummer?
│
├─ Kein Match → Status "unmatched" gespeichert
│              (wird verarbeitet, sobald passende Master ankommt)
│
└─ Match gefunden:
   ├─ Detail-Status → "matched"
   ├─ Detail-PDF wird nach der Marker-Seite in Master eingefügt
   ├─ Inkrementelle Output-PDF wird aktualisiert (pdf-output)
   └─ Wenn alle Details vorhanden: Master-Status → "completed"
```

---

## 7. Ergebnis abrufen

Die fertige PDF befindet sich im Container **`pdf-output`** unter dem **gleichen Namen wie die Master-PDF**.

| Input | Output |
|---|---|
| `pdf-input/Master.pdf` | `pdf-output/Master.pdf` |
| `pdf-input/SCI-Master.pdf` | `pdf-output/SCI-Master.pdf` |
| `pdf-input/Rechnung_Juli.pdf` | `pdf-output/Rechnung_Juli.pdf` |

> Die Output-PDF wird **inkrementell** aufgebaut – nach jeder eingebundenen Detail-PDF ist eine (unvollständige) Version bereits abrufbar.

### Herunterladen mit Azure CLI

```bash
az storage blob download \
  --account-name pdfmergerdevstorage \
  --container-name pdf-output \
  --name "Master.pdf" \
  --file "./Master_output.pdf"
```

---

## 8. Automatische Dateilöschung

Alle PDF-Dateien im Blob Storage werden automatisch nach einer definierten Aufbewahrungsdauer gelöscht. Der Löschprozess erfolgt vollautomatisch über die Azure Blob Lifecycle Management Policy (ADR-016) – ohne manuelle Eingriffe.

### Aufbewahrungsfristen

| Container | Inhalt | Dev | Prod |
|---|---|---|---|
| `pdf-input` | Master-PDFs | **30 Tage** | **90 Tage** |
| `pdf-details` | Detail-PDFs | **30 Tage** | **30 Tage** |
| `pdf-output` | Output-PDFs | **30 Tage** | **90 Tage** |

> Die Frist wird ab dem **letzten Änderungsdatum** des Blobs berechnet.

### Wichtige Hinweise

- **Keine Warnung vor der Löschung** – die Dateien werden still gelöscht
- Die Löschung ist **unwiderruflich** – es gibt kein Backup
- Lade fertige Output-PDFs **rechtzeitig herunter**, falls du sie länger benötigst
- Die Aufbewahrungsfristen können nur durch ein Infrastruktur-Deployment geändert werden

### Änderung der Aufbewahrungsdauer

Die TTL-Werte sind in den Parameter-Dateien konfiguriert:

| Datei | Parameter | Bedeutung |
|---|---|---|
| `infra/parameters.dev.json` | `detailPdfTtlDays` | Detail-PDF TTL (Dev) |
| `infra/parameters.dev.json` | `masterPdfTtlDays` | Master-/Output-PDF TTL (Dev) |
| `infra/parameters.prod.json` | `detailPdfTtlDays` | Detail-PDF TTL (Prod) |
| `infra/parameters.prod.json` | `masterPdfTtlDays` | Master-/Output-PDF TTL (Prod) |

Nach Anpassung der Werte muss ein Bicep-Deployment durchgeführt werden.

---

## 9. Status und Monitoring

### Verarbeitungsstatus (Table Storage)

Der aktuelle Status ist in zwei Azure Tables einsehbar:

**Tabelle `MasterPDFs`:**

| Spalte | Mögliche Werte | Bedeutung |
|---|---|---|
| `status` | `pending` | Verarbeitung läuft, noch fehlende Details |
| `status` | `completed` | Alle Details eingebunden, Output fertig |
| `missingDetails` | JSON-Array | Noch fehlende Reservierungsnummern |

**Tabelle `DetailPDFs`:**

| Spalte | Mögliche Werte | Bedeutung |
|---|---|---|
| `status` | `matched` | Detail wurde einer Master zugeordnet |
| `status` | `unmatched` | Noch keine passende Master gefunden |
| `matchedMaster` | Dateiname | Name der zugehörigen Master-PDF |

### Logs und Monitoring

- **Application Insights**: `pdf-merger-dev-appinsights` (West Europe)
- **Log Analytics**: `pdf-merger-dev-logs`

Wichtige Log-Meldungen:

| Log-Nachricht | Bedeutung |
|---|---|
| `masterTrigger: Verarbeite "Master.pdf"` | Master-Verarbeitung gestartet |
| `masterTrigger: "Master.pdf" gespeichert – 2 Reservierungsnummer(n)` | Reservierungsnummern erkannt |
| `detailTrigger: "202174945.pdf" matched mit Reservierung "202174945"` | Detail erfolgreich zugeordnet |
| `masterTrigger: Rescan – Detail "..." nachträglich verarbeitet` | Szenario B: Detail vor Master |
| `WARN: Kein Master-PDF im Status "pending" für Detail-PDF "..."` | Kein passender Master vorhanden |
| `WARN: Keine Reservierungsnummern in "..." gefunden` | Master-PDF ohne erkennbare Nummern |
| `WARN: Detail-PDF nicht gefunden: ....pdf` | Detail-PDF fehlt |

---

## 10. Fehlerfälle und Verhalten

| Situation | Verhalten | Aktion erforderlich |
|---|---|---|
| Master-PDF enthält keine Reservierungsnummern | WARN im Log, Eintrag trotzdem angelegt | PDF prüfen: enthält sie Text? (kein Scan) |
| Detail-PDF passt zu keiner Master | Als "unmatched" gespeichert, warten | Master hochladen oder Dateiname prüfen |
| Gleichzeitiger Upload mehrerer Masters | Jede Master wird unabhängig verarbeitet | Keine Aktion nötig |
| Detail-PDF ist kein PDF (Endung falsch) | Wird ignoriert, kein Log-Eintrag | Datei erneut mit `.pdf`-Endung hochladen |
| Output-PDF existiert bereits | Wird inkrementell überschrieben | Keine Aktion nötig |
| Verarbeitung dauert > 5 Minuten | Timeout, Fehler im Log | Support kontaktieren |

---

## 11. Technische Referenz

### Azure-Ressourcen (Dev-Umgebung)

| Ressource | Name |
|---|---|
| Resource Group | `pdfmerger-dev-rg` |
| Storage Account | `pdfmergerdevstorage` |
| Function App | `pdf-merger-dev-func` |
| App Insights | `pdf-merger-dev-appinsights` |
| Subscription | `4ec91d73-a539-46ce-83e3-8e08d149ba1c` |
| Region | West Europe |

### Blob Container

| Container | Zweck | Was hochladen |
|---|---|---|
| `pdf-input` | Input Master-PDFs | Master-PDF |
| `pdf-details` | Input Detail-PDFs | Detail-PDFs nach Reservierungsnummer |
| `pdf-output` | Fertige Output-PDFs | _(nur lesen)_ |

### Dateinamen-Normalisierung (SCI-Präfix)

Der Dienst entfernt automatisch den Präfix `SCI-` vor dem Matching. Das bedeutet:

- `SCI-202174945.pdf` wird behandelt wie `202174945.pdf`
- Der originale Blob-Name bleibt im Storage erhalten
- Der Output-Dateiname basiert auf dem originalen Master-Dateinamen

### Unterstützte Präfixe

| Präfix | Beispiel |
|---|---|
| `SCI-` | `SCI-202174945.pdf` |

Weitere Präfixe können durch Erweiterung von `src/utils/fileNameUtils.ts` ergänzt werden.
