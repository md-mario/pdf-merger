## ADR-011: Concurrency & Locking für Output-PDF

### Status
  
Accepted

---

### Kontext
  
Mit ADR-010 wird die Output-PDF inkrementell aktualisiert.

Dadurch entstehen mehrere Schreiboperationen auf dieselbe Datei:
- Lesen → Modifizieren → Schreiben

Da die Lösung in einer skalierenden Azure Function läuft, können mehrere Instanzen parallel arbeiten.

Risiken:
- Race Conditions
- Datenverlust
- Beschädigte PDFs

Mögliche Lösungen:
1. Kein Locking
2. Applikationsseitiges Locking
3. Blob Storage Lease
4. Queue-basierte Serialisierung

---

### Entscheidung
  
Verwendung von Azure Blob Storage Lease (pessimistisches Locking):

- Vor Schreibzugriff:
  - Acquire Lease
- Während Verarbeitung:
  - Exklusiver Zugriff
- Nach Verarbeitung:
  - Release Lease

Wenn kein Lease vorhanden:
- Abbruch oder Retry

---

### Begründung

| Kriterium | Kein Locking | App-Locking | Blob Lease | Queue |
|----------|-------------|-------------|------------|-------|
| Konsistenz | ❌ | ✅ | ✅ | ✅ |
| Komplexität | ✅ | ❌ | ✅ | ❌ |
| Azure Integration | ❌ | ❌ | ✅ | ✅ |
| Skalierbarkeit | ❌ | ✅ | ✅ | ✅ |

---

### Konsequenzen

#### Positiv
- Konsistente Daten
- Kein paralleles Überschreiben
- Verhindert defekte PDFs

#### Negativ
- Erhöhter Aufwand
- Retry-Logik notwendig
- Latenz möglich

---

### Technische Auswirkungen

- Implementierung von:
  - acquireLease
  - releaseLease

Ablauf:

1. Existiert Output-PDF?
2. Lease anfordern
3. PDF laden
4. Seiten anhängen
5. PDF speichern
6. Lease freigeben

---

### Fehlerverhalten

- Lease nicht verfügbar → WARN / optional Retry
- Blob Zugriff fehlgeschlagen → ERROR

---

### Alternativen

#### Queue-basierte Verarbeitung
- + Sicher
- - Komplex

#### Optimistisches Locking
- + Einfach
- - Konflikte möglich

#### Kein Locking
- ❌ führt zu Datenverlust

---

### Hinweise

- Lease kurz halten
- Logging gemäß ADR-004
- Retry mit Backoff empfohlen