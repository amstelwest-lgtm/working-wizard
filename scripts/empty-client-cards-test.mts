/**
 * Empty-client report cards and ledger status deadlines.
 * Run: pnpm test:empty-client-cards
 */
import { readFileSync } from "node:fs";
import { reportDownloadGate } from "../src/lib/report-coherence";
import {
  NO_FIGURES_REPORT_REASON,
  reportCardNoFiguresState,
} from "../src/lib/report-card-state";
import {
  CONNECTION_NOT_CONNECTED,
  CONNECTION_STATUS_DEADLINE_MS,
  enqueueConnectionCheck,
  resetConnectionStatusQueue,
  resolveConnectionStatus,
} from "../src/lib/connection-status-deadline";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const empty = reportCardNoFiguresState({ noFigures: true });
assert(empty.reason === NO_FIGURES_REPORT_REASON, "no-figures cards name the upload reason");
assert(
  empty.reason ===
    reportDownloadGate({ ready: true, loading: false, blocked: true }).title,
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

const checking = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS - 1,
  settled: false,
  live: null,
  stored: null,
});
assert(checking.phase === "checking", "a probe inside the deadline stays on checking");

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

const sageLive = resolveConnectionStatus({
  elapsedMs: CONNECTION_STATUS_DEADLINE_MS + 1_000,
  settled: true,
  live: { configured: false, status: null },
  stored: null,
  comingSoon: true,
});
assert(
  sageLive.phase === "live" && sageLive.value?.configured === false,
  "a finished Sage config read is not replaced by the timeout",
);

resetConnectionStatusQueue();
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
assert(started.join(",") === "qbo,sage", "QuickBooks and Sage start together, before either finishes");
const raced = await Promise.race([
  Promise.all([qboCheck, sageCheck]),
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("status checks waited on each other")), 500);
  }),
]);
assert(raced[0].phase === "none", "QuickBooks falls back to not connected");
assert(raced[1].phase === "coming_soon", "Sage falls back to coming soon");

resetConnectionStatusQueue();
const live = await enqueueConnectionCheck(
  {
    id: "qbo-live",
    stored: storedRow,
    probe: async () => ({ configured: true, status: { companyName: "Live Books" } }),
  },
  () => {},
  { deadlineMs: CONNECTION_STATUS_DEADLINE_MS, sleep: () => new Promise(() => {}) },
);
assert(live.phase === "live" && live.value?.status?.companyName === "Live Books", "a fast probe wins over the stored row");

const studio = readFileSync("src/routes/_authenticated/reports-studio.tsx", "utf8");
assert(
  studio.includes("reportCardNoFiguresState({ noFigures: blocked })"),
  "every report card uses the no-figures state",
);
assert(!studio.includes("{report.pages}"), "the card does not print an invented page count");
assert(studio.includes("noFigures.showSignoff"), "sign-off is gated by the no-figures state");
assert(studio.includes("data-report-empty"), "the empty reason is rendered on the card");

const qbo = readFileSync("src/components/qbo-connect.tsx", "utf8");
const sage = readFileSync("src/components/sage-connect.tsx", "utf8");
const xero = readFileSync("src/components/xero-connect.tsx", "utf8");
assert(qbo.includes('id: "qbo"') && qbo.includes("useConnectionProbe"), "QuickBooks uses the shared probe");
assert(sage.includes('id: "sage"') && sage.includes("comingSoon: true"), "Sage uses the shared probe and stays coming soon");
assert(xero.includes('id: "xero"') && xero.includes("useConnectionProbe"), "Xero uses the same deadline path");
assert(qbo.includes("CONNECTION_NOT_CONNECTED"), "QuickBooks shows Not connected");
assert(sage.includes("SAGE_CONNECTION_UNAVAILABLE"), "Sage keeps the coming-soon copy");
assert(!qbo.includes("loadingStatus && configured === null"), "QuickBooks does not wait forever on checking");
assert(!sage.includes("loadingStatus && configured === null"), "Sage does not wait forever on checking");

const connections = readFileSync("src/components/data-up-to-date.tsx", "utf8");
const qboAt = connections.indexOf("<QboConnectCard");
const sageAt = connections.indexOf("<SageConnectCard");
assert(qboAt > 0 && sageAt > qboAt, "Connections mounts QuickBooks and Sage together");

console.log("empty-client cards ok");
