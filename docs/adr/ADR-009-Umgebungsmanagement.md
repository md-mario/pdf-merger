# ADR-009: Umgebungsmanagement (Dev/Prod)

## Status
Accepted

---

## Kontext
Die Lösung muss in **zwei Umgebungen** betrieben werden:
- **Dev-Umgebung**: Für Entwicklung, Tests und Integrationstests.
- **Prod-Umgebung**: Für den Live-Betrieb.

Optionen für das Umgebungsmanagement:
1. **Azure Resource Manager (ARM) Templates**: Manuelle Bereitstellung.
2. **Azure Bicep**: Deklarative Bereitstellung.
3. **Terraform**: Infrastruktur als Code (IaC).
4. **Manuelle Konfiguration**: Separate Ressourcengruppen für Dev/Prod.

---

## Entscheidung
Verwendung von:
- **Separaten Azure Ressourcengruppen** für Dev und Prod.
- **Azure Bicep** für die Bereitstellung der Infrastruktur (Function App, Blob Storage, etc.).
- **Umgebungsvariablen** zur Unterscheidung zwischen Dev und Prod (z. B. `NODE_ENV=development` vs. `NODE_ENV=production`).

---

## Begründung
| Kriterium | ARM Templates | Bicep | Terraform | Manuell |
|-----------|---------------|-------|-----------|---------|
| **Einfachheit** | ✅ | ✅ | ❌ | ❌ |
| **Wartbarkeit** | ✅ | ✅ | ✅ | ❌ |
| **Azure-Integration** | ✅ | ✅ | ✅ | ✅ |
| **Lernkurve** | ❌ | ✅ | ❌ | ✅ |

- **Vorteile**:
  - **Bicep**: Native Azure-Lösung, einfach zu lernen, gut integriert.
  - **Separate Ressourcengruppen**: Klare Trennung zwischen Dev und Prod.
  - **Umgebungsvariablen**: Einfache Unterscheidung im Code.
- **Nachteile**:
  - Bicep ist weniger verbreitet als Terraform (aber für Azure optimal).

---

## Infrastruktur-Definition

### 1. Ressourcengruppen
| Umgebung | Ressourcengruppe | Beschreibung |
|----------|------------------|--------------|
| Dev | `pdf-merger-dev` | Entwicklungsumgebung mit Testdaten. |
| Prod | `pdf-merger-prod` | Produktionsumgebung mit echten Daten. |

### 2. Azure Bicep-Dateien
- **`infra/main.bicep`**: Haupttemplate für Function App, Blob Storage, etc.
- **`infra/parameters.dev.json`**: Parameter für Dev-Umgebung.
- **`infra/parameters.prod.json`**: Parameter für Prod-Umgebung.

### 3. Umgebungsvariablen
| Variable | Dev-Wert | Prod-Wert | Beschreibung |
|----------|----------|-----------|--------------|
| `NODE_ENV` | `development` | `production` | Unterscheidung zwischen Dev und Prod. |
| `LOG_LEVEL` | `debug` | `info` | Log-Level für die Umgebung. |
| `STORAGE_ACCOUNT` | `<dev-storage>` | `<prod-storage>` | Speicherkonto für die Umgebung. |

---

## Konsequenzen
- **Positiv**:
  - Klare Trennung zwischen Dev und Prod.
  - Automatisierte Bereitstellung mit Bicep.
  - Skalierbar und wartbar.
- **Negativ**:
  - Zusätzlicher Aufwand für die Bereitstellung der Infrastruktur.
  - Unterschiedliche Konfigurationen müssen gepflegt werden.