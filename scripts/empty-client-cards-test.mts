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
  reportDeepLinkDecision,
  reportIndexDetail,
  reportReadShowsFigures,
} from "../src/lib/report-card-state";
import {
  CONNECTION_CONNECTED_UNVERIFIED,
  CONNECTION_NOT_CONNECTED,
  CONNECTION_STATUS_DEADLINE_MS,
  connectionRestingPhase,
  connectionVisibleLabel,
  enqueueConnectionCheck,
  resetConnectionStatusQueue,
  resolveConnectionStatus,
  type ConnectionPhase,
  type ConnectionRowFact,
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

/** Yankees: non-blank revenue, one Xero row and one QuickBooks row. */
const yankees = {
  id: "e9dc0c5a",
  name: "Yankees",
  financials: { revenue: "non-blank" },
  connections: { xero: "present", qbo: "present" } as const,
};
/** QA US Test LLC: non-blank revenue, one QuickBooks row, two snapshots. */
const qaUs = {
  id: "3cc31b6a",
  name: "QA US Test LLC",
  financials: { revenue: "non-blank" },
  snapshots: 2,
  connections: { xero: "absent", qbo: "present" } as const,
};
assert(financialsHaveRevenue(yankees.financials) === true, "Yankees revenue is a non-blank string");
assert(financialsHaveRevenue(qaUs.financials) === true, "QA US Test LLC revenue is a non-blank string");
assert(qaUs.snapshots === 2, "QA US Test LLC has two statement snapshots");
assert(yankees.connections.xero === "present" && yankees.connections.qbo === "present", "Yankees has both ledger rows");

const pendingKnownEmpty = reportReadShowsFigures({
  clientLinked: true,
  status: "pending",
  hasData: false,
  figuresOnFile: false,
});
assert(pendingKnownEmpty === false, "a known-empty file stays empty while the read is pending");

const erroredKnownEmpty = reportReadShowsFigures({
  clientLinked: true,
  status: "error",
  hasData: false,
  figuresOnFile: false,
});
assert(erroredKnownEmpty === false, "an errored read of a known-empty file stays empty");

const slowFigures = reportReadShowsFigures({
  clientLinked: true,
  status: "timeout",
  hasData: false,
  figuresOnFile: true,
});
assert(slowFigures === true, "a figures client keeps the cards when the read passes 3s");
assert(
  reportCardNoFiguresState({ noFigures: !slowFigures }).reason === null,
  "a slow figures read does not show the upload reason",
);
assert(
  reportDeepLinkDecision({ status: "timeout", showFigures: slowFigures }) === "wait",
  "a deep link waits out a slow figures read",
);
assert(
  reportDeepLinkDecision({ status: "pending", showFigures: true }) === "wait",
  "a deep link waits while the read is pending",
);
assert(
  reportDeepLinkDecision({ status: "settled", showFigures: true }) === "run",
  "a deep link runs once a figures read settles",
);
assert(
  reportDeepLinkDecision({ status: "settled", showFigures: false }) === "blocked",
  "a deep link reports the empty file only after the read settles",
);

const omittedTimeout = reportReadShowsFigures({
  clientLinked: true,
  status: "timeout",
  hasData: false,
});
assert(omittedTimeout === true, "a caller that omits figuresOnFile does not block the cards");

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
assert(connectionRestingPhase() === "checking", "an unknown row starts on the skeleton");
assert(
  connectionRestingPhase({ row: "absent" }) === "none",
  "Xero and QuickBooks paint Not connected only once the row is known absent",
);
assert(
  connectionRestingPhase({ comingSoon: true, row: "absent" }) === "coming_soon",
  "Sage paints coming soon once its row is known absent",
);
assert(
  connectionRestingPhase({ row: "present" }) === "checking",
  "a connected client stays on the skeleton until the status probe returns",
);

function paintSequence(row: ConnectionRowFact, comingSoon = false): ConnectionPhase[] {
  return [
    connectionRestingPhase({ row: "unknown", comingSoon }),
    connectionRestingPhase({ row, comingSoon }),
    resolveConnectionStatus({
      elapsedMs: 1,
      settled: false,
      live: null,
      stored: null,
      row,
      comingSoon,
    }).phase,
    resolveConnectionStatus({
      elapsedMs: CONNECTION_STATUS_DEADLINE_MS,
      settled: false,
      live: null,
      stored: null,
      row: "unknown",
      comingSoon,
    }).phase,
    resolveConnectionStatus({
      elapsedMs: CONNECTION_STATUS_DEADLINE_MS,
      settled: false,
      live: null,
      stored: null,
      row,
      comingSoon,
    }).phase,
    resolveConnectionStatus({
      elapsedMs: 10,
      settled: true,
      failed: true,
      live: null,
      stored: null,
      row,
      comingSoon,
    }).phase,
  ];
}

for (const phase of paintSequence("present")) {
  assert(
    connectionVisibleLabel(phase) !== CONNECTION_NOT_CONNECTED,
    "a connected client never renders Not connected",
  );
}
for (const phase of paintSequence("present")) {
  assert(phase !== "none", "a connected client never takes the Not connected phase");
}
const failedConnected = resolveConnectionStatus({
  elapsedMs: 20,
  settled: true,
  failed: true,
  live: null,
  stored: null,
  row: "present",
});
assert(failedConnected.phase === "unverified", "a failed probe on a connected client stays Connected");
assert(
  connectionVisibleLabel(failedConnected.phase) === CONNECTION_CONNECTED_UNVERIFIED,
  "the failed probe says Connected, not Not connected",
);

const checking = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS - 1,
  settled: false,
  live: null,
  stored: null,
  row: "unknown",
});
assert(checking.phase === "checking", "the resolver still knows a probe is in flight");

const none = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS,
  settled: false,
  live: null,
  stored: null,
  row: "absent",
});
assert(none.phase === "none" && none.value === null, "a timed-out probe with no connection row is not connected");
const unknownTimeout = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS,
  settled: false,
  live: null,
  stored: null,
  row: "unknown",
});
assert(unknownTimeout.phase === "retry", "a timeout with no row fact does not say Not connected");

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
  row: "absent",
  comingSoon: true,
});
assert(sageWait.phase === "coming_soon", "Sage times out to coming soon when its row is absent");

resetConnectionStatusQueue();
const startedAt = Date.now();
const started: string[] = [];
const immediate = {
  deadlineMs: CONNECTION_STATUS_DEADLINE_MS,
  sleep: () => Promise.resolve(),
};
const absentRow = { current: "absent" as const };
const qboCheck = enqueueConnectionCheck(
  {
    id: "qbo",
    stored: null,
    rowFact: absentRow,
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
    rowFact: absentRow,
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
    rowFact: absentRow,
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
assert(raced[0].phase === "none", "QuickBooks falls back to not connected when the row is absent");
assert(raced[1].phase === "none", "Xero falls back to not connected when the row is absent");
assert(raced[2].phase === "coming_soon", "Sage falls back to coming soon when the row is absent");

const connectedTimeout = await enqueueConnectionCheck(
  {
    id: "yankees-qbo",
    stored: null,
    rowFact: { current: "present" },
    probe: () => new Promise(() => {}),
  },
  () => {},
  immediate,
);
assert(connectedTimeout.phase === "unverified", "Yankees times out to Connected, not Not connected");
assert(
  connectionVisibleLabel(connectedTimeout.phase) !== CONNECTION_NOT_CONNECTED,
  "the Yankees timeout label is not Not connected",
);
const connectedFailure = await enqueueConnectionCheck(
  {
    id: "yankees-xero",
    stored: null,
    rowFact: { current: "present" },
    probe: () => Promise.reject(new Error("auth claim failed")),
  },
  () => {},
  immediate,
);
assert(connectedFailure.phase === "unverified", "a rejected probe keeps Yankees Connected");

const studio = readFileSync("src/routes/_authenticated/reports-studio.tsx", "utf8");
assert(
  studio.includes("reportCardNoFiguresState({ noFigures: blocked })"),
  "every report card uses the no-figures state",
);
assert(studio.includes("reportReadShowsFigures"), "cards use the figures read");
assert(studio.includes("reportDeepLinkDecision"), "deep links wait for the figures read");
assert(studio.includes("FIGURES_READ_DEADLINE_MS"), "the figures read has a deadline");
assert(!studio.includes("figuresOnFile = false"), "omitting figuresOnFile does not mean the file is empty");
const loadStart = studio.indexOf("async function loadClientReportData");
const loadBody = studio.slice(loadStart, loadStart + 2200);
assert(loadBody.includes("Promise.all"), "the client row and snapshots start together");
assert(
  loadBody.indexOf('from("clients")') > 0 &&
    loadBody.indexOf('from("client_financial_snapshots")') > loadBody.indexOf('from("clients")'),
  "snapshots are requested alongside the client row",
);
assert(
  loadBody.includes("earlyRow == null || earlyRow.financials == null"),
  "only a NULL client row short-circuits the rest of the report read",
);
assert(
  !loadBody.slice(0, loadBody.indexOf("earlyRow == null")).includes("financialsHaveRevenue"),
  "a non-NULL revenue row is not returned before the parallel read",
);
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
assert(probe.includes("readLedgerConnectionRow"), "the card reads connection rows without the status server function");
assert(probe.includes('rowFact.current === "present"'), "a present row cannot fall through to Not connected");
assert(probe.includes('next.phase === "checking"'), "an in-flight probe result does not replace the skeleton");
const rowReader = readFileSync("src/lib/connection-row.ts", "utf8");
assert(rowReader.includes('from(CONNECTION_TABLE[provider])'), "the row read is a direct table select");
assert(!rowReader.includes("getQboStatus") && !rowReader.includes("getXeroStatus"), "the row read does not call the auth-claim status functions");

const qbo = readFileSync("src/components/qbo-connect.tsx", "utf8");
const sage = readFileSync("src/components/sage-connect.tsx", "utf8");
const xero = readFileSync("src/components/xero-connect.tsx", "utf8");
assert(qbo.includes('id: "qbo"') && qbo.includes('provider: "qbo"'), "QuickBooks uses the shared probe");
assert(sage.includes('id: "sage"') && sage.includes("comingSoon: true"), "Sage uses the shared probe and stays coming soon");
assert(xero.includes('id: "xero"') && xero.includes('provider: "xero"'), "Xero uses the same path");
assert(qbo.includes("CONNECTION_CONNECTED_UNVERIFIED"), "QuickBooks can show Connected when the probe fails");
assert(xero.includes("CONNECTION_CONNECTED_UNVERIFIED"), "Xero can show Connected when the probe fails");
assert(qbo.includes("CONNECTION_NOT_CONNECTED"), "QuickBooks shows Not connected");
assert(xero.includes("CONNECTION_NOT_CONNECTED"), "Xero shows Not connected");
assert(sage.includes("SAGE_CONNECTION_UNAVAILABLE"), "Sage keeps the coming-soon copy");

const connections = readFileSync("src/components/data-up-to-date.tsx", "utf8");
const xeroAt = connections.indexOf("<XeroConnectCard");
const qboAt = connections.indexOf("<QboConnectCard");
const sageAt = connections.indexOf("<SageConnectCard");
assert(xeroAt > 0 && qboAt > xeroAt && sageAt > qboAt, "Connections mounts Xero, QuickBooks, and Sage together");

console.log("empty-client cards ok");
