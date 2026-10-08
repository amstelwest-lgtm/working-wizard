/**
 * Sign-off parity: one status line, stale page sign-offs, dashboard health.
 * Run: pnpm test:signoff-parity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exceptionsFor, type PortfolioClientFacts } from "../src/lib/portfolio";
import { pdfSignoffBadgeLine, stampFromSignoff } from "../src/lib/review-signoff-stamp";
import {
  PAGE_FIGURES_CHANGED_CLAUSE,
  reviewFiguresChanged,
  signoffStatusLine,
  signedHealthFromHistory,
} from "../src/lib/signoff-status";
import type { ClientReviewSignoff } from "../src/lib/review-signoffs.functions";
import { resolveMarket } from "../src/lib/market/resolve";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

assert(signoffStatusLine({ kind: "draft" }) === "Draft", "draft word");
assert(signoffStatusLine({ kind: "ready" }) === "Ready for review", "ready word");
assert(
  signoffStatusLine({ kind: "signed", name: "James Fleming", date: "Oct 7, 2026" }) ===
    "Signed off by James Fleming · Oct 7, 2026",
  "signed word",
);
assert(
  signoffStatusLine({ kind: "stale", name: "James Fleming" }) ===
    `Signed off by James Fleming · ${PAGE_FIGURES_CHANGED_CLAUSE}`,
  "stale word",
);
assert(
  signoffStatusLine({ kind: "stale", name: "James Fleming", variant: "short" }) ===
    "Signed off · figures changed",
  "stale pill is the short shared line",
);
assert(
  signoffStatusLine({ kind: "draft", variant: "short" }) === "Draft",
  "short does not invent a draft word",
);

const signedAt = "2026-10-07T23:01:00.000Z";
assert(
  reviewFiguresChanged({
    signedOffAt: signedAt,
    dataUpdatedAt: "2026-10-06T00:00:00.000Z",
    liveHealth: 67,
    signedHealth: 67,
  }) === false,
  "matching health and an older timestamp stay signed",
);
assert(
  reviewFiguresChanged({
    signedOffAt: signedAt,
    liveHealth: 67,
    signedHealth: 71,
  }) === true,
  "health 71 to 67 is stale",
);
assert(
  signedHealthFromHistory(
    [
      { period_date: "2026-09-30", score: 71 },
      { period_date: "2026-10-08", score: 67 },
    ],
    signedAt,
  ) === 71,
  "the signed score is the history row on or before the sign-off day",
);
assert(
  reviewFiguresChanged({
    signedOffAt: signedAt,
    snapshots: [
      {
        created_at: "2026-09-30T12:00:00.000Z",
        period_label: "September 2026",
        financials: { periodStart: "2026-09-01", periodEnd: "2026-09-30" },
      },
      {
        created_at: "2026-10-20T12:00:00.000Z",
        period_label: "October 2026",
        financials: { periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      },
    ],
  }) === true,
  "a later statement period after sign-off is stale",
);
assert(
  reviewFiguresChanged({
    signedOffAt: signedAt,
    snapshots: [
      {
        created_at: "2026-10-07T23:05:00.000Z",
        period_label: "October 2026",
      },
    ],
  }) === false,
  "a snapshot in the same sitting is the signed period",
);

const signoff: ClientReviewSignoff = {
  id: "1",
  client_id: "c",
  scope: "financials",
  signed_off_by_id: "u",
  signed_off_by_name: "James Fleming",
  signed_off_by_initials: "JF",
  signed_off_by_title: null,
  firm_name: "Ben Accountants",
  note: null,
  signature_data: null,
  signed_off_at: signedAt,
};
const us = resolveMarket({ country: "US", regionCode: "NY" });
const kept = stampFromSignoff(signoff, true);
assert(kept?.figuresChanged === true, "stale stamp is kept");
assert(
  pdfSignoffBadgeLine(kept!, us) ===
    `Signed off by James Fleming · ${PAGE_FIGURES_CHANGED_CLAUSE}`,
  pdfSignoffBadgeLine(kept!, us),
);

const quiet = {
  clientId: "q",
  name: "Quiet",
  state: "action_execution",
  stateSince: "2026-09-01T00:00:00Z",
  nextReviewAt: null,
  figuresAsOf: "2026-10-01",
  openDataRequests: 0,
  blockingDataRequests: 0,
  overdueActions: 0,
  blockedActions: 0,
  openActions: 0,
  proposedRecommendations: 0,
  packStatus: "approved",
  packVersion: 12,
  packEditRate: null,
  outcomesMissed: 0,
  outcomesMeasured: 0,
  lastLoginAt: "2026-10-01T00:00:00Z",
} satisfies PortfolioClientFacts;
assert(
  exceptionsFor(quiet, "2026-10-08T00:00:00Z").every((row) => row.kind !== "pack_waiting"),
  "a signed pack is not waiting",
);
assert(
  exceptionsFor({ ...quiet, packFiguresStale: true }, "2026-10-08T00:00:00Z")[0]?.label ===
    `Pack v12 ${PAGE_FIGURES_CHANGED_CLAUSE}`,
  "a stale approval keeps the version and asks for re-review",
);
assert(
  exceptionsFor(
    { ...quiet, packStatus: "in_review", packFiguresStale: false },
    "2026-10-08T00:00:00Z",
  )[0]?.label === "Pack v12 waiting for your sign-off",
  "in review still waits",
);

const dashboard = read("src/routes/_authenticated/dashboard.tsx");
assert(dashboard.includes("scorecardHealthFromFinancials"), "dashboard health uses the scorecard");
assert(dashboard.includes("periodMonthsOf"), "dashboard health uses the statement cover");
assert(!dashboard.includes("healthFromFlatFinancials"), "dashboard does not use the unannualised score");

const portfolio = read("src/lib/portfolio.ts");
assert(portfolio.includes("resolveAdvisorySignoffState"), "the firm queue uses the advisory resolver");

const reports = read("src/routes/_authenticated/reports.index.tsx");
assert(!reports.includes('cycle: "cash_forecast"'), "cash flow cycle has no sign-off");
assert(reports.includes("reviewSignoff: null"), "the cycle PDF is not stamped from another scope");
assert(read("src/reports/profitability-waterfall.tsx").includes("draft={!isDemo && !sample && !reviewSignoff}"));
assert(read("src/reports/cash-forecast.tsx").includes("draft={!isDemo && !sample && !reviewSignoff}"));

const ratios = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(ratios.includes("Export PDF"), "health and ratios can export");
assert(!ratios.includes('scope="collections"') && !ratios.includes('scope="payables"'));
assert(!read("src/components/collections-panel.tsx").includes("ReviewSignoff"));
assert(!read("src/components/payables-panel.tsx").includes("ReviewSignoff"));

console.log("signoff-parity ok");
