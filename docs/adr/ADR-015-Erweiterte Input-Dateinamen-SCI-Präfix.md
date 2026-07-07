## ADR-014: Erweiterte Input-Dateinamen mit SCI-Präfix

### Status
  
Accepted

### Kontext
  
Die Lösung verarbeitet PDF-Dateien aus dem Azure Blob Storage:

- **Master.pdf** dient als Trigger für die Verarbeitung (siehe ADR-005).
- **Detail-PDFs** werden anhand der Reservierungsnummer zugeordnet (siehe ADR-012).

Bisher wurde angenommen, dass die Dateinamen der PDFs keinem speziellen Präfix unterliegen.

Neue Anforderung:
- Input-Dateien können mit einem Präfix beginnen, insbesondere:

SCI-<Originalname>.pdf

Beispiele:
- SCI-201468964.pdf
- SCI-Master.pdf

Problem:
- Die bestehende Matching-Strategie basiert auf dem Dateinamen (Prefix-Matching).
- Durch das Präfix "SCI-" beginnt der Dateiname nicht mehr direkt mit der relevanten Reservierungsnummer.
- Dadurch schlagen bestehende Matching-Mechanismen fehl.

---

### Entscheidung
  
Einführung einer **Dateinamen-Normalisierung** vor der Verarbeitung:

- Bekannte Präfixe (z. B. "SCI-") werden vor der weiteren Verarbeitung entfernt.
- Alle Matching-Operationen basieren ausschließlich auf dem **normalisierten Dateinamen**.
- Der originale Blob-Name bleibt unverändert im Storage bestehen.

Zusätzlich:
- Die Verarbeitung muss sowohl normale als auch präfixierte Dateien unterstützen.
- Optional kann auch die Master-Datei als "SCI-Master.pdf" erkannt werden.

---

### Begründung

<table>
<tr>
<th>Kriterium</th>
<th>Mit Normalisierung</th>
<th>Ohne Anpassung</th>
</tr>

<tr>
<td><b>Kompatibilität mit bestehender Logik</b></td>
<td>✅ gegeben</td>
<td>❌ nicht gegeben</td>
</tr>

<tr>
<td><b>Flexibilität bei Input-Dateien</b></td>
<td>✅ hoch</td>
<td>❌ gering</td>
</tr>

<tr>
<td><b>Implementierungsaufwand</b></td>
<td>✅ gering</td>
<td>✅ gering</td>
</tr>

<tr>
<td><b>Wartbarkeit</b></td>
<td>✅ zentral steuerbar</td>
<td>❌ Workarounds erforderlich</td>
</tr>

</table>

Die Normalisierung ermöglicht die Wiederverwendung der bestehenden Matching-Logik (siehe ADR-012), ohne strukturelle Änderungen am Gesamtsystem.

---

### Technische Umsetzung

Einführung einer zentralen Funktion zur Normalisierung von Dateinamen:

```ts
function normalizeFileName(fileName: string): string {
  if (fileName.startsWith("SCI-")) {
    return fileName.substring(4);
  }
  return fileName;
}
