# Kontrakte: Input, Output und Fehlerbehandlung

## Input-Kontrakt

### 1. Dateien
| Datei | Beschreibung | Format | Pflicht |
|-------|--------------|--------|---------|
| `Master.pdf` | Enthält mehrere Datensätze mit Reservierungsnummern und Markern. | PDF (Text-basiert) | Ja |
| `<Reservierungsnummer>.pdf` | Detail-PDFs, die eingefügt werden sollen. | PDF | Nein (Warnung bei Fehlen) |

### 2. Umgebungsvariablen (Azure Function App)
| Variable | Beschreibung | Standardwert | Pflicht |
|----------|--------------|--------------|---------|
| `INPUT_FOLDER` | Pfad zum Ordner mit `Master.pdf` und Detail-PDFs. | `./` | Nein |
| `OUTPUT_FOLDER` | Pfad zum Ausgabeordner. | `./output` | Nein |
| `LOG_LEVEL` | Log-Level (z. B. `info`, `warn`, `error`). | `info` | Nein |

---

## Output-Kontrakt

### 1. Dateien
| Datei | Beschreibung | Format |
|-------|--------------|--------|
| `output/<Name_der_Master-PDF>` | Neue PDF mit eingefügten Detail-PDFs.  Der Dateiname entspricht dem Namen der Master-PDF. | PDF |
| `logs/processing-<timestamp>.log` | Log-Datei mit Verarbeitungsdetails. | Text |

### 2. Azure-Integration (optional)
| Ressource | Beschreibung |
|-----------|--------------|
| **Blob Storage** | Input: `pdf-input` Container, Output: `pdf-output` Container. |
| **Table Storage** | Metadaten (z. B. Verarbeitungsstatus, Reservierungsnummern). |
| **Application Insights** | Zentrale Logs und Metriken. |

---

## Fehlerkontrakt

| Fehler | Verhalten | Log-Nachricht |
|--------|-----------|---------------|
| `Master.pdf` nicht gefunden | Abbruch | `ERROR: Master.pdf nicht gefunden in <INPUT_FOLDER>` |
| Detail-PDF nicht gefunden | Warnung, Fortsetzung | `WARN: Detail-PDF nicht gefunden: <Reservierungsnummer>.pdf` |
| Ungültiges PDF-Format | Abbruch | `ERROR: Ungültiges PDF-Format: <Dateiname>` |
| Marker nicht gefunden | Warnung, Fortsetzung | `WARN: Kein Marker "Summe: Netto X EUR" in Datensatz gefunden` |
| Reservierungsnummer nicht gefunden | Warnung, Fortsetzung | `WARN: Keine Reservierungsnummer in Datensatz gefunden` |
