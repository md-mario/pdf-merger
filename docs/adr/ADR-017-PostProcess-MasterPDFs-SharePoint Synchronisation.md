## ADR 017: PostProcess Architektur für MasterPDFs und SharePoint Synchronisation

### Status

Proposed

### Kontext

Die bestehenden ADRs definieren bereits folgende Architekturgrundlagen:

1. PDF Dateien werden im Azure Blob Storage gespeichert.
2. Die Verarbeitung läuft in einer Azure Function App.
3. Die Auslösung der PDF Verarbeitung erfolgt über Blob Storage Trigger.
4. Azure Table Storage wird als persistenter Metadatenspeicher verwendet.
5. Die Tabelle MasterPDFs enthält fachlich relevante Verarbeitungsdaten.
6. SharePoint soll nicht führende Datenquelle sein, sondern eine Anzeige und Zugriffsebene für Benutzer bereitstellen.

Neue Anforderung:

Beim Schreiben oder Ändern eines Eintrags in der Tabelle MasterPDFs soll ein PostProcess etabliert werden. Dieser PostProcess soll den aktuellen Zustand des MasterPDF Eintrags an eine SharePoint Liste übertragen. Die SharePoint Liste soll dem Benutzer die relevanten Informationen anzeigen und einen DownloadLink bereitstellen.

Wichtige Einschränkung:

Azure Table Storage besitzt keinen nativen Trigger für Änderungen an Tabellenzeilen. Deshalb wird kein direkter Table Trigger eingeführt.

### Entscheidung

Der PostProcess wird nicht durch Azure Table Storage ausgelöst.

Stattdessen erzeugt der bestehende Verarbeitungsprozess nach dem Schreiben oder Aktualisieren eines MasterPDF Eintrags eine Queue Message.

Diese Queue Message löst eine separate Azure Function aus. Diese Function synchronisiert den Zustand in die SharePoint Liste.

### Zielarchitektur

```text
Blob Upload
    ↓
masterTrigger oder bestehender Verarbeitungsprozess
    ↓
MasterPDFs Entity schreiben oder aktualisieren
    ↓
Queue Message erzeugen
    ↓
postProcessTrigger
    ↓
SharePoint Liste aktualisieren
```

### Queue Message

Die Queue Message enthält einen Snapshot des Zustands zum Zeitpunkt des Schreibens oder Änderns.

```json
{
  "eventType": "MasterPdfUpserted",
  "timestamp": "2026-07-07T12:38:00Z",
  "partitionKey": "MasterPDFs",
  "rowKey": "202174945",
  "masterPdfName": "SCI-Master.pdf",
  "status": "completed",
  "missingDetails": [],
  "missingDetailCount": 0,
  "downloadPath": "/api/download/202174945"
}
```

### Bedeutung der Message Felder

#### eventType

Beschreibt das fachliche Ereignis. Für diesen Prozess wird MasterPdfUpserted verwendet.

#### timestamp

Zeitpunkt, an dem die Queue Message erzeugt wurde.

#### partitionKey und rowKey

Technische Identifikation des MasterPDF Eintrags in Azure Table Storage.

#### masterPdfName

Anzeigename der erzeugten oder verarbeiteten Master PDF.

#### status

Aktueller Verarbeitungsstatus des MasterPDF Eintrags.

Beispiele:

```text
pending
completed
failed
```

#### missingDetails

Snapshot der noch fehlenden Detail PDFs zum Zeitpunkt des Events.

#### missingDetailCount

Anzahl der fehlenden Detail PDFs. Dieses Feld dient der einfachen Anzeige und Filterung in SharePoint.

#### downloadPath

Relativer Pfad zur Download Function. Der Pfad enthält keinen SAS Token.

### SharePoint Zielmodell

Die SharePoint Liste enthält nur Anzeigedaten und keinen führenden fachlichen Zustand.

Empfohlene Spalten:

```text
Title
MasterPdfName
Status
Timestamp
MissingDetailCount
MissingDetails
Link
PartitionKey
RowKey
```

### Entscheidung zur Datenhoheit

Die Azure Table MasterPDFs bleibt die führende Datenquelle.

Die Queue Message ist ein Transportereignis.

Die SharePoint Liste ist eine Anzeige und Zugriffsebene.

### Fehlerverhalten

Wenn die SharePoint Synchronisation fehlschlägt, gilt der PDF Verarbeitungsprozess nicht automatisch als fehlgeschlagen.

Der Fehler wird im PostProcess protokolliert.

Die Queue Verarbeitung darf wiederholt werden.

Falls die Wiederholung endgültig fehlschlägt, wird dies als PostProcess Fehler behandelt und nicht als PDF Verarbeitungsfehler.

### Begründung

Die Entscheidung trennt die PDF Verarbeitung von der SharePoint Synchronisation.

Dadurch blockieren SharePoint Fehler nicht die eigentliche PDF Verarbeitung.

Die Queue entkoppelt beide Verarbeitungsschritte und ermöglicht Wiederholungen.

Der bestehende Blob Trigger bleibt die primäre technische Auslösung der PDF Verarbeitung.

Ein direkter Table Trigger wird nicht eingeführt, weil Azure Table Storage hierfür keinen nativen Änderungs Trigger bereitstellt.

### Konsequenzen

#### Positiv

1. Saubere Trennung zwischen PDF Verarbeitung und SharePoint Synchronisation.
2. Keine Polling Logik erforderlich.
3. Keine Änderung der bestehenden Blob Trigger Architektur notwendig.
4. PostProcess kann unabhängig überwacht und wiederholt werden.
5. SharePoint Liste bleibt eine Anzeige und wird nicht zur führenden Datenquelle.

#### Negativ

1. Zusätzliche Queue Function erforderlich.
2. Queue Message muss versioniert und validiert werden.
3. Die SharePoint Liste kann kurzzeitig einen älteren Zustand anzeigen, wenn Queue Verarbeitung verzögert wird.

### Betroffene Komponenten

```text
src/functions/masterTrigger.ts
src/functions/postProcessTrigger.ts
src/infrastructure/tableStorage.ts
src/infrastructure/queueStorage.ts
src/infrastructure/sharePointClient.ts
src/models/masterPdfEvent.ts
```

### Architekturregel

Ein Update der Tabelle MasterPDFs darf nicht direkt als Triggerquelle interpretiert werden.

Jede fachlich relevante Änderung an MasterPDFs, die in SharePoint sichtbar werden soll, muss explizit ein MasterPdfUpserted Event erzeugen.

---