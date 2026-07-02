# ADR-008: Logging-Umgebungsabhängig

## Status
Accepted

---

## Kontext
Die aktuelle [`ADR-004-Logging-Strategie.md`](ADR-004-Logging-Strategie.md) sieht vor:
- **`winston`** für lokale Logs.
- **Azure Application Insights** für zentrale Logs.

Für die **Entwicklungsumgebung** reicht jedoch **`context.log`** (Standard-Logging von Azure Functions) aus, um:
- Komplexität zu reduzieren.
- Abhängigkeiten zu minimieren.
- Die Entwicklung zu vereinfachen.

---

## Entscheidung
- **Entwicklungsumgebung (Dev)**:
  - **`context.log`** (Azure Functions Standard-Logging).
  - **Kein `winston` oder Application Insights**.
- **Produktionsumgebung (Prod)**:
  - **`winston` + Application Insights** (wie in ADR-004 festgelegt).

---

## Begründung
| Kriterium | `context.log` (Dev) | `winston` + App Insights (Prod) |
|-----------|---------------------|--------------------------------|
| **Einfachheit** | ✅ | ❌ |
| **Abhängigkeiten** | ✅ (keine zusätzlichen) | ❌ (zwei Bibliotheken) |
| **Kosten** | ✅ (kostenlos) | ❌ (Application Insights kostenpflichtig) |
| **Skalierbarkeit** | ❌ (begrenzt) | ✅ |
| **Debugging** | ✅ (ausreichend für Dev) | ✅ (besser für Prod) |

- **Vorteile**:
  - **Dev**: Einfacher, schneller, keine zusätzlichen Abhängigkeiten.
  - **Prod**: Vollständige Überwachung und Skalierbarkeit.
- **Nachteile**:
  - Unterschiedliche Logging-Strategien zwischen Dev und Prod (muss im Code gehandhabt werden).

---

## Konsequenzen
- **Positiv**:
  - Optimierte Entwicklungsumgebung.
  - Kostenersparnis in der Entwicklung.
- **Negativ**:
  - Code muss Umgebungsabhängigkeiten prüfen (z. B. `if (process.env.NODE_ENV === 'production')`).
  - Unterschiedliche Log-Formate zwischen Dev und Prod.

---

## Supersedes
- Überschreibt teilweise [`ADR-004-Logging-Strategie.md`](ADR-004-Logging-Strategie.md) für die **Entwicklungsumgebung**.