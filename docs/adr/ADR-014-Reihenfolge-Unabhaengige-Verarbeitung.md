# ADR-014: Reihenfolge-Unabhängige Verarbeitung (Details vor Master)

## Status

Accepted

---

## Kontext

Das ursprüngliche Design des Systems setzte implizit voraus, dass die **Master-PDF vor den Detail-PDFs** hochgeladen wird:

1. `masterTrigger` → erstellt Eintrag in `MasterPDFs` mit Status `pending`
2. `detailTrigger` → findet den pending Master und führt `mergeIncrementally` aus

Wird eine Detail-PDF **vor** der zugehörigen Master-PDF hochgeladen, findet `detailTrigger` keinen passenden Master-Eintrag und speichert die Detail-PDF mit Status `unmatched`. Der Master-Eintrag wird später zwar durch `masterTrigger` angelegt, aber **kein weiterer Trigger feuert** für die bereits vorhandenen Detail-PDFs. Die Output-PDF wird nie erstellt.

Dieser Fall tritt in der Praxis auf, wenn:
- Batch-Uploads in unbestimmter Reihenfolge erfolgen
- Detail-PDFs in einem vorgelagerten Prozess gesammelt und früher verfügbar sind als die Master-PDF

---

## Entscheidung

Der `masterTrigger` führt nach dem Anlegen des Master-Eintrags einen **Rescan** der `DetailPDFs`-Tabelle durch:

1. Alle Einträge mit `status = "unmatched"` werden geladen (`listUnmatchedDetailEntities`)
2. Für jeden Eintrag wird per **Prefix-Matching** (ADR-012) geprüft, ob der Detail-PDF-Name mit einer der extrahierten Reservierungsnummern beginnt
3. Bei Treffer:
   - Detail-Status wird auf `matched` gesetzt (`upsertDetailPdfEntity`)
   - `missingDetails` des Masters wird um die Reservierungsnummer reduziert (`updateMasterPdfMissingDetails`)
   - `mergeIncrementally` wird aufgerufen (ADR-010, ADR-011)

Der Rescan erfolgt **synchron** innerhalb der `masterTrigger`-Invocation.

---

## Verworfene Alternativen

| Alternative | Grund für Ablehnung |
|---|---|
| **Timer-Trigger** (periodischer Rescan) | Unnötige Komplexität, neue Azure-Ressource, Latenz nicht vorhersehbar |
| **Re-Upload-Workflow** (Details manuell erneut hochladen) | Nicht automatisiert, fehleranfällig im Betrieb |
| **Reihenfolge erzwingen** (Upload-Reihenfolge als Kontrakt) | Nicht realistisch in asynchronen Upload-Szenarien |
| **Separate "Retry"-Queue** (Service Bus / Storage Queue) | Zu hoher Infrastruktur-Overhead für den aktuellen Scope |

---

## Konsequenzen

### Positiv
- Das System ist **reihenfolge-unabhängig**: Master- und Detail-PDFs können in beliebiger Reihenfolge hochgeladen werden
- Kein manueller Eingriff erforderlich
- Kein zusätzlicher Azure-Dienst notwendig
- ETag-Mechanismus (ADR-003) schützt den Rescan vor Race Conditions bei gleichzeitig eintreffenden Masters

### Negativ / Trade-offs
- Der Rescan ist **O(n)** über alle `unmatched` Einträge in der `DetailPDFs`-Tabelle → bei großen Mengen nicht optimaler Details potenzielle Performance-Last
- `masterTrigger` hat jetzt eine **direkte Abhängigkeit** zu `mergeIncrementally` (bisher nur über `detailTrigger`)
- Theoretische Race Condition bei **zwei gleichzeitigen Master-Uploads**: Beide könnten dasselbe Detail verarbeiten. Das `upsertDetailPdfEntity` (Merge-Modus) ist idempotent; `mergeIncrementally` ist durch Blob-Lease (ADR-011) gegen gleichzeitige Ausführung gesichert

---

## Betroffene Komponenten

| Datei | Änderung |
|---|---|
| `src/functions/masterTrigger.ts` | Rescan-Logik nach `upsertMasterPdfEntity` |
| `src/infrastructure/tableStorage.ts` | Neue Funktion `listUnmatchedDetailEntities()` |
| `test/masterTrigger.test.ts` | 4 neue Tests für den Rescan-Pfad |

---

## Verweise

- ADR-003: ETag-basierte Fehlerbehandlung (Race Condition Handling)
- ADR-010: Inkrementelle Output-PDF
- ADR-011: Concurrency Locking (Blob Lease)
- ADR-012: Prefix-Matching-Strategie für Detail-PDFs
