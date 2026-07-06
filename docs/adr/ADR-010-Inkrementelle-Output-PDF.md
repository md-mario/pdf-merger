## ADR-010: Inkrementelle Erstellung der Output-PDF

### Status
  
Accepted

---

### Kontext
  
Die aktuelle Lösung verarbeitet eine Master.pdf und fügt passende Detail-PDFs basierend auf extrahierten Daten hinzu (siehe ADR-001).

Bisher ist nicht definiert, wann und wie die finale Output-PDF erzeugt wird.

Neue Anforderung:
- Sobald die erste passende Detail-PDF gefunden wird, soll eine Output-PDF im Container `pdf-output` erzeugt werden.
- Diese Output-PDF soll:
  - inkrementell erweitert werden
  - bei jedem weiteren Match aktualisiert werden

Rahmenbedingungen:
- Azure Function App mit Blob Trigger (siehe ADR-005)
- Azure Blob Storage für Input/Output (siehe ADR-002)
- PDF-Manipulation mit pdf-lib

Mögliche Strategien:
1. Batch-Erstellung am Ende
2. Neu-Erstellung bei jedem Match
3. Inkrementelles Update einer bestehenden Output-PDF

---

### Entscheidung
  
Verwendung einer inkrementellen PDF-Erstellung im Blob Storage:

- Beim ersten Match:
  - Erstellung der Output-PDF im Container `pdf-output`
- Bei jedem weiteren Match:
  - Laden der bestehenden Output-PDF
  - Anhängen neuer Seiten
  - Überschreiben der bestehenden Output-PDF

---

### Begründung

| Kriterium | Batch | Neu-Erstellung | Inkrementell |
|----------|------|----------------|--------------|
| Verfügbarkeit | ❌ | ✅ | ✅ |
| Performance | ✅ | ❌ | ✅ |
| Komplexität | ✅ | ✅ | ⚠️ |
| Speicherverbrauch | ✅ | ❌ | ✅ |

---

### Konsequenzen

#### Positiv
- Frühzeitige Verfügbarkeit der Output-PDF
- Fortschritt jederzeit sichtbar
- Gute Integration mit Blob Storage

#### Negativ
- Mehr Schreiboperationen
- Höherer Implementierungsaufwand
- Möglichkeit von Race Conditions

---

### Technische Auswirkungen

- Erweiterung der Function:
  - Prüfen, ob Output-PDF existiert
  - Laden oder neu erstellen
  - Seiten anhängen
- Nutzung von pdf-lib

---

### Hinweise

- Logging gemäß ADR-004
- Fehlerbehandlung gemäß ADR-003
- Locking notwendig → siehe ADR-011