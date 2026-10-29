/**
 * Connections upload into Client library, and the Books / Reports labels.
 * Run: pnpm test:connections-library-upload
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { archiveUploads } from "../src/lib/client-documents-browser";
import { parseDocumentMeta, uploadSourceLabel } from "../src/lib/client-documents";
import {
  libraryFileKind,
  libraryProcessingSummary,
  librarySaveAfterReadError,
  libraryUploadLabel,
} from "../src/lib/connections-library-upload";
import {
  canonicalizeAccountantSearch,
  clientNavSearch,
  clientRailSelection,
} from "../src/lib/client-route-search";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(libraryFileKind({ name: "pnl.pdf", type: "application/pdf" }) === "pdf", "pdf");
assert(libraryFileKind({ name: "pnl.PDF", type: "" }) === "pdf", "pdf extension");
assert(libraryFileKind({ name: "tb.csv", type: "text/csv" }) === "csv", "csv");
assert(libraryFileKind({ name: "tb.CSV", type: "" }) === "csv", "csv extension");
assert(
  libraryFileKind({
    name: "tb.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }) === "excel",
  "xlsx",
);
assert(libraryFileKind({ name: "tb.xls", type: "" }) === "excel", "xls");
assert(libraryFileKind({ name: "tb.xlsm", type: "" }) === "excel", "xlsm");
assert(libraryFileKind({ name: "note.txt", type: "text/plain" }) === null, "plain text stays out");
assert(libraryFileKind({ name: "books.ods", type: "" }) === null, "opendocument stays out");
assert(libraryFileKind({ name: "scan.png", type: "image/png" }) === null, "photos stay out");

assert(libraryUploadLabel("financial_statement", "") === "Financial statement", "blank label uses the type");
assert(libraryUploadLabel("tax", "  IRP5 2026  ") === "IRP5 2026", "a custom label wins");
assert(libraryUploadLabel("other", "   ") === null, "other needs a name");
assert(libraryUploadLabel("other", "Engagement letter") === "Engagement letter", "other keeps the name");
assert(libraryUploadLabel("nope", "x") === null, "unknown type is refused");

const summary = libraryProcessingSummary({
  entityName: "Acme",
  periodEnd: "2026-03-31",
  notes: "Revenue as printed.",
});
assert(summary === "Acme · 2026-03-31. Revenue as printed.", "the library line names the read");
assert(libraryProcessingSummary({}).length > 0, "an empty read still has a line");
assert(!librarySaveAfterReadError("ANTHROPIC_API_KEY is not configured."), "a missing key is not archived");
assert(librarySaveAfterReadError("We couldn't read enough figures from this file to be useful."), "a thin file is still saved");

const inserted: Array<{ meta: { source?: string; account_label?: string; summary?: string; document_type?: string }; visibility: string }> = [];
const archived = await archiveUploads(
  {
    clientId: "client-1",
    visibility: "shared",
    source: "connections",
    items: [
      {
        file: new File(["revenue,100"], "pnl.csv", { type: "text/csv" }),
        accountLabel: "Financial statement",
        documentType: "financial_statement",
        summary,
      },
    ],
  },
  {
    userId: async () => "accountant-1",
    insertArtifact: async (row) => {
      inserted.push(row);
      return { error: null };
    },
    deleteArtifact: async () => undefined,
    copyStaged: async () => ({ error: null }),
    uploadFile: async () => ({ error: null }),
    newId: () => "artifact-1",
  },
);
assert(archived.archived.length === 1 && archived.failed.length === 0, "the csv is archived");
assert(inserted[0]?.visibility === "shared", "an accountant upload is shared so Client library can list it");
assert(inserted[0]?.meta.source === "connections", "the row is a Connections upload");
assert(inserted[0]?.meta.account_label === "Financial statement", "the label is the document type");
assert(inserted[0]?.meta.document_type === "financial_statement", "the type id is stored");
assert(inserted[0]?.meta.summary === summary, "the Sonnet line is stored on the row");
const parsed = parseDocumentMeta(inserted[0]?.meta);
assert(parsed.source === "connections" && parsed.summary === summary, "the library reader keeps the summary");
assert(uploadSourceLabel("connections") === "Connections", "the row says Connections");

const pack = canonicalizeAccountantSearch({ tab: "reports", section: "drafts" });
assert(pack.section === "drafts", "Advisory pack keeps section=drafts");
const tool = clientNavSearch({ tab: "home" }, "reports", "draft-tool");
assert(tool.tab === "reports" && tool.section === "draft-tool", "Draft tool is its own section");
const drafter = canonicalizeAccountantSearch({ tab: "drafter" });
assert(drafter.section === "draft-tool", "the old drafter address opens Draft tool");
const library = canonicalizeAccountantSearch({ tab: "books", section: "client-library" });
assert(library.tab === "portal" && library.section === "documents", "Client library keeps the documents section");
const marked = clientRailSelection({ tab: "portal", section: "documents" });
assert(marked.headingId === "books" && marked.subId === "documents", "Client library stays under Books");

const chrome = readFileSync(resolve("src/components/client-studio-chrome.tsx"), "utf8");
assert(chrome.includes('{ id: "documents", label: "Client library" }'), "sidebar says Client library");
assert(chrome.includes('{ id: "drafts", label: "Advisory pack" }'), "sidebar says Advisory pack");
assert(chrome.includes('{ id: "draft-tool", label: "Draft tool" }'), "sidebar says Draft tool");
assert(!chrome.includes('label: "Documents"'), "the Books item is no longer Documents");
assert(!chrome.includes('label: "Drafts"'), "the Reports item is no longer Drafts");

const route = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(route.includes('title="Client library"'), "the page title is Client library");
assert(route.includes('title="Advisory pack"'), "the pack page title is Advisory pack");
assert(route.includes('title="Draft tool"'), "the tool page title is Draft tool");
assert(route.includes("<ConnectionsLibraryUpload"), "Connections mounts the upload");
const draftsAt = route.indexOf('id="reports-drafts"');
const toolAt = route.indexOf('id="reports-draft-tool"');
const pdfsAt = route.indexOf('id="reports-pdfs"');
const packPane = route.slice(draftsAt, toolAt);
const toolPane = route.slice(toolAt, pdfsAt);
assert(packPane.includes("AdvisoryPackPanel") && !packPane.includes("AdvisoryDrafter"), "the pack list stays on Advisory pack");
assert(toolPane.includes("AdvisoryDrafter") && !toolPane.includes("AdvisoryPackPanel"), "the drafter is the Draft tool");

const panel = readFileSync(resolve("src/components/connections-library-upload.tsx"), "utf8");
assert(panel.includes("extractFinancialsFromPDF"), "the read is the existing Sonnet statement path");
assert(panel.includes('source: "connections"'), "the file uses the client-documents archive");
assert(panel.includes("archiveUploads"), "there is no second store");
assert(panel.includes('accept={LIBRARY_UPLOAD_ACCEPT}'), "the picker is PDF, CSV, and Excel");
assert(panel.includes('section: "documents"'), "Open Client library keeps the documents route");

console.log("connections-library-upload-test: ok");
