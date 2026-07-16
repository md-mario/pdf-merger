// ADR-018: HTTP Trigger – Download-Function für MasterPDFs
// Liest den MasterPDF-Eintrag, prüft Status, erzeugt SAS-Link und antwortet mit HTTP 302 Redirect.
// SAS-Token wird nur zur Laufzeit erzeugt und NICHT gespeichert.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getMasterPdfEntity } from "../infrastructure/tableStorage";
import { blobExists, createReadOnlySasUrl } from "../infrastructure/blobStorage";

const OUTPUT_CONTAINER = "pdf-output";
const SAS_EXPIRES_MINUTES = 5;

/**
 * Stellt einen kurzlebigen SAS-Download-Link für eine fertige Master-PDF bereit.
 * Route: GET /api/download/{rowKey}
 */
export async function downloadMasterPdf(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const rowKey = request.params["rowKey"];

  if (!rowKey) {
    return { status: 400, body: "rowKey is required" };
  }

  context.log(`downloadMasterPdf: Anfrage für rowKey="${rowKey}"`);

  // 1. Entity aus Table Storage laden
  const entity = await getMasterPdfEntity(rowKey);
  if (!entity) {
    context.warn(`downloadMasterPdf: Entity nicht gefunden – rowKey="${rowKey}"`);
    return { status: 404, body: "MasterPDF entity not found" };
  }

  // 2. Status prüfen – Download nur bei "pending" oder "completed" erlaubt
  if (entity.status === "new" || entity.status === "failed") {
    context.warn(
      `downloadMasterPdf: Status "${entity.status}" erlaubt keinen Download – rowKey="${rowKey}"`
    );
    return { status: 409, body: `MasterPDF is not ready for download (status: ${entity.status})` };
  }

  // 3. Blob-Existenz prüfen (ADR-013: blobName = rowKey = Filename)
  const blobName = rowKey;
  const exists = await blobExists(OUTPUT_CONTAINER, blobName);
  if (!exists) {
    context.warn(`downloadMasterPdf: Blob nicht gefunden – container="${OUTPUT_CONTAINER}" blob="${blobName}"`);
    return { status: 404, body: "Blob not found" };
  }

  // 4. SAS-URL erzeugen und HTTP 302 Redirect zurückgeben
  const sasUrl = await createReadOnlySasUrl(OUTPUT_CONTAINER, blobName, SAS_EXPIRES_MINUTES);

  context.log(
    `downloadMasterPdf: Redirect für rowKey="${rowKey}" – SAS gültig ${SAS_EXPIRES_MINUTES} Minuten`
  );

  return {
    status: 302,
    headers: { Location: sasUrl },
  };
}

// Registrierung nur außerhalb von Testumgebungen (ADR-008)
if (process.env["NODE_ENV"] !== "test") {
  app.http("downloadMasterPdf", {
    methods: ["GET"],
    authLevel: "function",
    route: "download/{rowKey}",
    handler: downloadMasterPdf,
  });
}
