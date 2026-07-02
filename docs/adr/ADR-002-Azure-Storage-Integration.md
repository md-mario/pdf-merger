# ADR-002: Azure Storage Integration

## Status
Accepted

---

## Kontext
Die Lösung muss in einer **Azure Function App** laufen und PDFs verarbeiten, die in **Azure Storage** gespeichert sind. Es gibt folgende Optionen für die Speicherintegration:
1. **Azure Blob Storage**:
   - Speicherung von `Master.pdf` und Detail-PDFs in Containern (z. B. `pdf-input`, `pdf-output`).
   - Trigger: Blob Storage Trigger für die Function App (automatische Auslösung bei Hochladen von `Master.pdf`).
2. **Azure Files**:
   - Freigegebene Dateisysteme (SMB), aber nicht für serverlose Functions geeignet.
3. **Lokale Dateien**:
   - Nur für Testzwecke, nicht für Produktion.

Zusätzlich kann **Azure Table Storage** für Metadaten (z. B. Verarbeitungsstatus) verwendet werden.

---

## Entscheidung
Verwendung von:
- **Azure Blob Storage** für Input/Output der PDFs.
- **Azure Table Storage** (optional) für Metadaten.
- **Blob Storage Trigger** für die Function App.

---

## Begründung
| Kriterium | Blob Storage | Files | Lokale Dateien |
|-----------|-------------|-------|----------------|
| **Skalierbarkeit** | ✅ | ❌ | ❌ |
| **Serverlos kompatibel** | ✅ | ❌ | ❌ |
| **Trigger-Unterstützung** | ✅ | ❌ | ❌ |
| **Kosten** | ✅ (pay-as-you-go) | ❌ (teurer) | ❌ (nicht für Produktion) |
| **Performance** | ✅ | ✅ | ❌ |

- **Vorteile**:
  - Vollständig serverlos und skalierbar.
  - Integrierter Trigger für Azure Functions.
  - Geringe Kosten (nur für tatsächlich genutzten Speicher).
- **Nachteile**:
  - Latenz bei häufigen Lese-/Schreiboperationen (aber für PDF-Verarbeitung akzeptabel).

---

## Konsequenzen
- **Positiv**:
  - Automatische Skalierung der Function App bei vielen Verarbeitungen.
  - Keine manuelle Verwaltung von Servern oder Dateisystemen.
- **Negativ**:
  - Abhängigkeit von Azure-Diensten (nicht lokal ausführbar ohne Emulator).
  - Komplexere Konfiguration (z. B. Connection Strings, Berechtigungen).
