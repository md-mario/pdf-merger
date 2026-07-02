# ADR-005: Function App Trigger

## Status
Accepted

---

## Kontext
Die Azure Function App muss automatisch ausgelöst werden, wenn eine neue `Master.pdf` verarbeitet werden soll. Optionen für Trigger:
1. **Blob Storage Trigger**:
   - Auslösung bei Hochladen einer Datei in einen Blob Container (z. B. `pdf-input`).
   - Automatische Bereitstellung der Datei als Input für die Function.
2. **HTTP Trigger**:
   - Auslösung durch HTTP-Request (z. B. manueller Aufruf oder Webhook).
3. **Timer Trigger**:
   - Auslösung nach Zeitplan (z. B. stündlich).
4. **Service Bus Trigger**:
   - Auslösung durch Nachrichten in einer Service Bus Queue.

---

## Entscheidung
Verwendung eines **Blob Storage Triggers** mit folgenden Einstellungen:
- **Container**: `pdf-input`.
- **Dateifilter**: `Master.pdf` (nur diese Datei löst die Function aus).
- **Zugriffslevel**: `Read` (die Function liest die Datei).

---

## Begründung
| Kriterium | Blob Storage | HTTP | Timer | Service Bus |
|-----------|-------------|------|-------|-------------|
| **Automatisierung** | ✅ | ❌ | ✅ | ✅ |
| **Echtzeit** | ✅ | ✅ | ❌ | ✅ |
| **Skalierbarkeit** | ✅ | ✅ | ✅ | ✅ |
| **Einfachheit** | ✅ | ✅ | ✅ | ❌ |
| **Kosten** | ✅ | ✅ | ✅ | ❌ |

- **Vorteile**:
  - **Echtzeit-Verarbeitung**: Sofortige Auslösung bei Hochladen von `Master.pdf`.
  - **Integriert mit Blob Storage**: Keine zusätzliche Infrastruktur nötig.
  - **Skalierbar**: Automatische Skalierung bei vielen Dateien.
- **Nachteile**:
  - Nur für Blob Storage geeignet (nicht für lokale Dateien).

---

## Konsequenzen
- **Positiv**:
  - Vollständig automatisierte Verarbeitung.
  - Keine manuelle Auslösung erforderlich.
- **Negativ**:
  - Abhängigkeit von Azure Blob Storage (nicht lokal testbar ohne Emulator).
