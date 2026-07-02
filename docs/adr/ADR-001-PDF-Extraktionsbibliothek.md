# ADR-001: PDF-Extraktionsbibliothek

## Status
Accepted

---

## Kontext
Für die Textextraktion und Manipulation von PDFs in TypeScript gibt es mehrere Bibliotheken:
- [`pdf-lib`](https://github.com/Hopding/pdf-lib): Fokus auf Manipulation (Seiten einfügen/löschen/verschmelzen), aber begrenzte Textextraktion.
- [`pdf-parse`](https://github.com/cbiss/pdf-parse): Gute Textextraktion, aber keine Manipulation.
- [`pdf.js`](https://mozilla.github.io/pdf.js/): Vollständige PDF-Unterstützung (Extraktion + Manipulation), aber komplex und schwergewichtig (~10 MB Bundle-Größe).
- [`pdf2json`](https://github.com/modesty/pdf2json): Extraktion von Text und Struktur, aber veraltet.

Die Lösung erfordert:
1. **Textextraktion** (für Reservierungsnummern und Marker).
2. **PDF-Manipulation** (für das Einfügen von Detail-PDFs).

---

## Entscheidung
Verwendung von:
- **`pdf-lib`** für die **Manipulation** (Einfügen von Seiten).
- **`pdf-parse`** für die **Textextraktion**.

---

## Begründung
| Kriterium | `pdf-lib` | `pdf-parse` | `pdf.js` |
|-----------|----------|------------|----------|
| **Textextraktion** | ❌ (begrenzt) | ✅ | ✅ |
| **PDF-Manipulation** | ✅ | ❌ | ✅ |
| **Bundle-Größe** | ~500 KB | ~200 KB | ~10 MB |
| **TypeScript-Unterstützung** | ✅ | ✅ | ✅ |
| **Aktive Wartung** | ✅ | ✅ | ✅ |
| **Einfachheit** | ✅ | ✅ | ❌ (komplex) |

- **Vorteile**:
  - Klare Trennung der Verantwortlichkeiten (Extraktion vs. Manipulation).
  - Geringere Bundle-Größe im Vergleich zu `pdf.js`.
  - Beide Bibliotheken sind aktiv gewartet und haben gute TypeScript-Typen.
- **Nachteile**:
  - Zwei Abhängigkeiten statt einer.
  - `pdf-parse` extrahiert keinen formatierten Text (z. B. Tabellen), aber dies ist für die Anforderung nicht relevant.

---

## Konsequenzen
- **Positiv**:
  - Optimale Performance durch spezialisierte Bibliotheken.
  - Geringerer Speicherverbrauch (wichtig für Azure Functions).
- **Negativ**:
  - Code muss beide Bibliotheken integrieren (z. B. Umwandlung von `pdf-parse`-Text in `pdf-lib`-Seiten).
  - Falls `pdf-parse` nicht alle Texte extrahiert, muss eine Alternative evaluiert werden (z. B. `pdf.js` als Fallback).
