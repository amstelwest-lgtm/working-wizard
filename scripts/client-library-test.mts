/**
 * Client library tabs. Locked headings, year groups, and search.
 * Run: pnpm test:client-library
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientLibraryView } from "../src/components/client-library";
import {
  CLIENT_LIBRARY_DEFAULT_TAB,
  CLIENT_LIBRARY_TAB_LABEL,
  CLIENT_LIBRARY_TABS,
  classifyLibraryFile,
  clientSendLibraryFlags,
  groupLibraryFilesByYear,
  libraryFilesForTab,
  libraryFilesFromSourceRows,
  libraryReviewCount,
  sourceDocumentNeedsReview,
  type LibraryFile,
} from "../src/lib/client-library";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pnl = classifyLibraryFile({
  id: "pnl",
  name: "acme-pnl.pdf",
  at: "2026-04-02T08:00:00.000Z",
  visibility: "shared",
  source: "connections",
  documentType: "financial_statement",
  summary: "Acme · 2025-03-31. Revenue as printed.",
  storagePath: "client/pnl.pdf",
  uploadId: "pnl",
});
assert(
  pnl.tabs.includes("profit") && pnl.tabs.includes("shared"),
  "a shared statement is profit and shared",
);
assert(!pnl.tabs.includes("from-client"), "a Connections upload is not from the client");
assert(!pnl.tabs.includes("cash"), "a statement is not cash");
assert(pnl.year === "2025", "the read's period end sets the year");

const bank = classifyLibraryFile({
  id: "bank",
  name: "checking.pdf",
  at: "2026-02-01T00:00:00.000Z",
  visibility: "private",
  source: "bank_pack",
  storagePath: "client/bank.pdf",
});
assert(
  bank.tabs.includes("cash") && bank.tabs.includes("from-client"),
  "an owner bank pack is cash from the client",
);
assert(!bank.tabs.includes("shared"), "a private file is not on Shared");
assert(bank.year === "2026", "a nameless file uses the day it was saved");

const sent = classifyLibraryFile({
  id: "sent",
  name: "statements.pdf",
  at: "2024-11-01T00:00:00.000Z",
  visibility: "shared",
  source: "client_agent_send",
  itemKey: "bank_statements",
});
assert(
  sent.tabs.includes("cash") && sent.tabs.includes("from-client") && sent.tabs.includes("shared"),
  "bank statements from the client are cash, from client, and shared",
);
const incomingFlags = clientSendLibraryFlags({ source: "client_agent_send", item_key: "irp5" });
assert(
  incomingFlags?.needsReview === true && incomingFlags.statusLabel === "Waiting to be read",
  "a client send waits in Needs review",
);
const incoming = classifyLibraryFile({
  id: "incoming",
  name: "irp5.pdf",
  at: "2026-11-01T00:00:00.000Z",
  visibility: "shared",
  source: "client_agent_send",
  fromClient: incomingFlags?.fromClient,
  needsReview: incomingFlags?.needsReview,
  statusLabel: incomingFlags?.statusLabel,
});
assert(
  incoming.tabs.includes("from-client") &&
    incoming.tabs.includes("review") &&
    incoming.tabs.includes("shared"),
  "a new client file is From client and Needs review",
);
const reviewedFlags = clientSendLibraryFlags({ source: "client_agent_send", reviewed: true });
assert(
  reviewedFlags?.needsReview === false && reviewedFlags.statusLabel === "Reviewed",
  "a reviewed send leaves Needs review",
);
assert(
  clientSendLibraryFlags({ source: "connections" }) === null,
  "connections is not a client send",
);

const named = classifyLibraryFile({
  id: "named",
  name: "management-accounts-2023.xlsx",
  at: "2026-01-01T00:00:00.000Z",
  visibility: "shared",
  source: "connections",
  documentType: "management_accounts",
});
assert(named.year === "2023", "the file name year wins when the read has none");
assert(named.tabs.includes("profit"), "management accounts sit under profit and loss");

const undated = classifyLibraryFile({ id: "bare", name: "note", at: null });
assert(undated.year === "Undated", "a file with no date is undated");

const source = libraryFilesFromSourceRows({
  documents: [
    {
      id: "bill-1",
      storage_path: "client/invoice.pdf",
      status: "received",
      received_at: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "stmt-1",
      storage_path: "client/bank.pdf",
      status: "extracted",
      received_at: "2024-01-15T00:00:00.000Z",
    },
    {
      id: "done-1",
      storage_path: "client/paid.pdf",
      status: "proposed",
      received_at: "2026-03-01T00:00:00.000Z",
    },
  ],
  extractions: [
    { document_id: "stmt-1", doc_type: "bank_statement", created_at: "2024-01-16T00:00:00.000Z" },
    { document_id: "done-1", doc_type: "bill", created_at: "2026-03-02T00:00:00.000Z" },
  ],
  proposals: [
    {
      document_id: "done-1",
      status: "approved",
      doc_type: "bill",
      issued_on: "2025-12-01",
      created_at: "2026-03-03T00:00:00.000Z",
    },
  ],
});
const bill = source.find((file) => file.id === "source:bill-1");
const statement = source.find((file) => file.id === "source:stmt-1");
const approved = source.find((file) => file.id === "source:done-1");
assert(
  bill?.tabs.includes("review") && bill.tabs.includes("from-client"),
  "an unread bill needs review and is from the client",
);
assert(
  statement?.tabs.includes("cash") && !statement.needsReview,
  "a bank statement on file is cash, not a review item",
);
assert(
  approved && !approved.needsReview && approved.year === "2025",
  "an approved bill uses the invoice year and leaves the review queue",
);
assert(
  sourceDocumentNeedsReview({ status: "extract_failed" }),
  "a file that could not be read stays in review",
);
assert(!sourceDocumentNeedsReview({ status: "duplicate" }), "a duplicate is not a review item");

const files: LibraryFile[] = [pnl, bank, sent, named, undated, ...source];
assert(libraryReviewCount(files) === 1, "only the unread bill is waiting");
const profitYears = groupLibraryFilesByYear(libraryFilesForTab(files, "profit", ""));
assert(
  profitYears.map((group) => group.year).join(",") === "2025,2023",
  "profit files group by year, newest first",
);
const allYears = groupLibraryFilesByYear(libraryFilesForTab(files, "all", ""));
assert(allYears[allYears.length - 1]?.year === "Undated", "undated files sit last");
assert(
  libraryFilesForTab(files, "all", "acme").length === 1,
  "search matches the file name and the read",
);
assert(
  libraryFilesForTab(files, "cash", "2024")
    .map((file) => file.id)
    .join(",") === "sent,source:stmt-1",
  "search can target a year inside a tab",
);
assert(CLIENT_LIBRARY_DEFAULT_TAB === "all", "all files is the overview");
assert(
  CLIENT_LIBRARY_TABS.map((tab) => CLIENT_LIBRARY_TAB_LABEL[tab]).join("|") ===
    "Profit & loss|Cash & bank|From client|Needs review|Shared|All files",
  "the locked headings stay in order",
);

const html = renderToStaticMarkup(
  createElement(ClientLibraryView, {
    files,
    tab: "all",
    query: "",
    onTab: () => undefined,
    onQuery: () => undefined,
    audience: "accountant",
    formatWhen: (iso: string) => iso.slice(0, 10),
  }),
);
let cursor = 0;
for (const tab of CLIENT_LIBRARY_TABS) {
  const at = html.indexOf(`data-library-tab="${tab}"`);
  assert(at > cursor, `${CLIENT_LIBRARY_TAB_LABEL[tab]} stays in the locked order`);
  cursor = at;
}
assert(
  html.includes("Profit &amp; loss") && html.includes("Cash &amp; bank"),
  "the menu uses the locked names",
);
assert(
  html.includes("From client") &&
    html.includes("Needs review") &&
    html.includes("Shared") &&
    html.includes("All files"),
  "the rest of the locked names render",
);
for (const rejected of [">Files<", ">Figures<", ">Client brain<"]) {
  assert(!html.includes(rejected), `${rejected} is not a library tab`);
}
assert(html.includes('data-library-year="2026"'), "the overview groups a year");
assert(html.includes("No year on file"), "undated files have a year heading");
assert(html.includes("data-library-search"), "the library has a search field");
assert(html.includes("acme-pnl.pdf"), "the table shows the file name");

const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const documents = route.slice(route.indexOf('id="documents"'), route.indexOf('id="connections"'));
assert(documents.includes("<ClientLibrary"), "accountant Client library mounts the tabbed library");
assert(
  !documents.includes("ClientBrainSummary") && !documents.includes("<StatementFigures"),
  "the library page drops the brain and figures panes",
);
const ownerPages = readFileSync("src/components/owner-door/owner-pages.tsx", "utf8");
assert(
  ownerPages.includes('className="owner-sub">Client library'),
  "the owner heading is Client library",
);
assert(
  !ownerPages.includes('className="owner-sub">Documents'),
  "the owner heading is no longer Documents",
);

console.log("client-library-test: ok");
