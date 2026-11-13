/**
 * Reload fan-in. The card line waits on the boot clients select.
 * Ledger status, snapshots, and the plan wait until that select settles.
 * Run: pnpm test:fan-in-boot
 */
import { readFileSync } from "node:fs";
import { applyIngestStamp, boardFiguresFrom } from "../src/lib/ledger-link-copy.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import {
  HOME_BOOKS_CHECKING,
  homeLedgerChip,
  homeLinesWhileLedgerPending,
} from "../src/lib/connect-books-copy.ts";
import { assignmentsFromNotes } from "../src/lib/owner-handoff-client.ts";
import { CLIENT_HOME_NOTHING } from "../src/lib/client-home-phase.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pending = homeLedgerChip({ known: false, xero: null, qbo: null, sage: null });
assert(pending.pending && !pending.booksMissing && pending.ledger === null, "unknown is not an empty chip");

const xero = homeLedgerChip({ known: true, xero: { tenantId: "t" }, qbo: null, sage: null });
assert(xero.ledger === "Xero" && !xero.booksMissing && !xero.pending, "Xero chip");

const qbo = homeLedgerChip({ known: true, xero: null, qbo: { realmId: "r" }, sage: null });
assert(qbo.ledger === "QuickBooks" && !qbo.booksMissing, "QuickBooks chip");

const sage = homeLedgerChip({ known: true, xero: null, qbo: null, sage: { companyId: "1" } });
assert(sage.ledger === "Sage" && !sage.booksMissing, "Sage chip");

const none = homeLedgerChip({ known: true, xero: null, qbo: null, sage: null });
assert(none.ledger === null && none.booksMissing && !none.pending, "no ledger shows the connect card");

const cash = {
  financial_manager: ["Cash is $46,300."],
  analyst: ["Profit is on file."],
  advisor: ["No next move yet."],
};
const heldCash = homeLinesWhileLedgerPending(cash, true);
assert(heldCash.financial_manager[0] === "Cash is $46,300.", "a real cash line is not replaced");
assert(!heldCash.financial_manager.includes(CLIENT_HOME_NOTHING), "pending does not invent an empty card");

const connect = {
  financial_manager: ["Connect QuickBooks / Xero or upload statements."],
  analyst: [] as string[],
  advisor: [] as string[],
};
const heldConnect = homeLinesWhileLedgerPending(connect, true);
assert(
  heldConnect.financial_manager[0] === HOME_BOOKS_CHECKING &&
    heldConnect.analyst[0] === HOME_BOOKS_CHECKING &&
    heldConnect.advisor[0] === HOME_BOOKS_CHECKING,
  "a connect headline waits, and the other cards are not left blank",
);
assert(!heldConnect.financial_manager[0].startsWith("Connect"), "pending does not say no books");
const settledConnect = homeLinesWhileLedgerPending(connect, false);
assert(settledConnect.financial_manager[0].startsWith("Connect QuickBooks"), "a known miss can say connect");

const board = boardFiguresFrom({
  financials: { revenue: 10, cash: 46300, statementSource: "xero", periodLabel: "Oct 2026" },
  financialsUpdatedAt: "2026-10-01T00:00:00.000Z",
  market: ZA_MARKET,
});
const stamped = applyIngestStamp(board, [
  { source: "xero", created_at: "2026-11-01T00:00:00.000Z" },
]);
assert(stamped?.savedAt === "2026-11-01T00:00:00.000Z", "Connections keeps the later snapshot stamp");
assert(stamped?.source === "xero", "snapshot attribution keeps the source");
assert(applyIngestStamp(board, [])?.savedAt === board?.savedAt, "no snapshot leaves the financials stamp");

const notes = new Map([
  [
    "item-1",
    [{ note: "Assigned to Analyst.", at: "2026-11-01T00:00:00.000Z", actorLabel: null, actorType: "bot" }],
  ],
]);
const assignments = assignmentsFromNotes(notes);
assert(assignments.size === 1, "one notes read still yields the assignment");

const clientSrc = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const ownerSrc = readFileSync("src/routes/app.tsx", "utf8");
const xeroSrc = readFileSync("src/lib/xero.functions.ts", "utf8");
const qboSrc = readFileSync("src/lib/qbo.functions.ts", "utf8");
const xeroCard = readFileSync("src/components/xero-connect.tsx", "utf8");
const qboCard = readFileSync("src/components/qbo-connect.tsx", "utf8");
const fresh = readFileSync("src/components/data-up-to-date.tsx", "utf8");

assert(clientSrc.includes("owner_user_id, auto_update_prefs"), "boot select carries the extra columns");
assert(!clientSrc.includes("loadLatestAssignments"), "action notes are read once");
assert(clientSrc.includes("assignmentsFromNotes(noteLog)"), "the assignment comes from that one read");
assert(!clientSrc.includes("[clientId, client?.financials_updated_at]"), "snapshots do not re-run on the stamp");
assert(clientSrc.includes("if (!homeBootReady || !clientId) return;"), "side reads wait for the boot select");
assert(clientSrc.includes("ingestSnapshots={snapshots}"), "Connections receives the one snapshot read");
assert(clientSrc.includes("markClientReload()"), "new-tab reload mark stays");
assert(clientSrc.includes("rememberWarmBootCard"), "warm card write stays");

const xeroStatus = xeroSrc.slice(xeroSrc.indexOf("export const getXeroStatus"), xeroSrc.indexOf("export const getXeroStatuses"));
const qboStatus = qboSrc.slice(qboSrc.indexOf("export const getQboStatus"), qboSrc.indexOf("export const getQboStatuses"));
assert(!xeroStatus.includes("client_financial_snapshots"), "Xero status does not read snapshots");
assert(!qboStatus.includes("client_financial_snapshots"), "QuickBooks status does not read snapshots");
assert(xeroSrc.includes("client_financial_snapshots"), "Xero sync still writes snapshots");
assert(xeroCard.includes("applyIngestStamp"), "Xero card stamps the overview from the browser read");
assert(qboCard.includes("applyIngestStamp"), "QuickBooks card stamps the overview from the browser read");
assert(fresh.includes("ingestSnapshots={ingestSnapshots}"), "Connections passes the snapshot rows through");

assert(ownerSrc.includes("beginOwnerClientReads("), "owner cashflow and financials stay split");
assert(ownerSrc.includes("auto_update_prefs"), "owner boot select carries the prefs column");
assert(ownerSrc.includes("ownerBootReadyId !== effectiveClientId"), "owner side reads wait for the boot selects");
const ownerSnap = ownerSrc.indexOf('.from("client_financial_snapshots")');
const ownerGate = ownerSrc.indexOf("ownerBootReadyId !== effectiveClientId");
assert(ownerGate > 0 && ownerGate < ownerSnap, "the owner snapshot read is behind the boot gate");

console.log("fan-in boot ok");
