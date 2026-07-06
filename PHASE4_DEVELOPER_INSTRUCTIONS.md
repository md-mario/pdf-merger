# Phase 4 – MVP: Entwickler-Anweisungen

**Projekt**: PDF-Merger  
**Phase**: 4 – MVP  
**Verantwortlich**: Entwickler  
**Architektur-Governance**: Technischer Projektleiter (Mario Bischoff)  
**Status**: Bereit zur Umsetzung

---

## 📌 Kontext

**Phase 3 – Foundation ist abgeschlossen**. Alle ADRs (ADR-001 bis ADR-009) sind akzeptiert und die Projektinfrastruktur steht bereit.  
**Ziel von Phase 4 – MVP**: Lokale Tests durchführen, Azure Deployment vorbereiten, End-to-End-Tests implementieren.

---

## ⚠️ ADR-Abweichungen in dieser Anweisung

Die folgenden Punkte **weichen von akzeptierten ADRs ab** und wurden entsprechend korrigiert:

| Punkt | Ursprüngliche Anweisung | Korrektur (ADR-konform) | ADR |
|-------|------------------------|-------------------------|-----|
| Node.js-Version | `--runtime-version 24` | **Node.js 22** | ADR-007 |
| PDF-Bibliothek | „pdfreader" | **pdf-parse** | ADR-001 |
| Container-Namen | `input`, `details`, `output` | **`pdf-input`, `pdf-details`, `pdf-output`** | ADR-002 / CONTRACTS.md |

---

## 🔴 Voraussetzung: Phase 3 prüfen

```powershell
# P1: Konfigurationsdateien
ls package.json tsconfig.json host.json local.settings.json .gitignore jest.config.js

# P2: ADR-Dokumentation
ls docs/adr/ADR-001-PDF-Extraktionsbibliothek.md docs/adr/ADR-002-Azure-Storage-Integration.md `
   docs/adr/ADR-003-Fehlerbehandlung.md docs/adr/ADR-004-Logging-Strategie.md `
   docs/adr/ADR-005-Function-App-Trigger.md docs/adr/ADR-006-Datenmodell.md `
   docs/adr/ADR-007-Nodejs-Version.md docs/adr/ADR-008-Logging-Umgebungsabhaengig.md `
   docs/adr/ADR-009-Umgebungsmanagement.md

# P3: Kernimplementierung
ls src/utils/pdfReaderAsync.ts src/infrastructure/tableStorage.ts src/infrastructure/blobStorage.ts `
   src/contracts/input.ts src/contracts/output.ts src/services/pdf-merger.ts `
   src/functions/masterTrigger.ts src/functions/detailTrigger.ts src/index.ts

# P4: Qualitätssicherung
ls test/pdf-extractor.test.ts test/pdf-merger.test.ts test/masterTrigger.test.ts test/detailTrigger.test.ts

# P5: Infrastruktur
ls infra/main.bicep infra/parameters.dev.json infra/parameters.prod.json
```

---

## 🚀 MVP-1: Lokale Entwicklungsumgebung testen

### 1. Abhängigkeiten installieren

```powershell
npm install
```

- ✅ **Erwartet**: Alle Abhängigkeiten aus `package.json` werden installiert
- ❌ **Fehler**: Falls Fehler auftreten → `npm cache clean --force` und erneut versuchen

### 2. Projekt bauen

```powershell
npm run build
```

- ✅ **Erwartet**: `dist/` Verzeichnis wird erstellt, keine TypeScript-Fehler
- ❌ **Fehler**: TypeScript-Fehler beheben; `strict: true` ist Pflicht (kein `any`)

### 3. Azure Functions starten

```powershell
npm start
```

- ✅ **Erwartet**: Functions `masterTrigger` und `detailTrigger` werden registriert
- ❌ **Fehler**: Falls `func` nicht gefunden → `npm install -g azure-functions-core-tools@4`

### 4. Azure Storage Emulator (Azurite) starten

```powershell
# In einem separaten Terminal
mkdir -p .\azurite
azurite --silent --location .\azurite --debug .\azurite\debug.log
```

- ✅ **Erwartet**: Azurite läuft auf `http://127.0.0.1:10000`
- ❌ **Fehler**: Port bereits belegt → `--blobPort 10001 --queuePort 10002 --tablePort 10003`

### 5. Storage-Container und Tabellen anlegen (Azurite)

```powershell
$cs = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;"

# Blob-Container (ADR-002)
az storage container create --name pdf-input    --connection-string $cs
az storage container create --name pdf-details  --connection-string $cs
az storage container create --name pdf-output   --connection-string $cs

# Tabellen (ADR-002)
az storage table create --name MasterPDFs --connection-string $cs
az storage table create --name DetailPDFs --connection-string $cs
```

---

## 📁 MVP-2: Testdaten vorbereiten

### Testdaten in Blob Storage hochladen

```powershell
$cs = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"

# Master.pdf muss "Reservierungsnummer: 202174945" und "Summe: Netto X EUR" enthalten
az storage blob upload --container-name pdf-input   --file .\testdata\Master.pdf       --name Master.pdf       --connection-string $cs
az storage blob upload --container-name pdf-details --file .\testdata\202174945.pdf    --name 202174945.pdf    --connection-string $cs
az storage blob upload --container-name pdf-details --file .\testdata\20169310.pdf     --name 20169310.pdf     --connection-string $cs
```

**Hinweis**: Test-PDFs können mit PDF24 oder PowerPoint (als PDF exportieren) erstellt werden.  
Die Master.pdf muss auf mindestens einer Seite `Reservierungsnummer: <Zahl>` und `Summe: Netto X EUR` enthalten.

---

## 🧪 MVP-3: Lokale Trigger-Tests

### Master-Trigger testen

1. `Master.pdf` in `pdf-input` hochladen (löst `masterTrigger` aus)
2. Table Storage prüfen (`MasterPDFs`):
   - ✅ Eintrag: `rowKey = "Master.pdf"`, `status = "pending"`, `reservationNumbers = ["202174945","20169310"]`

### Detail-Trigger testen

1. `202174945.pdf` in `pdf-details` hochladen → `detailTrigger` feuert
   - ✅ `DetailPDFs`: `rowKey = "202174945.pdf"`, `status = "matched"`, `matchedMaster = "Master.pdf"`
   - ✅ `MasterPDFs`: `missingDetails = ["20169310"]`
2. `20169310.pdf` in `pdf-details` hochladen → alle Details vorhanden, Merge startet
   - ✅ `MasterPDFs`: `missingDetails = []`, `status = "completed"`
   - ✅ `pdf-output`: enthält `Master_mit_Details_automatisch.pdf`

### Final-PDF prüfen

```powershell
az storage blob download --container-name pdf-output --name Master_mit_Details_automatisch.pdf --file .\output\result.pdf --connection-string $cs
```

- ✅ **Erwartet**: Detail-PDFs sind nach den jeweiligen Marker-Seiten eingefügt

---

## 🧪 MVP-4: Unit-Tests ausführen

```powershell
npm test
```

- ✅ **Erwartet**: Alle Tests grün (4 Test-Suites: pdf-extractor, pdf-merger, masterTrigger, detailTrigger)
- Coverage prüfen: `npm test -- --coverage`

---

## ☁️ MVP-5: Azure Deployment vorbereiten

### Ressourcengruppen erstellen (ADR-009: Dev/Prod getrennt)

```powershell
az group create --name pdf-merger-dev  --location westeurope
az group create --name pdf-merger-prod --location westeurope
```

### Infrastruktur deployen (ADR-009: Azure Bicep)

```powershell
# Dev-Umgebung
az deployment group create \
  --resource-group pdf-merger-dev \
  --template-file infra/main.bicep \
  --parameters infra/parameters.dev.json

# Prod-Umgebung
az deployment group create \
  --resource-group pdf-merger-prod \
  --template-file infra/main.bicep \
  --parameters infra/parameters.prod.json
```

### Function App deployen

```powershell
# Build + Deploy (ADR-007: Node.js 22)
npm run build
func azure functionapp publish pdf-merger-dev-func
```

- ✅ **Erwartet**: Deployment erfolgreich, `masterTrigger` und `detailTrigger` in Azure registriert

---

## 📊 Akzeptanzkriterien für Phase 4 – MVP

| Kriterium | Status | Prüfung |
|-----------|--------|---------|
| Lokale Entwicklungsumgebung | ⏳ | `npm start` ohne Fehler |
| Build ohne Fehler | ⏳ | `npm run build` erfolgreich |
| Unit-Tests grün | ⏳ | `npm test` – 4 Suites, alle grün |
| Azure Deployment (Dev) | ⏳ | Bicep-Deployment + `func publish` erfolgreich |
| End-to-End-Test | ⏳ | Final-PDF korrekt erstellt |

---

## ⚠️ Wichtige Regeln & Constraints

### Architektur-Governance (verbindlich)

| ADR | Entscheidung |
|-----|-------------|
| ADR-001 | pdf-parse (Extraktion) + pdf-lib (Manipulation) |
| ADR-002 | Blob Storage: `pdf-input`, `pdf-details`, `pdf-output`; Table Storage: `MasterPDFs`, `DetailPDFs` |
| ADR-003 | Kritische Fehler → Abbruch; nicht-kritische Fehler → Warnung + Fortsetzung; ETag-Retry |
| ADR-004/008 | Dev: `context.log`; Prod: `winston` + Application Insights |
| ADR-005 | Blob Storage Trigger auf `pdf-input/{name}` und `pdf-details/{name}` |
| ADR-006 | TypeScript-Interfaces in `src/contracts/` |
| ADR-007 | Node.js **22** (nicht 24) |
| ADR-009 | Separate Ressourcengruppen Dev/Prod; Azure Bicep |

### Code-Qualität

- ✅ `strict: true` in tsconfig.json – **keine `any`-Typen**
- ✅ Nur `context.log`/`context.warn` in Functions (kein `console.log`) – ADR-008
- ✅ ETag-Handling für Race Conditions in `tableStorage.ts` – ADR-003
- ✅ Interfaces ausschließlich in `src/contracts/` – ADR-006

---

## 📝 Abgabe & Next Steps

```powershell
git add .
git commit -m "Phase 4: MVP – Lokale Tests + Azure Deployment"
git push
```

**Phase 5 – Integration** kann beginnen:
- CI/CD-Pipeline (GitHub Actions)
- Monitoring konfigurieren (Application Insights, ADR-004)
- Dokumentation aktualisieren

---

**Status**: Bereit für Umsetzung  
**Verantwortlich**: Entwickler  
**Architektur-Governance**: Technischer Projektleiter (Mario Bischoff)
