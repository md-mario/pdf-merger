# ADR-007: Node.js-Version für Azure Function App

## Status
Accepted

---

## Kontext
Die aktuelle Festlegung in [`NON_FUNCTIONAL_REQUIREMENTS.md`](NON_FUNCTIONAL_REQUIREMENTS.md) sieht **Node.js 20 (LTS)** als Runtime für die Azure Function App vor.
Es gibt jedoch Gründe, eine **neuere Version** (z. B. **Node.js 22**) zu verwenden:
- **Sicherheitsupdates**: Node.js 22 enthält wichtige Sicherheitskorrekturen.
- **Kompatibilität**: Einige Bibliotheken (z. B. `pdf-lib`, `pdf-parse`) erfordern oder empfehlen Node.js 22.
- **Performance**: Node.js 22 bietet verbesserte Performance für CPU-intensive Aufgaben (z. B. PDF-Verarbeitung).
- **Azure-Unterstützung**: Node.js 22 wird von Azure Functions unterstützt (Stand: Oktober 2024).

---

## Entscheidung
Verwendung von **Node.js 22 (LTS)** als Runtime für die Azure Function App.

---

## Begründung
| Kriterium               | Node.js 20 | Node.js 22 |
|-------------------------|------------|------------|
| **Sicherheitsupdates**  | ✅         | ✅ (neuer) |
| **Kompatibilität**      | ✅         | ✅ (besser) |
| **Performance**         | ✅         | ✅ (besser) |
| **Azure-Unterstützung** | ✅         | ✅         |
| **Stabilität**          | ✅ (LTS)   | ✅ (LTS)   |

- **Vorteile**:
  - Zukunftssicher durch neuere LTS-Version.
  - Bessere Performance und Sicherheitsfeatures.
  - Kompatibilität mit modernen Bibliotheken.
- **Nachteile**:
  - Geringfügig höherer Ressourcenverbrauch (aber vernachlässigbar für Azure Functions).

---

## Konsequenzen
- **Positiv**:
  - Langfristige Wartbarkeit und Sicherheit.
  - Bessere Performance für die PDF-Verarbeitung.
- **Negativ**:
  - Eventuell Anpassungen in `package.json` oder Abhängigkeiten nötig.
  - Testaufwand für Kompatibilität mit Node.js 22.

---

## Supersedes
- Überschreibt die Festlegung in [`NON_FUNCTIONAL_REQUIREMENTS.md`](NON_FUNCTIONAL_REQUIREMENTS.md) (Node.js 20 → Node.js 22).
