// ADR-017: SharePoint-Client – Graph API Implementierung
// Authentifizierung: Entra ID App Registration (Client Credentials Flow)
// Berechtigung: Sites.ReadWrite.All (Application)
// Konfiguration via App Settings / local.settings.json:
//   SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET,
//   SHAREPOINT_SITE_URL, SHAREPOINT_LIST_NAME

import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { MasterPdfEvent } from "../models/masterPdfEvent";

// ─── Konfiguration ────────────────────────────────────────────────────────────

function getConfig() {
  const tenantId = process.env["SHAREPOINT_TENANT_ID"];
  const clientId = process.env["SHAREPOINT_CLIENT_ID"];
  const clientSecret = process.env["SHAREPOINT_CLIENT_SECRET"];
  const siteUrl = process.env["SHAREPOINT_SITE_URL"];
  const listName = process.env["SHAREPOINT_LIST_NAME"] ?? "MasterPDFs";

  if (!tenantId || !clientId || !clientSecret || !siteUrl) {
    throw new Error(
      "SharePoint-Konfiguration unvollständig. Benötigt: " +
        "SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET, SHAREPOINT_SITE_URL"
    );
  }

  return { tenantId, clientId, clientSecret, siteUrl, listName };
}

// ─── Graph-Client ─────────────────────────────────────────────────────────────

function buildGraphClient(tenantId: string, clientId: string, clientSecret: string): Client {
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });
  return Client.initWithMiddleware({ authProvider });
}

// ─── SharePoint Site-ID ermitteln ─────────────────────────────────────────────

async function getSiteId(client: Client, siteUrl: string): Promise<string> {
  // siteUrl Format: https://<tenant>.sharepoint.com/sites/<siteName>
  const url = new URL(siteUrl);
  const hostname = url.hostname;
  const sitePath = url.pathname; // z.B. /sites/MeinPortal
  const response = await client
    .api(`/sites/${hostname}:${sitePath}`)
    .select("id")
    .get() as { id: string };
  return response.id;
}

// ─── Listen-ID ermitteln ──────────────────────────────────────────────────────

async function getListId(client: Client, siteId: string, listName: string): Promise<string> {
  const response = await client
    .api(`/sites/${siteId}/lists`)
    .filter(`displayName eq '${listName}'`)
    .select("id")
    .get() as { value: Array<{ id: string }> };

  if (!response.value.length) {
    throw new Error(`SharePoint-Liste "${listName}" nicht gefunden`);
  }
  return response.value[0].id;
}

// ─── Listeneintrag suchen (per Title = rowKey) ────────────────────────────────

/**
 * OData-Escaping: Einfache Anführungszeichen in Filterwerten verdoppeln.
 * Schützt vor Fehlern bei Dateinamen mit Sonderzeichen.
 */
function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Sucht einen bestehenden Listeneintrag anhand von Title (= rowKey).
 *
 * Die Title-Spalte ist in manchen SharePoint-Konfigurationen nicht indiziert.
 * Mit dem Prefer-Header erlaubt SharePoint den Filter, kann aber sporadisch
 * mit HTTP 500 (generalException) antworten.
 *
 * Fallback: Bei 500 wird null zurückgegeben → Aufrufer legt neuen Eintrag an.
 * Dauerlösung: Title-Spalte in der SharePoint-Liste als Index markieren
 *              (Listeneinstellungen → Indizierte Spalten → Title hinzufügen).
 */
async function findListItem(
  client: Client,
  siteId: string,
  listId: string,
  rowKey: string
): Promise<string | null> {
  try {
    const response = await client
      .api(`/sites/${siteId}/lists/${listId}/items`)
      .header("Prefer", "HonorNonIndexedQueriesWarningMayFailRandomly")
      .filter(`fields/Title eq '${escapeOData(rowKey)}'`)
      .select("id")
      .get() as { value: Array<{ id: string }> };

    return response.value.length ? response.value[0].id : null;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    // HTTP 500 (generalException): nicht indizierte Suche schlug fehl.
    // Eintrag wird neu angelegt; mögliche Duplikate können über die
    // SharePoint-Liste bereinigt werden.
    if (status === 500) return null;
    throw err;
  }
}

// ─── Listeneintrag erstellen oder aktualisieren ───────────────────────────────

interface SharePointFields {
  Title: string;
  MasterPdfName: string;
  Status: string;
  Timestamp: string;
  MissingDetailCount: number;
  MissingDetails: string;
  // Link als "Einzelne Textzeile" (nicht Hyperlink) – SharePoint erlaubt
  // das Schreiben von Hyperlink-Spalten nicht via Application Permissions (App-Only).
  // Als Textfeld ist der Wert per App-Only schreibbar und bleibt in SharePoint
  // anklickbar, solange er mit https:// beginnt.
  Link: string;
  PartitionKey: string;
  RowKey: string;
}

function buildFields(event: MasterPdfEvent): SharePointFields {
  const absoluteUrl = toAbsoluteUrl(event.downloadPath);
  return {
    Title: event.rowKey,
    MasterPdfName: event.masterPdfName,
    Status: event.status,
    Timestamp: event.timestamp,
    MissingDetailCount: event.missingDetailCount,
    MissingDetails: JSON.stringify(event.missingDetails),
    Link: toAbsoluteUrl(event.downloadPath),
    PartitionKey: event.partitionKey,
    RowKey: event.rowKey,
  };
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/**
 * Löst einen relativen Pfad zu einer absoluten URL auf.
 * Reihenfolge: FUNCTION_APP_BASE_URL → https://WEBSITE_HOSTNAME → http://localhost:7071
 */
function toAbsoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base =
    process.env["FUNCTION_APP_BASE_URL"] ??
    (process.env["WEBSITE_HOSTNAME"] ? `https://${process.env["WEBSITE_HOSTNAME"]}` : "http://localhost:7071");
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

// ─── Öffentliche API ──────────────────────────────────────────────────────────

/**
 * Synchronisiert einen MasterPDF-Eintrag in die SharePoint-Liste.
 * Aktualisiert den bestehenden Eintrag oder legt einen neuen an (ADR-020).
 *
 * @param event         Queue-Event mit den zu synchronisierenden Daten.
 * @param storedItemId  Gespeicherte SharePoint-Item-ID aus Table Storage.
 *                      Wenn vorhanden, wird direkt PATCH ohne Suchabfrage durchgeführt.
 * @returns             Die SharePoint-Item-ID des Eintrags.
 *
 * ADR-017: SharePoint ist reine Anzeigeschicht – Fehler hier blockieren nicht
 *          die PDF-Verarbeitung. Der Aufrufer (postProcessTrigger) behandelt Fehler.
 */
export async function syncToSharePoint(event: MasterPdfEvent, storedItemId?: string): Promise<string> {
  const { tenantId, clientId, clientSecret, siteUrl, listName } = getConfig();

  const client = buildGraphClient(tenantId, clientId, clientSecret);
  const siteId = await getSiteId(client, siteUrl);
  const listId = await getListId(client, siteId, listName);
  const fields = buildFields(event);

  console.log("[SharePoint] Payload:", JSON.stringify(fields, null, 2));

  // Wenn eine gespeicherte Item-ID vorliegt, direkt PATCH – keine Suchabfrage nötig (ADR-020)
  const resolvedItemId = storedItemId ?? await findListItem(client, siteId, listId, event.rowKey);

  try {
    if (resolvedItemId) {
      // Aktualisieren
      await client
        .api(`/sites/${siteId}/lists/${listId}/items/${resolvedItemId}/fields`)
        .patch(fields);
      return resolvedItemId;
    } else {
      // Neu anlegen
      const created = await client
        .api(`/sites/${siteId}/lists/${listId}/items`)
        .post({ fields }) as { id: string };
      return created.id;
    }
  } catch (err: unknown) {
    const graphErr = err as { statusCode?: number; message?: string; body?: string; code?: string };
    console.error("[SharePoint] Graph API Fehler:", {
      statusCode: graphErr.statusCode,
      code: graphErr.code,
      message: graphErr.message,
      body: graphErr.body,
      fields: JSON.stringify(fields, null, 2),
    });
    throw err;
  }
}
