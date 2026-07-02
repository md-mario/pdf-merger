# ADR-006: Datenmodell

## Status
Accepted

---

## Kontext
Die Lösung muss Daten während der Verarbeitung strukturiert speichern, insbesondere:
1. **Extrahierte Daten** aus `Master.pdf` (Reservierungsnummern, Marker-Positionen).
2. **Metadaten** zur Verarbeitung (z. B. Status, Zeitstempel).

Optionen für das Datenmodell:
- **JSON**: Einfache Struktur, gut für Logging und Debugging.
- **TypeScript-Interfaces**: Typsicherheit für den Code.
- **Azure Table Storage**: Strukturierte Speicherung von Metadaten.

---

## Entscheidung
Verwendung von:
1. **TypeScript-Interfaces** für die interne Datenhaltung.
2. **JSON** für Logging und temporäre Speicherung.
3. **Azure Table Storage** (optional) für Metadaten.

---

## Begründung
| Kriterium | TypeScript-Interfaces | JSON | Table Storage |
|-----------|-----------------------|------|---------------|
| **Typsicherheit** | ✅ | ❌ | ❌ |
| **Einfachheit** | ✅ | ✅ | ❌ |
| **Skalierbarkeit** | ✅ | ✅ | ✅ |
| **Persistenz** | ❌ | ❌ | ✅ |

- **Vorteile**:
  - **TypeScript-Interfaces**: Typsicherheit und bessere Code-Qualität.
  - **JSON**: Einfache Serialisierung für Logs.
  - **Table Storage**: Persistente Speicherung von Metadaten (z. B. für Wiederholungen).
- **Nachteile**:
  - Keine direkte Persistenz für TypeScript-Interfaces (muss in JSON/Table Storage umgewandelt werden).

---

## Datenmodell-Definitionen

### 1. TypeScript-Interfaces
```typescript
interface Reservierungsnummer {
  wert: string;       // z. B. "202174945"
  seite: number;      // Seite, auf der die Reservierungsnummer gefunden wurde
}

interface Marker {
  seite: number;      // Seite, auf der der Marker gefunden wurde
  text: string;       // z. B. "Summe: Netto 108,68 EUR"
}

interface Datensatz {
  reservierungsnummer: Reservierungsnummer;
  marker: Marker;
  detailPdfName: string;  // z. B. "202174945.pdf"
  detailPdfExists: boolean;
}

interface VerarbeitungsStatus {
  masterPdf: string;   // Dateiname der Master.pdf
  datensaetze: Datensatz[];
  startZeit: Date;
  endZeit: Date;
  fehler: string[];    // Liste der Warnungen/Fehler
  status: "erfolgreich" | "fehlgeschlagen";
}
```

### 2. JSON-Struktur (für Logging)
```json
{
  "masterPdf": "Master.pdf",
  "datensaetze": [
    {
      "reservierungsnummer": {
        "wert": "202174945",
        "seite": 1
      },
      "marker": {
        "seite": 1,
        "text": "Summe: Netto 108,68 EUR"
      },
      "detailPdfName": "202174945.pdf",
      "detailPdfExists": true
    }
  ],
  "startZeit": "2024-10-01T12:00:00Z",
  "endZeit": "2024-10-01T12:00:05Z",
  "fehler": [],
  "status": "erfolgreich"
}
```

### 3. Azure Table Storage (optional)
| PartitionKey | RowKey | MasterPdf | Reservierungsnummer | MarkerSeite | DetailPdfName | DetailPdfExists | Status | StartZeit | EndZeit |
|--------------|--------|----------|--------------------|-------------|---------------|-----------------|--------|-----------|---------|
| `Master.pdf` | `202174945` | `Master.pdf` | `202174945` | `1` | `202174945.pdf` | `true` | `erfolgreich` | `2024-10-01T12:00:00Z` | `2024-10-01T12:00:05Z` |

---

## Konsequenzen
- **Positiv**:
  - Klare Struktur für Datenhaltung und Logging.
  - Typsicherheit durch TypeScript-Interfaces.
  - Skalierbar durch JSON/Table Storage.
- **Negativ**:
  - Zusätzlicher Aufwand für die Umwandlung zwischen Interfaces und JSON/Table Storage.
