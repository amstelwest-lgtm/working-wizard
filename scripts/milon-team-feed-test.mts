/**
 * Milōn team feed — agent map, briefing, activity, last run, pre-card cap.
 * Run: pnpm test:milon-team-feed
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZA_MARKET } from "../src/lib/market/resolve";
import { PRECARD_CAP_CODE, PRECARD_CAP_MESSAGE } from "../src/lib/precard-cap";
import { useMilonTeamFeed } from "../src/hooks/use-milon-team-feed";
import {
  TEAM_DRAFT_AUTO_SEND,
  agentFor,
  agentStatusesFromActivity,
  buildTeamActivity,
  buildTeamBriefing,
  buildTeamJobs,
  diagnosisFromWorkspace,
  emptyMilonTeamFeed,
  mapApproveResult,
  signoffLineFromState,
  withPrecardCap,
  type TeamActivityRecords,
  type TeamDiagnosis,
  type TeamFeedProposal,
} from "../src/lib/milon-team-feed";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(agentFor("deliverable", "budget") === "analyst", "budget deliverable is the analyst");
assert(agentFor("deliverable", "variance") === "analyst", "variance deliverable is the analyst");
assert(agentFor("deliverable", "forecast") === "analyst", "forecast deliverable is the analyst");
assert(agentFor("deliverable", "cash") === "analyst", "13-week cash deliverable is the analyst");
assert(agentFor("deliverable", "exec_summary") === "analyst", "exec summary is the analyst");
assert(agentFor("deliverable", "report_pdf") === "analyst", "board report pdf is the analyst");
assert(agentFor("deliverable", "scorecard") === "analyst", "scorecard is the analyst");
assert(agentFor("deliverable", "grossMargin") === "analyst", "gross margin is the analyst");
assert(agentFor("deliverable", "cash_floor") === "advisor", "cash floor is the advisor");
assert(agentFor("deliverable", "debtors") === "advisor", "debtors deliverable is the advisor");
assert(agentFor("deliverable", "debtorDays") === "advisor", "debtor days is the advisor");
assert(agentFor("deliverable", "collections") === "advisor", "collections is the advisor");
assert(agentFor("deliverable", "covenant") === "advisor", "covenants are the advisor");
assert(agentFor("deliverable", "tax_date") === "advisor", "tax dates are the advisor");
assert(agentFor("deliverable", "action_plan") === "advisor", "action plan is the advisor");
assert(agentFor("deliverable", "advisory") === "advisor", "advisory draft is the advisor");
assert(agentFor("deliverable", "client_email") === "advisor", "client email draft is the advisor");
assert(agentFor("deliverable", "plan") === "advisor", "plan deliverable is the advisor");
assert(agentFor("deliverable", "reconciliation") === "financial_manager", "reconciliation is the financial_manager");
assert(agentFor("deliverable", "upload") === "financial_manager", "upload is the financial_manager");
assert(agentFor("deliverable", "sync") === "financial_manager", "sync is the financial_manager");
assert(agentFor("deliverable", "data_request") === "financial_manager", "data request is the financial_manager");
assert(agentFor("deliverable", "query") === "financial_manager", "query is the financial_manager");
assert(agentFor("deliverable", "signoff") === "financial_manager", "sign-off is the financial_manager");

assert(agentFor("proposal", "debtor_days") === "advisor", "debtor-day proposal is the advisor");
assert(agentFor("proposal", "cash") === "advisor", "cash-move proposal is the advisor");
assert(agentFor("proposal", "other") === "advisor", "untyped next move is the advisor");
assert(agentFor("proposal", "gross_margin") === "analyst", "margin proposal is the analyst");
assert(agentFor("proposal", "budget") === "analyst", "budget proposal is the analyst");
assert(agentFor("proposal", "revenue") === "analyst", "revenue proposal is the analyst");
assert(agentFor("proposal", "sync") === "financial_manager", "sync proposal is the financial_manager");
assert(agentFor("proposal", "data_request") === "financial_manager", "data-request proposal is the financial_manager");

assert(agentFor("event", "sync") === "financial_manager", "sync event is the financial_manager");
assert(agentFor("event", "upload") === "financial_manager", "upload event is the financial_manager");
assert(agentFor("event", "query") === "financial_manager", "query event is the financial_manager");
assert(agentFor("event", "data_request") === "financial_manager", "data-request event is the financial_manager");
assert(agentFor("event", "signoff") === "financial_manager", "sign-off event is the financial_manager");
assert(agentFor("event", "review.signed_off") === "financial_manager", "pack sign-off event is the financial_manager");
assert(agentFor("event", "diagnosis.reviewed") === "analyst", "diagnosis review is the analyst");
assert(agentFor("event", "forecast.published") === "analyst", "forecast publish is the analyst");
assert(agentFor("event", "proposal") === "advisor", "proposal event is the advisor");
assert(agentFor("event", "approved") === "advisor", "approval event is the advisor");
assert(agentFor("event", "recommendation.rejected") === "advisor", "rejected move is the advisor");

const fixture: TeamDiagnosis = {
  market: ZA_MARKET,
  health: { score: 62, label: "Watch", tier: "at_risk", asOf: "2026-01-31" },
  ratios: [
    { name: "Gross Margin", key: "grossMargin", value: 0.42, score: 90, asOf: "2026-01-31" },
    { name: "Debtor Days", key: "debtorDays", value: 71, score: 30, asOf: "2026-01-31" },
  ],
  brain: {
    headline: "Cash is tight because customers pay slowly",
    body: "The books show debtor days well past a typical peer.",
    asOf: "2026-02-02T08:00:00.000Z",
  },
  proposals: [
    {
      id: "step-1",
      title: "Chase the overdue invoices",
      summary: "Three accounts are past 60 days.",
      type: "debtor_days",
      priority: "high",
      createdAt: "2026-02-03T09:00:00.000Z",
    },
  ],
  cash: {
    runwayLabel: "2 weeks",
    runwayWeeks: 2,
    lowestClosing: 1000,
    floor: 50000,
    dipsBelowFloorWeek: 3,
    asOf: "2026-02-04T00:00:00.000Z",
  },
  debtors: { outstanding: 12000, debtorDays: 71, asOf: "2026-01-31" },
};

const briefing = buildTeamBriefing(fixture);
assert(briefing.length > 0, "fixture diagnosis produces briefing items");
for (const item of briefing) {
  assert(item.source.label.trim().length > 0, `${item.id} has a source label`);
  assert("asOf" in item.source, `${item.id} carries an as-of`);
}
assert(!briefing.some((item) => item.id === "ratio:grossMargin"), "a healthy ratio is not padded in");
const debtorRatio = briefing.find((item) => item.id === "ratio:debtorDays");
assert(debtorRatio?.agent === "advisor", "weak debtor days belong to the advisor");
assert(debtorRatio?.source.label === "Ratios", "ratio source label");
assert(debtorRatio?.source.asOf === "2026-01-31", "ratio as-of");
assert(debtorRatio?.severity === "act", "critical ratio is act");
const health = briefing.find((item) => item.id === "health");
assert(health?.title === "Health score 62 · Watch", "health title uses the stored score");
assert(health?.source.label === "Health score", "health source");
assert(health?.agent === "analyst", "health summary is the analyst");
const brain = briefing.find((item) => item.id === "brain");
assert(brain?.title === "Cash is tight because customers pay slowly", "brain headline is the stored summary");
assert(brain?.source.label === "Client Brain", "brain source");
const proposal = briefing.find((item) => item.id === "proposal:step-1");
assert(proposal?.jobId === "step-1", "proposal briefing points at the job");
assert(proposal?.agent === "advisor", "debtor proposal is the advisor");
assert(proposal?.source.label === "Client Brain proposals", "proposal source");
const forecast = briefing.find((item) => item.id === "cash-forecast");
assert(forecast?.agent === "analyst", "13-week forecast is the analyst");
assert(forecast?.source.label === "13-week cash forecast", "forecast source");
assert(forecast?.source.asOf === "2026-02-04T00:00:00.000Z", "forecast as-of");
const floor = briefing.find((item) => item.id === "cash-floor");
assert(floor?.agent === "advisor", "cash floor is the advisor");
assert(floor?.source.label === "Cash floor", "floor source");
const debtors = briefing.find((item) => item.id === "debtors");
assert(debtors?.agent === "advisor", "debtors briefing is the advisor");
assert(debtors?.source.label === "Debtors", "debtors source");
assert(debtors?.detail?.includes("71"), "debtor days come from the fixture");

const emptyDiagnosis = diagnosisFromWorkspace({
  financials: null,
  cashflow: null,
  financialsUpdatedAt: null,
  lastForecastAt: null,
  fyStartMonth: null,
  market: ZA_MARKET,
  brainSummary: null,
  brainSummaryUpdatedAt: null,
  snapshotAsOf: null,
  proposals: [],
});
assert(emptyDiagnosis.health === null, "no figures does not invent a health score");
assert(emptyDiagnosis.cash === null, "no forecast does not invent a 13-week series");
assert(emptyDiagnosis.debtors === null, "no receivables does not invent debtors");
assert(buildTeamBriefing(emptyDiagnosis).length === 0, "empty diagnosis stays empty");

const step: TeamFeedProposal = {
  id: "p1",
  title: "Refresh the budget",
  summary: "Revenue is off the plan.",
  type: "budget",
  priority: "medium",
  status: "approved",
  createdAt: "2026-01-15T00:00:00.000Z",
  decidedAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  signedOffAt: null,
  note: null,
};

const records: TeamActivityRecords = {
  snapshots: [
    { id: "s-auto", source: "autosave", periodLabel: "Jan", at: "2026-04-01T00:00:00.000Z" },
    { id: "s-xero", source: "xero", periodLabel: "Jan 2026", at: "2026-01-01T00:00:00.000Z" },
    { id: "s-up", source: "upload", periodLabel: "Mar 2026", at: "2026-03-01T00:00:00.000Z" },
  ],
  uploads: [{ id: "a1", label: "bank.pdf", at: "2026-02-01T00:00:00.000Z" }],
  diagnosisEvents: [
    { id: "d-blank", at: null },
    { id: "d1", at: "2026-05-01T00:00:00.000Z" },
  ],
  proposals: [step],
  drafts: [],
  signoffAt: "2026-07-01T00:00:00.000Z",
  signoffText: "Signed off by Ada · 1 Jul 2026",
  dataRequests: [{ id: "r1", title: "Need a bank statement", at: "2026-01-20T00:00:00.000Z" }],
  queries: [{ id: "q1", text: "Which invoices sit in debtor days?", at: "2026-02-15T00:00:00.000Z" }],
};

const activity = buildTeamActivity(records);
assert(!activity.some((event) => event.id.includes("s-auto")), "autosave is not a sync or an upload");
assert(!activity.some((event) => event.id.includes("d-blank")), "a diagnosis row with no timestamp is omitted");
const order = activity.map((event) => event.id);
assert(
  order.join(",") ===
    [
      "signoff:2026-07-01T00:00:00.000Z",
      "approved:p1",
      "diagnosis:d1",
      "upload:s-up",
      "query:q1",
      "artifact:a1",
      "data-request:r1",
      "proposal:p1",
      "sync:s-xero",
    ].join(","),
  `activity is newest first, got ${order.join(",")}`,
);
assert(activity[0].kind === "signoff" && activity[0].agent === "financial_manager", "latest event is the financial_manager sign-off");
assert(activity.find((event) => event.id === "approved:p1")?.agent === "analyst", "budget approval is the analyst");
assert(activity.find((event) => event.kind === "sync")?.text === "Xero sync · Jan 2026", "sync text uses the ledger and period");

const agents = agentStatusesFromActivity(activity);
assert(agents.financial_manager.lastRunAt === "2026-07-01T00:00:00.000Z", "financial_manager last run is the latest real event");
assert(agents.financial_manager.lastRunKind === "signoff", "financial_manager last run kind");
assert(agents.analyst.lastRunAt === "2026-06-01T00:00:00.000Z", "analyst last run is the budget approval");
assert(agents.analyst.lastRunKind === "approved", "analyst last run kind");
assert(agents.advisor.lastRunAt === null && agents.advisor.lastRunKind === null, "advisor with no events stays null");

const cap = mapApproveResult({ code: PRECARD_CAP_CODE, message: PRECARD_CAP_MESSAGE });
assert(cap.ok === false && cap.reason === "precard_cap", "pre-card cap maps to precard_cap");
assert(cap.ok === false && cap.message === PRECARD_CAP_MESSAGE, "cap message is the existing card copy");
const cappedFeed = withPrecardCap({
  ...emptyMilonTeamFeed(),
  jobs: buildTeamJobs({
    clientId: "c1",
    proposals: [{ ...step, status: "proposed", type: "debtor_days" }],
    drafts: [],
    precard: { capped: false, remaining: 1, limit: 1 },
    hasData: true,
  }),
});
assert(cappedFeed.precard.capped === true, "cap sets precard.capped");
assert(cappedFeed.precard.remaining === 0, "cap remaining is zero");
assert(cappedFeed.jobs[0]?.blockedReason === "precard_cap", "proposed job is blocked by the cap");
assert(cappedFeed.jobs[0]?.canApprove === false, "a capped job cannot be approved");

const noData = buildTeamJobs({
  clientId: "c1",
  proposals: [{ ...step, status: "proposed" }],
  drafts: [],
  precard: { capped: false, remaining: null, limit: null },
  hasData: false,
});
assert(noData[0]?.blockedReason === "no_data" && noData[0]?.canApprove === false, "no data blocks approve");
const sentHidden = buildTeamJobs({
  clientId: "c1",
  proposals: [],
  drafts: [
    {
      id: "d-sent",
      kind: "advisory",
      body: "Hello",
      status: "sent",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  precard: { capped: false, remaining: null, limit: null },
  hasData: true,
});
assert(sentHidden.length === 0, "a sent draft is not relabelled as signed off");

const line = signoffLineFromState({
  status: "signed",
  version: 3,
  signedBy: "Ada",
  firmName: null,
  signedAt: "2026-07-01T10:00:00.000Z",
  zone: "Africa/Johannesburg",
  reviewedByKind: "accountant",
});
assert(line?.startsWith("Signed off by Ada"), `sign-off line comes from signoffStatusLine, got ${line}`);

assert(TEAM_DRAFT_AUTO_SEND === false, "approve stays drafts-only");
assert(typeof useMilonTeamFeed === "function", "hook is exported");

const hookSrc = readFileSync(resolve("src/hooks/use-milon-team-feed.ts"), "utf8");
const libSrc = readFileSync(resolve("src/lib/milon-team-feed.ts"), "utf8");
const combined = `${hookSrc}\n${libSrc}`;
assert(!/Claude/i.test(combined), "no model vendor name");
assert(!/\bDana\b/.test(combined), "no Dana");
assert(!/replaces accountants/i.test(combined), "no replaces-accountants copy");
assert(!/one bot/i.test(combined), "three agents, not one bot");
assert(!/Milōn Accountant|Milon Accountant/.test(combined), "display names stay out of the feed");
assert(!/"accountant"/.test(libSrc) && !/"accountant"/.test(hookSrc), "agent key is financial_manager");
assert(!/advisory_packs/.test(hookSrc), "sign-off is not read from the pack table in the hook");
assert(!/client_review_signoffs/.test(hookSrc), "sign-off is not read from page stamps");
assert(/getAdvisorySignoffState/.test(hookSrc), "sign-off uses getAdvisorySignoffState");
assert(/invokeBrainDeliverableDraft/.test(hookSrc), "approve uses the existing draft path");
assert(/status: "rejected"/.test(hookSrc), "dismiss reuses proposed_next_steps rejected");
assert(/status: "discarded"/.test(hookSrc), "draft dismiss reuses discarded");

console.log("milon-team-feed: ok");
