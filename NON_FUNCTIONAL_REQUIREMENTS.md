# Nicht-funktionale Anforderungen

## 1. Laufzeitumgebung
| Anforderung | Wert |
|-------------|------|
| **Runtime** | Node.js 22 (LTS) |
| **Azure Function App Plan** | Consumption Plan (serverlos, automatische Skalierung) |
| **Trigger** | Blob Storage Trigger (ausgelöst durch Hochladen von `Master.pdf` in `pdf-input` Container) |

---

## 2. Speicher
| Anforderung | Wert |
|-------------|------|
| **Input/Output** | Azure Blob Storage (`pdf-input`, `pdf-output` Container) |
| **Metadaten** | Azure Table Storage (optional, für Verarbeitungsstatus) |
| **Lokale Speicherung** | Nur für temporäre Dateien (z. B. während der Verarbeitung) |

---

## 3. Performance
| Anforderung | Wert |
|-------------|------|
| **Maximale Seiten pro `Master.pdf`** | 100 |
| **Maximale Dateigröße pro PDF** | 50 MB |
| **Zeitlimit pro Verarbeitung** | 5 Minuten |
| **Gleichzeitige Verarbeitungen** | 10 (skalierbar durch Azure) |

---

## 4. Logging und Monitoring
| Anforderung | Wert |
|-------------|------|
| **Logging-Bibliothek** | `winston` oder Azure Application Insights SDK |
| **Log-Level** | `info` (Standard), `warn`, `error` |
| **Log-Ziele** | Application Insights + lokale Log-Dateien (`logs/`) |
| **Metriken** | Verarbeitungsdauer, Anzahl der eingefügten Detail-PDFs, Fehlerrate |

---

## 5. Sicherheit
| Anforderung | Wert |
|-------------|------|
| **Zugriff auf Blob Storage** | Managed Identity (keine Hardcoded Credentials) |
| **PDF-Verarbeitung** | Keine Ausführung von externem Code (z. B. in PDFs eingebettete Skripte) |
| **Datenverschlüsselung** | Azure Storage Service Encryption (Standard) |

---

## 6. Wartbarkeit
| Anforderung | Wert |
|-------------|------|
| **Dokumentation** | ADRs, Scope, Kontrakte, Code-Kommentare |
| **Testabdeckung** | Unit-Tests für Kernlogik (z. B. Textextraktion, Marker-Erkennung) |
| **Abhängigkeiten** | Regelmäßige Updates (z. B. `npm audit`) |
