/**
 * Founder instrument glance: exclusion, one call per practice, tiny samples, killed noise.
 * Run: pnpm test:founder-instrument
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActivationRow } from "../src/lib/metrics/digest";
import {
  buildGlance,
  buildMergedFunnel,
  cohortRowsForDisplay,
  compactHypothesisLabels,
  dedupePracticeCalls,
  honestHypothesisLabel,
  pickNextCall,
  readingVerdict,
  GLANCE_FUNNEL_LABELS,
  REVIEW_HREF,
} from "../src/lib/metrics/glance";
import {
  INSTRUMENT_EXCLUSION_RULES,
  exclusionReason,
  isExcludedFromInstrument,
  realFirmCount,
} from "../src/lib/metrics/internal-exclusion";
import { isPilotFlagVisible, PILOT_FLAG_KEYS } from "../src/lib/ops-pilot-flags";
import {
  buildDueQueue,
  buildReviewInbox,
  lighthouseReviewPulse,
  type AgentLead,
} from "../src/lib/lighthouse-agent";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const internal = { internalEmails: ["amstel.west@gmail.com", "ops@milon.it"] };
const NOW = Date.parse("2026-10-06T00:00:00Z");

assert(INSTRUMENT_EXCLUSION_RULES.length >= 6, "exclusion rule is written down");

assert(
  exclusionReason({ name: "North Books", isInternal: true }) === "flag",
  "is_internal is excluded",
);
assert(exclusionReason({ name: "Sample Co", isDemo: true }) === "flag", "is_demo is excluded");
assert(exclusionReason({ name: "Bot Co", isBot: true }) === "flag", "is_bot is excluded");
assert(exclusionReason({ name: "Clean Co", isTest: true }) === "flag", "is_test is honored when present");
assert(
  exclusionReason({ name: "Ben Accountants" }) === "known-e2e",
  "Ben Accountants is the E2E account",
);
assert(
  exclusionReason({ name: "the Milōn Team" }) === "known-team",
  "the Milōn team firm is internal",
);
assert(
  exclusionReason({ name: "QA US Test LLC (delete me)" }) === "name",
  "QA / test / delete me names are excluded",
);
assert(isExcludedFromInstrument({ name: "Test Firm 3" }), "Test Firm 3 is excluded");
assert(isExcludedFromInstrument({ name: "Test Firm" }), "Test Firm is excluded");
assert(isExcludedFromInstrument({ name: "test-co" }), "test-co is excluded");
assert(isExcludedFromInstrument({ name: "QA Test Co" }), "QA Test Co is excluded");
assert(isExcludedFromInstrument({ name: "E2E Practice" }), "E2E in the name is excluded");
assert(!isExcludedFromInstrument({ name: "Testa" }), "Testa is kept");
assert(!isExcludedFromInstrument({ name: "Contest" }), "Contest is kept");
assert(isExcludedFromInstrument({ name: "Smoke Owner" }), "Smoke Owner is excluded");
assert(!isExcludedFromInstrument({ name: "Smokey Books" }), "smoke inside another word is kept");
assert(!isExcludedFromInstrument({ name: "smokestack" }), "smokestack is kept");
assert(
  exclusionReason({ name: "James Fleming", email: "team@trymilon.co.za" }) === "email",
  "trymilon.co.za is an internal domain",
);
assert(
  exclusionReason({ name: "Milōn", email: "hello@trymilon.com" }) === "email",
  "trymilon.com is an internal domain",
);
assert(
  !isExcludedFromInstrument({ name: "James Fleming", email: "james@harbour.co" }),
  "an external person with a normal name stays",
);
assert(!isExcludedFromInstrument({ name: "theo firm" }), "theo firm is not a name rule");
assert(
  exclusionReason({ name: "theo firm", ownerEmail: "amstel.west@gmail.com" }, internal) === "email",
  "a founder-owned firm is excluded by owner email",
);
assert(
  !isExcludedFromInstrument({ name: "theo firm", ownerEmail: "ada@harbour.co" }, internal),
  "theo firm with an external owner stays",
);
assert(
  !isExcludedFromInstrument({ name: "Square Books" }),
  "qa inside another word is not enough",
);
assert(
  exclusionReason({ name: "My practice" }) === "placeholder",
  "My practice with no owner is a placeholder",
);
assert(
  exclusionReason({ name: "My practice", ownerEmail: "amstel.west@gmail.com" }, internal) ===
    "placeholder",
  "My practice owned by an internal email is excluded",
);
assert(
  !isExcludedFromInstrument({ name: "My practice", ownerEmail: "ada@harbour.test" }) === false ||
    isExcludedFromInstrument({ name: "My practice", ownerEmail: "ada@harbour.co" }) === false,
  "My practice with an external owner can stay",
);
assert(
  !isExcludedFromInstrument({ name: "My practice", ownerEmail: "ada@harbour.co" }),
  "external My practice is kept",
);
assert(
  exclusionReason({ name: "Harbour & Co", ownerEmail: "ops@milon.it" }, internal) === "email",
  "a team-owned firm is excluded even with a normal name",
);
assert(
  isExcludedFromInstrument({ name: "Ada", email: "qa.user@gmail.com" }),
  "a test mailbox is excluded",
);
assert(
  !isExcludedFromInstrument({ name: "Harbour & Co", ownerEmail: "ada@harbour.co" }, internal),
  "a real practice stays",
);

const firms = [
  { name: "Harbour & Co" },
  { name: "North Books" },
  { name: "Field & Co" },
  { name: "Ledger Room" },
  { name: "Oak Practice" },
  { name: "Pine Advisory" },
  { name: "West Margin" },
  { name: "QA US Test LLC (delete me)" },
  { name: "the Milon Team" },
];
const counted = realFirmCount(firms, internal);
assert(counted === 7, `shared firm count drops two test firms, got ${counted}`);
assert(realFirmCount(firms, internal) === counted, "signups and usage share one count");

const queue = [
  {
    id: 1,
    practice_id: "north",
    practice_name: "North Books",
    stall_type: "upload_no_report",
    severity: "high",
    suggested_question: "What happened after the upload?",
  },
  {
    id: 2,
    practice_id: "north",
    practice_name: "North Books",
    stall_type: "send_no_assign",
    severity: "high",
    suggested_question: "Why was the report not followed by a task?",
  },
  {
    id: 3,
    practice_id: "ben",
    practice_name: "Ben Accountants",
    stall_type: "signup_no_entity",
    severity: "high",
    suggested_question: "Ben should never be the call",
  },
  {
    id: 4,
    practice_name: "Test Firm 3",
    stall_type: "signup_no_entity",
    severity: "high",
    suggested_question: "Ignore",
  },
  {
    id: 5,
    practice_name: "My practice",
    stall_type: "signup_no_entity",
    severity: "medium",
    suggested_question: "Placeholder",
  },
];
const commitment = [
  {
    practice_id: "north",
    practice_name: "North Books",
    highest_rung: "report_sent_to_client",
    points: 15,
  },
  {
    practice_id: "ben",
    practice_name: "Ben Accountants",
    highest_rung: "task_assigned",
    points: 20,
  },
];
const calls = dedupePracticeCalls(queue, commitment, internal);
assert(calls.length === 1, `one card per real practice, got ${calls.length}`);
assert(calls[0].name === "North Books", "the remaining card is the real practice");
assert(calls[0].queueIds.length === 2, "duplicate stalls merge onto one card");
assert(
  calls[0].furthestLabel === "Sent a report to a client",
  "the card shows the furthest ladder step, which is what disagreed with the stall",
);
assert(calls[0].stallType === "send_no_assign", "the call uses the further stall");
const next = pickNextCall(calls, internal);
assert(next?.name === "North Books", "do this next is the real practice");
assert(
  pickNextCall(
    [
      {
        key: "t",
        practiceId: "t",
        name: "Test Firm 3",
        founding: false,
        furthestRung: null,
        furthestLabel: "Signed up",
        stallType: "signup_no_entity",
        severity: "high",
        question: "no",
        why: "",
        queueIds: [9],
        ownerEmail: null,
        isInternal: false,
        isTest: false,
      },
    ],
    internal,
  ) === null,
  "do this next never picks a test firm",
);

assert(readingVerdict(2, "bad") === "too early, n=2", "n=2 is too early, not broken");
assert(!readingVerdict(2, "bad").toLowerCase().includes("broken"), "no broken verdict under n=5");
assert(readingVerdict(2, "bad") !== "Contradicted", "no contradicted verdict under n=5");
assert(honestHypothesisLabel("contradicted", 2) === "too early, n=2", "hypotheses stay honest at n=2");
assert(honestHypothesisLabel("blocked", 2) === "blocked", "a blocked hypothesis stays blocked");
assert(honestHypothesisLabel("contradicted", 6) === "contradicted", "a large sample can still contradict");
const labels = compactHypothesisLabels(
  [
    { id: "H1", status: "contradicted", title: "Useful" },
    { id: "H3", status: "blocked", title: "Extraction" },
  ],
  2,
);
assert(labels[0].label === "too early, n=2" && labels[1].label === "blocked", "one compact row of labels");

const oldWeek: ActivationRow = {
  cohort_week: "2026-09-14",
  is_founding_practice: false,
  practices: 2,
  reached_send: 0,
  activation_14d_pct: 0,
};
const inWindow: ActivationRow = {
  cohort_week: "2026-09-28",
  is_founding_practice: false,
  practices: 2,
  reached_entity: 2,
  reached_upload: 1,
  reached_send: 0,
  reached_assign: 0,
  reached_completion: 0,
  activation_14d_pct: 0,
};
const glance = buildGlance({
  activation: [oldWeek, inWindow],
  loop: { assigned: 9, completed: 4 },
  brain: { "brain.proposed": 11, "report.sent": 7, "brain.step.approved": 3 },
  contacted: 4,
  replied: 1,
  signups7d: 3,
  revenueLabel: "R0",
  reviewInbox: 2,
  reviewDueNow: 1,
  now: NOW,
});
assert(glance.reports.windowLabel === "Rolling 14 days", "the window is labelled");
assert(glance.reports.n === 2, "the opaque September 14 week is not the headline");
assert(glance.reports.valueLabel === "0%", "the report rate is the sent share");
assert(glance.reports.verdict === "too early, n=2", "glance shows too early, n=2");
assert(glance.funnel.map((step) => step.label).join(",") === GLANCE_FUNNEL_LABELS.join(","), "one funnel");
assert(glance.funnel.find((step) => step.key === "report")?.count === 0, "brain report count does not override activation");
assert(!glance.funnel.some((step) => step.label === "Emailed"), "the loop is not a second funnel");
assert(glance.outbound.contacted === 4 && glance.outbound.replied === 1, "outbound is contacted and replied");
assert(glance.outbound.replyRateLabel === "25%", "reply rate is replied over contacted");
assert(glance.signupsLabel === "3", "new signups 7d");
assert(glance.revenueLabel === "R0", "revenue received");
assert(glance.review.inbox === 2 && glance.review.dueNow === 1, "review inbox and due now");
assert(glance.review.href === REVIEW_HREF && REVIEW_HREF === "/ops?tab=agent", "review links to the agent tab");

const reviewNow = new Date("2026-10-06T13:00:00Z");
const reviewLead: AgentLead = {
  id: "harbour",
  name: "Ada",
  company: "Harbour & Co",
  email: "ada@harbour.co",
  stage: "contacted",
  doNotContact: false,
  nextTouchOn: "2026-10-06",
  nextFollowUpAt: null,
  lastTouchAt: null,
  sequenceStep: 0,
  country: "US",
  region: "NY",
  timezone: "America/New_York",
  touches: [
    {
      id: "draft-1",
      stepNo: 1,
      angle: "observation",
      subject: "First",
      body: null,
      status: "draft",
      sentAt: null,
    },
    {
      id: "draft-2",
      stepNo: 2,
      angle: "value",
      subject: "Second",
      body: null,
      status: "approved",
      sentAt: null,
    },
  ],
};
const reviewLeads = [reviewLead];
const pulse = lighthouseReviewPulse(reviewLeads, reviewNow);
assert(
  pulse.inbox === buildReviewInbox(reviewLeads).length && pulse.inbox === 2,
  "review pulse counts pending review drafts",
);
assert(
  pulse.dueNow === buildDueQueue(reviewLeads, reviewNow).filter((row) => row.open).length &&
    pulse.dueNow === 1,
  "review pulse counts due-now the same way as the agent queue",
);
const metricsSrc = read("src/lib/metrics.functions.ts");
const panelSrc = read("src/components/lighthouse-panel.tsx");
const lighthouseSrc = read("src/lib/lighthouse.functions.ts");
assert(metricsSrc.includes("lighthouseReviewPulse("), "glance review count calls lighthouseReviewPulse");
assert(panelSrc.includes("lighthouseReviewPulse("), "agent tab review count calls lighthouseReviewPulse");
assert(
  metricsSrc.includes("loadLighthouseWorkbenchBook("),
  "glance loads leads through the workbench book",
);
assert(
  lighthouseSrc.includes("await loadLighthouseWorkbenchBook(admin)"),
  "the agent tab loads leads through the same function",
);
assert(!metricsSrc.includes('.in("lead_id"'), "glance does not use a separate touch id filter");

const empty = buildGlance({
  activation: [oldWeek],
  loop: { assigned: 0, completed: 0 },
  brain: { "owner.invite.redeemed": 1, "seat.accepted": 1, "report.sent": 3, "brain.proposed": 9 },
  contacted: 0,
  replied: 0,
  signups7d: null,
  revenueLabel: "R0",
  reviewInbox: 0,
  reviewDueNow: 0,
  now: NOW,
});
assert(empty.reports.verdict === "too early, n=0", "no closed week is substituted");
assert(empty.funnel.find((step) => step.key === "client")?.count === 2, "brain accepts fold into client");
assert(empty.funnel.find((step) => step.key === "report")?.count === 3, "brain sends fold into report");
assert(empty.funnel.every((step) => GLANCE_FUNNEL_LABELS.includes(step.label)), "fallback is the same five steps");
const merged = buildMergedFunnel({
  activation: null,
  loop: { assigned: 4, completed: 1 },
  brain: { "brain.proposed": 20 },
});
assert(!merged.steps.some((step) => step.count === 20), "brain proposed is not its own step");

assert(cohortRowsForDisplay([oldWeek, inWindow]).length === 0, "cohorts under n=5 stay hidden");
assert(
  cohortRowsForDisplay([{ ...inWindow, practices: 5 }]).length === 1,
  "a cohort appears once n is at least 5",
);

for (const key of PILOT_FLAG_KEYS) {
  assert(!isPilotFlagVisible(key), `${key} stays hidden until it is wired`);
}

const page = read("src/routes/_authenticated/founder.metrics.tsx");
const ops = read("src/routes/_authenticated/ops.tsx");
const usage = read("src/components/lighthouse-usage.tsx");
const system = read("src/components/lighthouse-panel.tsx");
for (const killed of [
  "Five readings",
  "The loop",
  "What we watch",
  "How far each practice",
  "Assign week",
  "How a practice activates",
]) {
  assert(!page.includes(killed), `founder page still has ${killed}`);
}
assert(page.includes("Do this next"), "the next call stays");
assert(page.includes("Log a conversation signal"), "the signal form stays");
assert(page.includes("<details"), "experiments stay collapsed");
assert(page.includes('search={{ tab: "agent" }}'), "clear review inbox opens the agent tab");
assert(!ops.includes("Sales engine"), "sales engine card is gone");
assert(!ops.includes("Owned clients"), "clients are not listed twice");
assert(!ops.includes("FunnelHealthPanel"), "client brain funnel left platform metrics");
assert(!ops.includes("Client brain"), "platform metrics do not repeat the funnel");
assert(!ops.includes("Not wired yet"), "unwired pilot knobs are not labelled as switches");
assert(ops.includes("isPilotFlagVisible"), "pilot knobs are filtered");
const checkoutAt = ops.indexOf("Test Solo checkout");
const guardAt = ops.lastIndexOf("import.meta.env.PROD", checkoutAt);
assert(checkoutAt > 0 && guardAt !== -1 && checkoutAt - guardAt < 2000, "test checkout is hidden on prod");
assert(!usage.includes("Recent movement"), "recent movement feed is gone");
assert(usage.includes("Most active"), "most active stays");
const usageDetailsAt = usage.indexOf("<details");
const usageDetailsEnd = usage.indexOf("</details>");
const mostActiveAt = usage.indexOf("Most active");
assert(
  usageDetailsAt !== -1 &&
    mostActiveAt > usageDetailsAt &&
    usageDetailsEnd !== -1 &&
    mostActiveAt < usageDetailsEnd,
  "most active sits inside the collapsed usage section",
);
assert(!usage.slice(usageDetailsEnd).includes("Most active"), "most active is not rendered below the section");
assert(!usage.includes("<details open"), "the usage section starts collapsed");
const accessSrc = read("src/lib/lighthouse-access.functions.ts");
const queriesSrc = read("src/lib/lighthouse-it.functions.ts");
const usageSrc = read("src/lib/product-usage.functions.ts");
assert(
  accessSrc.includes("isExcludedFromInstrument") && accessSrc.includes("ownerEmail"),
  "access drops firms through the exclusion helper",
);
assert(
  queriesSrc.includes("isExcludedFromInstrument") && queriesSrc.includes("ownerEmail"),
  "queries drop firms through the exclusion helper",
);
assert(
  usageSrc.includes("isExcludedFromInstrument") && usageSrc.includes("email: emailByUser.get(userId)"),
  "most active filters people through the exclusion helper",
);
assert(usage.includes("<details"), "product usage breakdown stays collapsed");
assert(system.includes("<FunnelHealthPanel />"), "dry-run preflight sits on System");
assert(read("src/lib/owner-ops.functions.ts").includes("realFirmCount"), "signups use the shared firm count");
assert(read("src/lib/product-usage.functions.ts").includes("realFirmCount"), "usage uses the shared firm count");
assert(read("src/lib/metrics.functions.ts").includes("Promise.all"), "founder load runs independent reads together");

console.log("founder-instrument-test: ok");
