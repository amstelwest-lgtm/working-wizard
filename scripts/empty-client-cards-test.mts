/**
 * Empty-client reports and connections, from the real no-books row:
 * financials NULL, no snapshots, no connection rows.
 * Run: pnpm test:empty-client-cards
 */
import { readFileSync } from "node:fs";
import { reportDownloadGate } from "../src/lib/report-coherence";
import {
  FIGURES_READ_DEADLINE_MS,
  NO_FIGURES_REPORT_REASON,
  financialsHaveRevenue,
  reportCardNoFiguresState,
  reportIndexDetail,
  reportReadShowsFigures,
} from "../src/lib/report-card-state";
import {
  CONNECTION_NOT_CONNECTED,
  CONNECTION_STATUS_DEADLINE_MS,
  connectionRestingPhase,
  enqueueConnectionCheck,
  resetConnectionStatusQueue,
  resolveConnectionStatus,
} from "../src/lib/connection-status-deadline";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** New York Test company shape: financials NULL, no statements, no connections. */
const noBooksClient = {
  id: "ef300993-0000-4000-8000-000000000001",
  name: "New York Test company",
  financials: null as null,
  snapshots: [] as unknown[],
  connections: { xero: null, qbo: null, sage: null },
};

assert(noBooksClient.financials === null, "the real no-books row stores financials NULL");
assert(noBooksClient.snapshots.length === 0, "a no-books client has no statement snapshots");
assert(
  noBooksClient.connections.xero === null &&
    noBooksClient.connections.qbo === null &&
    noBooksClient.connections.sage === null,
  "a no-books client has no connection rows",
);
assert(financialsHaveRevenue(noBooksClient.financials) === false, "NULL financials are not figures");
assert(financialsHaveRevenue({}) === false, "an empty financials object is not figures");
assert(financialsHaveRevenue({ revenue: "" }) === false, "a blank revenue string is not figures");
assert(financialsHaveRevenue({ revenue: "  " }) === false, "whitespace revenue is not figures");
assert(financialsHaveRevenue({ revenue: "100" }) === true, "a revenue string is figures");

const pendingWithRevenue = reportReadShowsFigures({
  clientLinked: true,
  status: "pending",
  hasData: true,
  figuresOnFile: false,
});
assert(pendingWithRevenue === false, "a pending read is empty even when the fixture has revenue");

const errored = reportReadShowsFigures({
  clientLinked: true,
  status: "error",
  hasData: true,
  figuresOnFile: true,
});
assert(errored === false, "an errored read is empty, never has-figures");

const timedOut = reportReadShowsFigures({
  clientLinked: true,
  status: "timeout",
  hasData: true,
  figuresOnFile: true,
});
assert(timedOut === false, "a read past the deadline is empty, even if the parent flag is true");

const settledNull = reportReadShowsFigures({
  clientLinked: true,
  status: "settled",
  hasData: financialsHaveRevenue(noBooksClient.financials),
  figuresOnFile: false,
});
assert(settledNull === false, "a settled NULL financials read is empty");

const settledRevenue = reportReadShowsFigures({
  clientLinked: true,
  status: "settled",
  hasData: true,
  figuresOnFile: false,
});
assert(settledRevenue === true, "a settled read with revenue shows the report chrome");

const parentHolds = reportReadShowsFigures({
  clientLinked: true,
  status: "pending",
  hasData: false,
  figuresOnFile: true,
});
assert(parentHolds === true, "a resolved parent read may hold the chrome while the studio read is pending");

assert(FIGURES_READ_DEADLINE_MS === 3_000, "the figures read gives up at 3s");
assert(FIGURES_READ_DEADLINE_MS <= CONNECTION_STATUS_DEADLINE_MS, "figures and connections share the 3s bound");

for (const kind of ["scorecard", "forecast", "waterfall", "all"] as const) {
  assert(
    reportIndexDetail(kind, false) === NO_FIGURES_REPORT_REASON,
    `${kind} index card names the upload reason when figures are not settled`,
  );
  assert(
    reportIndexDetail(kind, true) !== NO_FIGURES_REPORT_REASON,
    `${kind} index card keeps its subtitle once figures are settled`,
  );
}

const empty = reportCardNoFiguresState({ noFigures: true });
assert(empty.reason === NO_FIGURES_REPORT_REASON, "no-figures cards name the upload reason");
assert(
  empty.reason === reportDownloadGate({ ready: true, loading: false, blocked: true }).title,
  "the inline reason matches the disabled download reason",
);
assert(empty.showPageCount === false, "no-figures cards hide the page count");
assert(empty.showSignoff === false, "no-figures cards hide the sign-off control");

const ready = reportCardNoFiguresState({ noFigures: false });
assert(ready.reason === null, "a client with figures has no empty-card reason");
assert(ready.showPageCount === true, "page count stays when figures exist");
assert(ready.showSignoff === true, "sign-off stays when figures exist");

assert(CONNECTION_STATUS_DEADLINE_MS === 3_000, "each status check waits about 3s");
assert(CONNECTION_NOT_CONNECTED === "Not connected", "a missing row reads Not connected");
assert(connectionRestingPhase() === "none", "Xero and QuickBooks paint Not connected before the probe");
assert(connectionRestingPhase(true) === "coming_soon", "Sage paints coming soon before the probe");
assert(connectionRestingPhase() !== "checking", "a missing connection row never starts on Checking");

const checking = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS - 1,
  settled: false,
  live: null,
  stored: null,
});
assert(checking.phase === "checking", "the resolver still knows a probe is in flight");
assert(
  connectionRestingPhase() === "none",
  "the card does not display that in-flight phase when no row is stored",
);

const none = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS,
  settled: false,
  live: null,
  stored: null,
});
assert(none.phase === "none" && none.value === null, "a timed-out probe with nothing stored is not connected");

const storedRow = { configured: true, status: { companyName: "Kept Books" } };
const stored = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS + 500,
  settled: false,
  live: null,
  stored: storedRow,
});
assert(stored.phase === "stored" && stored.value === storedRow, "a timed-out probe keeps the stored connection");

const sageWait = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS,
  settled: false,
  live: null,
  stored: null,
  comingSoon: true,
});
assert(sageWait.phase === "coming_soon", "Sage times out to coming soon when nothing is stored");

resetConnectionStatusQueue();
const startedAt = Date.now();
const started: string[] = [];
const immediate = {
  deadlineMs: CONNECTION_STATUS_DEADLINE_MS,
  sleep: () => Promise.resolve(),
};
const qboCheck = enqueueConnectionCheck(
  {
    id: "qbo",
    stored: null,
    probe: () => {
      started.push("qbo");
      return new Promise(() => {});
    },
  },
  () => {},
  immediate,
);
const xeroCheck = enqueueConnectionCheck(
  {
    id: "xero",
    stored: null,
    probe: () => {
      started.push("xero");
      return new Promise(() => {});
    },
  },
  () => {},
  immediate,
);
const sageCheck = enqueueConnectionCheck(
  {
    id: "sage",
    stored: null,
    comingSoon: true,
    probe: () => {
      started.push("sage");
      return new Promise(() => {});
    },
  },
  () => {},
  immediate,
);
await Promise.resolve();
assert(
  started.join(",") === "qbo,xero,sage",
  "QuickBooks, Xero, and Sage start together, before any of them finishes",
);
const raced = await Promise.race([
  Promise.all([qboCheck, xeroCheck, sageCheck]),
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("status checks waited on each other")), 500);
  }),
]);
const probeMs = Date.now() - startedAt;
assert(probeMs < 500, "three empty probes settle without waiting out a slow auth claim");
console.log(`connection first paint is synchronous; three empty probes settled in ${probeMs}ms`);
assert(raced[0].phase === "none", "QuickBooks falls back to not connected");
assert(raced[1].phase === "none", "Xero falls back to not connected");
assert(raced[2].phase === "coming_soon", "Sage falls back to coming soon");

const studio = readFileSync("src/routes/_authenticated/reports-studio.tsx", "utf8");
assert(
  studio.includes("reportCardNoFiguresState({ noFigures: blocked })"),
  "every report card uses the no-figures state",
);
assert(studio.includes("reportReadShowsFigures"), "cards treat a pending read as empty");
assert(studio.includes("FIGURES_READ_DEADLINE_MS"), "the figures read has a deadline");
assert(studio.includes("financialsHaveRevenue"), "NULL financials return before the slow report reads");
const revenueGate = studio.indexOf("if (!financialsHaveRevenue");
const snapshotRead = studio.indexOf('from("client_financial_snapshots")');
assert(revenueGate > 0 && revenueGate < snapshotRead, "the empty return happens before snapshot and workflow reads");
assert(studio.includes("noFigures.showPageCount"), "page count is gated by the no-figures state");
assert(studio.includes("noFigures.showSignoff"), "sign-off is gated by the no-figures state");
assert(studio.includes("data-report-empty"), "the empty reason is rendered on the card");

const clientPage = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(clientPage.includes('reportIndexDetail("scorecard", hasFigures)'), "the scorecard index card uses the figures read");
assert(clientPage.includes('reportIndexDetail("forecast", hasFigures)'), "the forecast index card uses the figures read");
assert(clientPage.includes('reportIndexDetail("waterfall", hasFigures)'), "the waterfall index card uses the figures read");
assert(!clientPage.includes("The health scorecard PDF."), "the index does not hard-code the scorecard subtitle");
assert(clientPage.includes("NO_FIGURES_REPORT_REASON"), "scorecard, forecast, and waterfall show the reason while the studio chunk loads");
assert(
  clientPage.includes('import("@/routes/_authenticated/reports-studio")'),
  "the reports tab prefetches the studio so forecast and waterfall are not left on the chunk fallback",
);

const probe = readFileSync("src/lib/use-connection-probe.ts", "utf8");
assert(probe.includes("connectionRestingPhase"), "connection cards paint the resting phase first");
assert(!probe.includes('setGate("checking")'), "a reload or a new effect must not put Checking back on screen");
assert(probe.includes('next.phase === "checking"'), "an in-flight probe result is ignored");

const qbo = readFileSync("src/components/qbo-connect.tsx", "utf8");
const sage = readFileSync("src/components/sage-connect.tsx", "utf8");
const xero = readFileSync("src/components/xero-connect.tsx", "utf8");
assert(qbo.includes('id: "qbo"') && qbo.includes("useConnectionProbe"), "QuickBooks uses the shared probe");
assert(sage.includes('id: "sage"') && sage.includes("comingSoon: true"), "Sage uses the shared probe and stays coming soon");
assert(xero.includes('id: "xero"') && xero.includes("useConnectionProbe"), "Xero uses the same path");
assert(qbo.includes("CONNECTION_NOT_CONNECTED"), "QuickBooks shows Not connected");
assert(xero.includes("CONNECTION_NOT_CONNECTED"), "Xero shows Not connected");
assert(sage.includes("SAGE_CONNECTION_UNAVAILABLE"), "Sage keeps the coming-soon copy");

const connections = readFileSync("src/components/data-up-to-date.tsx", "utf8");
const xeroAt = connections.indexOf("<XeroConnectCard");
const qboAt = connections.indexOf("<QboConnectCard");
const sageAt = connections.indexOf("<SageConnectCard");
assert(xeroAt > 0 && qboAt > xeroAt && sageAt > qboAt, "Connections mounts Xero, QuickBooks, and Sage together");

console.log("empty-client cards ok");
