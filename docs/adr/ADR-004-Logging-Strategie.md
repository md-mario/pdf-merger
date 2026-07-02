# ADR-004: Logging-Strategie

## Status
Accepted

---

## Kontext
Die Lösung muss alle Verarbeitungsschritte protokollieren, um:
1. **Debugging** zu ermöglichen.
2. **Monitoring** in Azure zu unterstützen.
3. **Audit-Trails** für die Verarbeitung zu erstellen.

Optionen für Logging:
- **Lokale Logs**: Dateien im `logs/` Ordner.
- **Azure Application Insights**: Zentrale Logs und Metriken.
- **Konsolenausgabe**: Nur für Entwicklung (nicht für Produktion).

---

## Entscheidung
Verwendung von:
- **`winston`** für lokale Logs (Dateien im `logs/` Ordner).
- **Azure Application Insights** für zentrale Logs und Metriken.

---

## Begründung
| Kriterium | `winston` | Application Insights | Konsolenausgabe |
|-----------|----------|----------------------|-----------------|
| **Lokale Speicherung** | ✅ | ❌ | ❌ |
| **Zentrale Speicherung** | ❌ | ✅ | ❌ |
| **Metriken** | ❌ | ✅ | ❌ |
| **Einfachheit** | ✅ | ✅ | ✅ |
| **Kosten** | ✅ (kostenlos) | ❌ (kostenpflichtig) | ✅ |

- **Vorteile**:
  - **Lokale Logs**: Debugging ohne Azure-Zugriff möglich.
  - **Application Insights**: Zentrale Überwachung, Alerts, Dashboards.
- **Nachteile**:
  - Doppelte Logs (lokal + Azure), aber akzeptabel für Produktion.

---

## Konsequenzen
- **Positiv**:
  - Vollständige Abdeckung für Debugging und Monitoring.
  - Skalierbar durch Application Insights.
- **Negativ**:
  - Höhere Kosten durch Application Insights (aber für Produktion akzeptabel).
