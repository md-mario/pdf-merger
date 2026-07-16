# ADR-019: Neuer Status „new" für MasterPDFs und erweiterter Download-Zugriff

## Status

Accepted

---

## Erweiterung von

- ADR-006: Datenmodell (Status-Werte der `MasterPDFs`-Tabelle)
- ADR-018: Download API – Zugriffsregeln erweitert

---

## Kontext

Wenn eine neue Master-PDF hochgeladen wird, legt `masterTrigger` sofort einen Eintrag in der `MasterPDFs`-Tabelle an. Zu diesem Zeitpunkt wurde noch kein Detail gematcht und im `pdf-output`-Container existiert noch kein Output-Blob.

Unter dem bisherigen Modell wurde der initiale Status direkt als `pending` gesetzt. Das führte zu zwei Problemen:

1. **Kein Download möglich, obwohl Details bereits gematcht haben**: Die Download-Function (ADR-018) erlaubte den Download ausschließlich bei Status `completed`, obwohl nach dem ersten Detail-Match bereits ein partielles Output-Blob vorhanden ist.

2. **Kein semantisch klarer Initialzustand**: `pending` bedeutete sowohl „gerade erst angelegt, kein Output vorhanden" als auch „wird gerade verarbeitet, partielles Output vorhanden". Diese zwei Zustände waren nicht unterscheidbar.

---

## Entscheidung

### 1. Neuer initialer Status `new`

`masterTrigger` setzt den Status beim ersten Anlegen des Eintrags auf `new`.

Der Status `new` signalisiert: Die Master-PDF ist registriert, aber noch kein Detail wurde gematcht und kein Output-Blob existiert.

### 2. Status-Übergänge

```
new  →  pending  →  completed
```

| Übergang | Auslöser |
|---|---|
| `new` → `pending` | Erstes Detail-Match (`updateMasterPdfMissingDetails`, `missingDetails.length > 0`) |
| `pending` → `completed` | Letztes Detail-Match (`updateMasterPdfMissingDetails`, `missingDetails.length === 0`) |

### 3. Download-Zugriffsregeln (ADR-018 Erweiterung)

| Status | Download erlaubt | Begründung |
|---|---|---|
| `new` | ❌ | Noch kein Output-Blob vorhanden |
| `pending` | ✅ | Partielles Output-Blob vorhanden; Blob-Existenz wird in Schritt 3 der Function geprüft |
| `completed` | ✅ | Vollständiges Output-Blob vorhanden |
| `failed` | ❌ | Fehlerhafte Verarbeitung, kein gültiges Output |

Bei `pending` wird kein 409 zurückgegeben. Falls das Blob noch nicht existiert, antwortet die Function mit 404 (bestehende Blob-Existenz-Prüfung, ADR-013).

### 4. `listPendingMasterEntities` liefert `new` und `pending`

Die Funktion, die `detailTrigger` und Rescan (`masterTrigger`) nutzen, um offene Master-Einträge zu finden, filtert jetzt auf beide Status:

```
status eq 'pending' or status eq 'new'
```

Dadurch können Details auch dann gematcht werden, wenn der Master noch im Status `new` ist.

---

## Begründung

- **Semantische Klarheit**: `new` und `pending` sind nun klar voneinander abgegrenzte Zustände.
- **Frühzeitiger Download**: Nutzer können eine teilweise fertige PDF herunterladen, sobald das erste Detail verarbeitet wurde – ohne auf `completed` warten zu müssen.
- **Kein Breaking Change an bestehender Logik**: `updateMasterPdfMissingDetails` setzt bei `missingDetails.length > 0` weiterhin `pending`, was den Übergang `new → pending` beim ersten Match automatisch bewirkt.

---

## Betroffene Komponenten

| Datei | Änderung |
|---|---|
| `src/contracts/input.ts` | `MasterPdfRow.status` um `"new"` erweitert |
| `src/models/masterPdfEvent.ts` | `MasterPdfEvent.status` um `"new"` erweitert |
| `src/functions/masterTrigger.ts` | Initialer `upsertMasterPdfEntity`-Aufruf und Queue-Event verwenden `"new"` |
| `src/infrastructure/tableStorage.ts` | `listPendingMasterEntities` filtert auf `status eq 'pending' or status eq 'new'` |
| `src/functions/downloadMasterPdf.ts` | Status-Prüfung blockiert `"new"` und `"failed"`; `"pending"` ist erlaubt |

---

## Verweise

- ADR-006: Datenmodell
- ADR-010: Inkrementelle Output-PDF
- ADR-014: Reihenfolge-Unabhängige Verarbeitung
- ADR-018: Download API mit SAS Redirect
