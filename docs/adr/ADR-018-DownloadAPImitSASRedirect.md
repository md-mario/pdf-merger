## ADR 018: Download API über HTTP Trigger Function mit SAS Redirect

### Status

Proposed

### Kontext

Die SharePoint Liste soll dem Benutzer einen DownloadLink für die erzeugte Master PDF bereitstellen.

Die PDF Dateien liegen im Azure Blob Storage.

Die Blob Container sollen nicht öffentlich sein.

SAS Tokens sollen nicht dauerhaft in der SharePoint Liste gespeichert werden.

Ein dauerhaft gespeicherter SAS Link wäre problematisch, weil SAS Tokens zeitlich begrenzt sind und nach Ablauf ungültig werden.

### Entscheidung

Der DownloadLink in SharePoint zeigt nicht direkt auf den Blob Storage.

Stattdessen wird eine Azure Function mit HTTP Trigger bereitgestellt.

Die Function nimmt die rowKey entgegen, liest den passenden MasterPDF Eintrag aus Azure Table Storage, erzeugt zur Laufzeit einen kurzlebigen SAS Link und antwortet mit einem HTTP Redirect auf den Blob Download.

### Zielarchitektur

```text
Benutzer
    ↓
SharePoint Liste
    ↓
DownloadLink
    ↓
HTTP Trigger Function
    ↓
MasterPDFs Entity lesen
    ↓
Blob Name und Container ermitteln
    ↓
SAS Link erzeugen
    ↓
HTTP 302 Redirect
    ↓
Blob Download
```

### DownloadLink Format

In SharePoint wird folgender relativer oder absoluter Link gespeichert:

```text
/api/download/{rowKey}
```

Beispiel:

```text
/api/download/202174945
```

Im produktiven Betrieb kann daraus eine vollständige Function URL oder eine URL über API Management werden.

### Function Name

```text
downloadMasterPdf
```

### HTTP Route

```text
GET /api/download/{rowKey}
```

### Ablauf der Function

1. rowKey aus der Route lesen.
2. MasterPDFs Entity anhand der rowKey laden.
3. Prüfen, ob die Entity existiert.
4. Prüfen, ob der Status den Download erlaubt.
5. Blob Container und Blob Name aus der Entity lesen.
6. Prüfen, ob der Blob existiert.
7. Kurzlebigen SAS Link mit Leserecht erzeugen.
8. HTTP 302 Redirect mit Location Header zurückgeben.

### Beispielantwort bei erfolgreichem Download

```text
HTTP 302 Found
Location: https://storageaccount.blob.core.windows.net/container/file.pdf?sv=...
```

### Beispielantwort bei nicht gefundener Entity

```text
HTTP 404 Not Found
```

### Beispielantwort bei nicht erlaubtem Status

```text
HTTP 409 Conflict
```

### Beispielantwort bei fehlendem Blob

```text
HTTP 404 Not Found
```

### Beispielantwort bei internem Fehler

```text
HTTP 500 Internal Server Error
```

### SAS Token Regel

Der SAS Token wird ausschließlich zur Laufzeit erzeugt.

Der SAS Token wird nicht in Azure Table Storage gespeichert.

Der SAS Token wird nicht in SharePoint gespeichert.

Der SAS Token erhält nur Leserecht.

Der SAS Token erhält eine kurze Gültigkeitsdauer.

### Empfohlenes Entity Modell für MasterPDFs

```json
{
  "partitionKey": "MasterPDFs",
  "rowKey": "202174945",
  "masterPdfName": "SCI-Master.pdf",
  "blobContainer": "pdf-output",
  "blobName": "SCI-Master.pdf",
  "status": "completed",
  "timestamp": "2026-07-07T12:38:00Z",
  "missingDetails": []
}
```

### Beispiel Implementierung in TypeScript

```ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

app.http("downloadMasterPdf", {
  methods: ["GET"],
  authLevel: "function",
  route: "download/{rowKey}",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const rowKey = request.params.rowKey;

    if (!rowKey) {
      return { status: 400, body: "rowKey is required" };
    }

    const entity = await getMasterPdfEntity(rowKey);

    if (!entity) {
      return { status: 404, body: "MasterPDF entity not found" };
    }

    if (entity.status !== "completed") {
      return { status: 409, body: "MasterPDF is not ready for download" };
    }

    const blobExists = await existsBlob(entity.blobContainer, entity.blobName);

    if (!blobExists) {
      return { status: 404, body: "Blob not found" };
    }

    const sasUrl = await createReadOnlySasUrl({
      containerName: entity.blobContainer,
      blobName: entity.blobName,
      expiresInMinutes: 5
    });

    return {
      status: 302,
      headers: {
        Location: sasUrl
      }
    };
  }
});
```

### Sicherheit

Der Blob Container bleibt privat.

Der Benutzer erhält keinen dauerhaften Blob Link.

Der Zugriff wird zentral über die Function gesteuert.

Downloads können über Application Insights protokolliert werden.

Bei Bedarf kann die Function später hinter API Management gestellt werden.

### Authentifizierung

Für den aktuellen Scope wird authLevel function verwendet.

Eine spätere Erweiterung auf API Management oder Entra ID Authentifizierung ist möglich, wird aber nicht durch diese ADR entschieden.

### Fehlerbehandlung

Fehler werden gemäß bestehender Fehlerstrategie protokolliert.

Nicht gefundene Entities oder Blobs werden mit 404 beantwortet.

Nicht downloadfähige Statuswerte werden mit 409 beantwortet.

Unerwartete Fehler werden mit 500 beantwortet.

### Logging

Jeder Download Versuch wird protokolliert.

Das Log enthält mindestens:

```text
rowKey
statusCode
blobName
timestamp
correlationId
```

SAS Tokens werden nicht geloggt.

### Begründung

Diese Lösung verhindert, dass ablaufende SAS Links dauerhaft in SharePoint gespeichert werden.

Die SharePoint Liste bleibt stabil, weil der DownloadLink dauerhaft gleich bleibt.

Der tatsächliche Blob Zugriff wird erst beim Download erzeugt.

Die Function bildet eine kontrollierte Zugriffsschicht zwischen SharePoint und Blob Storage.

### Konsequenzen

#### Positiv

1. Keine SAS Tokens in SharePoint.
2. Private Blob Container bleiben möglich.
3. DownloadLinks in SharePoint laufen nicht ab.
4. Zugriff kann zentral protokolliert werden.
5. Berechtigungslogik kann später erweitert werden.

#### Negativ

1. Zusätzliche HTTP Function erforderlich.
2. Download ist abhängig von Azure Function Verfügbarkeit.
3. Pro Download entsteht ein zusätzlicher Function Aufruf.

### Betroffene Komponenten

```text
src/functions/downloadMasterPdf.ts
src/infrastructure/tableStorage.ts
src/infrastructure/blobStorage.ts
src/models/masterPdfEntity.ts
```

### Architekturregel

In SharePoint dürfen keine direkten Blob SAS URLs gespeichert werden.

SharePoint speichert ausschließlich den stabilen DownloadLink zur Download Function.

Der SAS Token wird ausschließlich on demand innerhalb der Download Function erzeugt.
