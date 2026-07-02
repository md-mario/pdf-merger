# ADR-003: Fehlerbehandlung

## Status
Accepted

---

## Kontext
Die Lösung muss robust auf Fehler reagieren, insbesondere:
1. **Kritische Fehler** (z. B. `Master.pdf` nicht gefunden, ungültiges PDF-Format).
2. **Nicht-kritische Fehler** (z. B. Detail-PDF nicht gefunden, Marker nicht gefunden).

Optionen für die Fehlerbehandlung:
- **Abbruch**: Bei kritischen Fehlern.
- **Warnung + Fortsetzung**: Bei nicht-kritischen Fehlern.
- **Retry-Logik**: Für temporäre Fehler (z. B. Netzwerkprobleme bei Blob Storage).

---

## Entscheidung
- **Kritische Fehler** → **Abbruch** mit `ERROR`-Log.
- **Nicht-kritische Fehler** → **Warnung** mit `WARN`-Log + Fortsetzung.
- **Keine Retry-Logik** (da PDF-Verarbeitung idempotent ist und manuelle Korrektur erfordert).

---

## Begründung
| Fehler | Verhalten | Begründung |
|--------|-----------|------------|
| `Master.pdf` nicht gefunden | Abbruch | Ohne Input kann keine Verarbeitung stattfinden. |
| Detail-PDF nicht gefunden | Warnung + Fortsetzung | Die Verarbeitung kann mit den verfügbaren PDFs fortgesetzt werden. |
| Ungültiges PDF-Format | Abbruch | Die PDF kann nicht verarbeitet werden. |
| Marker nicht gefunden | Warnung + Fortsetzung | Der Datensatz wird übersprungen. |
| Reservierungsnummer nicht gefunden | Warnung + Fortsetzung | Der Datensatz wird übersprungen. |
| Blob Storage Zugriffsfehler | Abbruch | Ohne Zugriff auf Input/Output kann keine Verarbeitung stattfinden. |

- **Vorteile**:
  - Klare Trennung zwischen kritischen und nicht-kritischen Fehlern.
  - Maximale Robustheit durch Fortsetzung bei nicht-kritischen Fehlern.
- **Nachteile**:
  - Keine automatische Wiederholung bei temporären Fehlern (muss manuell behoben werden).

---

## Konsequenzen
- **Positiv**:
  - Hohe Fehlertoleranz für nicht-kritische Probleme.
  - Klare Log-Nachrichten für Debugging.
- **Negativ**:
  - Manuelle Intervention bei kritischen Fehlern erforderlich.
