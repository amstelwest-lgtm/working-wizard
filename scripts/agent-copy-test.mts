/**
 * Source-side copy for the three agents. No database.
 * Run: pnpm test:agent-copy
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FM_DRAFT_KINDS } from "../src/lib/agent-financial-manager.ts";
import { prepareDraftRecord } from "../src/lib/agent-draft.ts";
import {
  AGENT_COPY_GUIDE,
  agentCopyStatus,
  attachCitedEvidence,
  citedNumbers,
  displayAmounts,
  draftMetricUnit,
  evidenceMetrics,
  polishAgentCopy,
  severityWithFloor,
} from "../src/lib/agent-bus.ts";
import { refreshedFindingUpdate } from "../src/lib/agent-analyst.ts";
import { ADVISOR_SYSTEM } from "../supabase/functions/_shared/agent-prompts/advisor.ts";
import { ANALYST_SYSTEM } from "../supabase/functions/_shared/agent-prompts/analyst.ts";
import { FINANCIAL_MANAGER_SYSTEM } from "../supabase/functions/_shared/agent-prompts/financial-manager.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ZA = { currency: "ZAR" as const, locale: "en-ZA" };
const US = { currency: "USD" as const, locale: "en-US" };
const THEO_BAD = "Low R 36 154. R 13 846 under R 50 000. get emails out to 10 clients";
const THEO_GOOD = "Cash is R 13 846 below your R 50 000 minimum. Send reminder emails to 10 clients.";
const MARGIN_DUMP = "Gross margin is 0.6. Debtor days are 43.8.";

const bad = polishAgentCopy({ text: THEO_BAD, role: "title" });
assert(
  bad.ok === true && bad.text === "Low R 36 154. R 13 846 under R 50 000.",
  "a long title keeps the first two sentences",
);
const badDetail = polishAgentCopy({ text: THEO_BAD, role: "detail" });
assert(
  badDetail.ok === true &&
    badDetail.text === "Low R 36 154. R 13 846 under R 50 000. Get emails out to 10 clients.",
  "a three-sentence detail is kept and capitalised",
);
const fragment = polishAgentCopy({ text: "Low R 36 154", role: "title" });
assert(fragment.ok === true && fragment.text === "Low R 36 154.", "a fragment gains a capital and a full stop");
const bare = polishAgentCopy({ text: "13846", role: "summary" });
assert(bare.ok === false, "a bare number is refused");
const empty = polishAgentCopy({ text: "   ", role: "title" });
assert(empty.ok === false, "an empty title is refused");

const good = polishAgentCopy({
  text: THEO_GOOD,
  role: "summary",
  figures: { cash: 13846 },
  market: ZA,
});
assert(good.ok === true && good.text === THEO_GOOD, "Theo's good sentences stay as written");

const cased = polishAgentCopy({
  text: "cash is R 13 846 below your R 50 000 minimum",
  role: "title",
  figures: { cash: 13846 },
  market: ZA,
});
assert(
  cased.ok === true && cased.text === "Cash is R 13 846 below your R 50 000 minimum.",
  "a lowercase start gains a capital and a full stop",
);

const dollars = polishAgentCopy({
  text: "Cash is 13846 below the minimum.",
  role: "title",
  figures: { cash: 13846 },
  market: US,
});
assert(dollars.ok === true && dollars.text === "Cash is $13,846 below the minimum.", "a US amount uses $13,846");

const rands = polishAgentCopy({
  text: "Cash is 13846 below the minimum.",
  role: "detail",
  figures: { cash: 13846 },
  market: ZA,
});
assert(rands.ok === true && rands.text === "Cash is R 13 846 below the minimum.", "a ZA amount uses R 13 846");

const closing = polishAgentCopy({
  text: "Closing cash is 46300.",
  role: "title",
  figures: { week_1_closing: 46300 },
  market: US,
});
assert(closing.ok === true && closing.text === "Closing cash is $46,300.", "a cashflow closing uses $46,300");
const opening = polishAgentCopy({
  text: "Opening cash is 128 450.",
  role: "detail",
  figures: { opening_balance: 128450 },
  market: ZA,
});
assert(opening.ok === true && opening.text === "Opening cash is R 128 450.", "a spaced cashflow amount uses R 128 450");
const already = polishAgentCopy({
  text: "Opening cash is R 128 450.",
  role: "title",
  figures: { opening_balance: 128450 },
  market: ZA,
});
assert(already.ok === true && already.text === "Opening cash is R 128 450.", "a formatted rand amount is not doubled");
const display = displayAmounts({ week_1_closing: 46300, opening_balance: 128450, cash_runway_weeks: 13 }, US);
assert(display.week_1_closing === "$46,300" && display.opening_balance === "$128,450", "cashflow display uses $46,300");
assert(display.cash_runway_weeks == null, "runway weeks stay out of the currency display");
const displayZa = displayAmounts({ opening_balance: 128450, week_1_closing: 46300 }, ZA);
assert(displayZa.opening_balance === "R 128 450" && displayZa.week_1_closing === "R 46 300", "cashflow display uses R 46 300");

const six = polishAgentCopy({
  text: "Cash is 46300. The saved cashflow is on file. Week one is the low point. Send the September pack. Ask the client to confirm. Then review the budget.",
  role: "detail",
  figures: { week_1_closing: 46300 },
  market: US,
});
assert(
  six.ok === true &&
    six.text ===
      "Cash is $46,300. The saved cashflow is on file. Week one is the low point. Send the September pack.",
  "a long detail keeps four sentences and still saves",
);

const ratios = polishAgentCopy({
  text: "Gross margin is 0.6. Debtor days are 43.8.",
  role: "detail",
  figures: { "Gross Margin": 0.6, "Debtor Days": 43.8 },
  market: ZA,
});
assert(
  ratios.ok === true && ratios.text === "Gross margin is 60%. Debtor days are 44 days.",
  "0.6 becomes 60% and 43.8 becomes 44 days",
);

assert(citedNumbers("R 13 846").map((n) => n.value).join(",") === "13846", "R 13 846 is one amount");
assert(citedNumbers("$13,846").map((n) => n.value).join(",") === "13846", "$13,846 is one amount");
assert(citedNumbers("Gross margin is 60%").map((n) => n.value).join(",") === "60", "60% is the percent form of 0.6");

const cashCited = attachCitedEvidence({
  title: THEO_GOOD,
  detail: "",
  pool: [{ snapshotId: null, periodLabel: "saved cashflow", figures: { cash: 13846 } }],
  evidence: { snapshot_id: null, period_label: "saved cashflow", figures: { cash: 13846 } },
});
assert(cashCited.ok === true, "R 13 846 matches stored 13846 and the floor is not a missing figure");

const percentCited = attachCitedEvidence({
  title: "Gross margin is 60%.",
  detail: "Debtor days are 44 days.",
  pool: [
    {
      snapshotId: "snap-sep",
      periodLabel: "Sep 2026",
      figures: { "Gross Margin": 0.6, "Debtor Days": 43.8 },
    },
  ],
  evidence: { snapshot_id: "snap-sep", period_label: "Sep 2026", figures: {} },
});
assert(percentCited.ok === true, "60% matches 0.6 and 44 days matches 43.8");
if (percentCited.ok) {
  const figs = percentCited.evidence.figures as Record<string, number>;
  assert(figs["Gross Margin"] === 0.6 && figs["Debtor Days"] === 43.8, "evidence keeps the stored ratio and days");
}

const books = [
  {
    snapshotId: "snap-sep",
    periodLabel: "Sep 2026",
    figures: { "Gross Margin": 0.6, "Debtor Days": 43.8 },
  },
];
const dump = prepareDraftRecord({
  kind: "data_request_draft",
  allowedKinds: FM_DRAFT_KINDS,
  severity: "watch",
  title: MARGIN_DUMP,
  detail: "Send the September debtors age analysis.",
  claimedFigures: { "Gross Margin": 0.6, "Debtor Days": 43.8 },
  pool: books,
  recordedKeys: new Set(),
  market: ZA,
});
assert(dump.ok === false, "a data request title cannot be the ratios");
if (!dump.ok) assert(dump.error.includes("Send the September debtors age analysis"), "the refusal shows the ask");

const ask = prepareDraftRecord({
  kind: "data_request_draft",
  allowedKinds: FM_DRAFT_KINDS,
  severity: "watch",
  title: "Send the September debtors age analysis",
  detail: MARGIN_DUMP,
  claimedFigures: { "Gross Margin": 0.6, "Debtor Days": 43.8 },
  pool: books,
  recordedKeys: new Set(),
  market: ZA,
});
assert(ask.ok === true, "the ask itself is a data request title");
if (ask.ok) {
  assert(ask.title === "Send the September debtors age analysis.", "the ask gains a full stop");
  assert(ask.detail === "Gross margin is 60%. Debtor days are 44 days.", "the detail quotes percent and whole days");
  assert(ask.severity === "watch" && ask.evidence.status === "attention", "watch is attention when cash is not under the floor");
  const margin = ask.evidence.metrics?.find((metric) => metric.metric === "Gross Margin");
  const days = ask.evidence.metrics?.find((metric) => metric.metric === "Debtor Days");
  assert(margin?.value === 60 && margin.value_raw === 0.6 && margin.unit === "percent" && margin.period === "Sep 2026", "gross margin is stored as 60, with the fraction beside it");
  assert(days?.value === 43.8 && days.unit === "days" && days.value_raw == null, "debtor days keep the stored 43.8");
}

const periodLeak = polishAgentCopy({
  text: "Gross margin is 1 for Jan 1 – Sep 30, 2026.",
  role: "detail",
  figures: { "Gross Margin": 1 },
  market: US,
});
assert(periodLeak.ok === true, "a dated margin sentence is still a sentence");
if (periodLeak.ok) {
  assert(periodLeak.text.includes("100%"), periodLeak.text);
  assert(periodLeak.text.includes("Jan 1 – Sep 30, 2026"), periodLeak.text);
  assert(!periodLeak.text.includes("100% –"), periodLeak.text);
}
const storedLeak = polishAgentCopy({
  text: "Books cover Jan 100% – Sep 30, 2026.",
  role: "detail",
  figures: { "Gross Margin": 1 },
  market: US,
});
assert(
  storedLeak.ok === true && storedLeak.text.includes("Jan 1 – Sep 30, 2026") && !storedLeak.text.includes("100% –"),
  storedLeak.ok ? storedLeak.text : "refused",
);
const zaDay = polishAgentCopy({
  text: "Gross margin is 1 for 1 Jan – 30 Sep 2026.",
  role: "detail",
  figures: { "Gross Margin": 1 },
  market: ZA,
});
assert(
  zaDay.ok === true && zaDay.text.includes("1 Jan – 30 Sep 2026") && !zaDay.text.includes("100% Jan"),
  zaDay.ok ? zaDay.text : "refused",
);

const sales = polishAgentCopy({
  text: "Cost of sales is 13846.",
  role: "detail",
  figures: { cost_of_sales: 13846, fixed_cost_ratio: 0.6 },
  market: ZA,
});
assert(sales.ok === true && sales.text === "Cost of sales is R 13 846.", "cost of sales stays money");
const costMetrics = evidenceMetrics({ cost_of_sales: 13846, fixed_cost_ratio: 0.6 }, "Sep 2026", ZA);
const salesMetric = costMetrics.find((metric) => metric.metric === "cost_of_sales");
const costRatio = costMetrics.find((metric) => metric.metric === "fixed_cost_ratio");
assert(salesMetric?.unit === "currency" && salesMetric.value === 13846, "cost of sales is a currency metric");
assert(costRatio?.unit === "percent" && costRatio.value === 60 && costRatio.value_raw === 0.6, "a cost ratio is stored as a percentage");

const runway = polishAgentCopy({
  text: "Cash runway is 13 weeks.",
  role: "summary",
  figures: { cash_runway_weeks: 13 },
  market: ZA,
});
assert(runway.ok === true && runway.text === "Cash runway is 13 weeks.", "a week count stays a count");
const runwayMetrics = evidenceMetrics({ cash_runway_weeks: 13 }, "saved cashflow", ZA);
assert(runwayMetrics[0]?.unit === "count" && runwayMetrics[0]?.floor == null, "runway weeks are not a cash floor");

const cashMetrics = evidenceMetrics({ cash: 13846 }, "saved cashflow", ZA);
assert(cashMetrics[0]?.floor === 50_000 && cashMetrics[0]?.unit === "currency", "cash carries the comfort floor");
assert(severityWithFloor("info", cashMetrics) === "act", "cash under the floor raises severity to act");
assert(agentCopyStatus(severityWithFloor("watch", cashMetrics)) === "critical", "a floor breach is critical because severity is act");
assert(agentCopyStatus("info") === "healthy", "info is healthy");
assert(agentCopyStatus("watch") === "attention", "watch is attention");
assert(agentCopyStatus("act") === "critical", "act is critical");
const net = polishAgentCopy({
  text: "Net margin is 9%.",
  role: "detail",
  figures: { "Net Margin": 0.08571428571428572 },
  market: US,
});
assert(net.ok === true && net.text === "Net margin is 8.6%.", "9% for 0.0857 is rewritten to one decimal");
const netLow = polishAgentCopy({
  text: "Net margin is 8%.",
  role: "detail",
  figures: { "Net Margin": 0.08571428571428572 },
  market: US,
});
assert(netLow.ok === true && netLow.text === "Net margin is 8.6%.", "8% for 0.0857 is rewritten to one decimal");
const netMetrics = evidenceMetrics(
  { "Net Margin": 0.08571428571428572, "Operating Margin": 0.16, "Gross Margin": 60, "Debtor Days": 43.8 },
  "Oct 2026",
  US,
);
const netMetric = netMetrics.find((metric) => metric.metric === "Net Margin");
const operating = netMetrics.find((metric) => metric.metric === "Operating Margin");
const alreadyPercent = netMetrics.find((metric) => metric.metric === "Gross Margin");
assert(netMetric?.value === 8.6 && netMetric.value_raw === 0.08571428571428572, "0.0857 is stored as 8.6, with the fraction beside it");
assert(operating?.value === 16 && operating.value_raw === 0.16, "0.16 is stored as 16");
assert(alreadyPercent?.value === 60 && alreadyPercent.value_raw == null, "a percentage already on the percent scale is not doubled");
assert(netMetrics.find((metric) => metric.metric === "Debtor Days")?.value === 43.8, "a days metric keeps the stored days");
const band = polishAgentCopy({
  text: "Creditor days of 73 days are above the 30–60 day healthy band on file.",
  role: "detail",
  figures: { "Creditor Days": 73 },
  storedNumbers: [73, 43.8],
});
assert(
  band.ok === true && band.text === "Creditor days of 73 days are above the healthy band.",
  "an unstored healthy band loses its invented range",
);
const bandTo = polishAgentCopy({
  text: "Creditor days of 73 days are above the 30 to 60 day healthy band on file.",
  role: "detail",
  figures: { "Creditor Days": 73 },
  storedNumbers: [73],
});
assert(bandTo.ok === true && bandTo.text === "Creditor days of 73 days are above the healthy band.", "an unstored band joined by to is stripped");
const bandKept = polishAgentCopy({
  text: "Creditor days of 73 days are above the 30–60 day healthy band on file.",
  role: "detail",
  figures: { "Creditor Days": 73 },
  storedNumbers: [30, 60, 73],
});
assert(
  bandKept.ok === true && bandKept.text === "Creditor days of 73 days are above the 30–60 day healthy band on file.",
  "a stored healthy band stays in the sentence",
);
const storedBand = polishAgentCopy({
  text: "Creditor days of 73 days are above the stored 30–60 day band.",
  role: "detail",
  figures: { "Creditor Days": 73 },
  storedNumbers: [73, 43.8],
});
assert(
  storedBand.ok === true && storedBand.text === "Creditor days of 73 days are above the band.",
  "an unstored day band loses its range",
);
const storedBandKept = polishAgentCopy({
  text: "Creditor days of 73 days are above the stored 30–60 day band.",
  role: "detail",
  figures: { "Creditor Days": 73 },
  storedNumbers: [30, 60, 73],
});
assert(
  storedBandKept.ok === true && storedBandKept.text === "Creditor days of 73 days are above the stored 30–60 day band.",
  "a day band stays when both ends were read",
);
const thinCash = prepareDraftRecord({
  kind: "action_point_draft",
  allowedKinds: FM_DRAFT_KINDS,
  severity: "watch",
  title: "Cash on file is 13846",
  detail: "Opening cash is 13846.",
  claimedFigures: { cash: 13846 },
  pool: [{ snapshotId: null, periodLabel: "saved cashflow", figures: { cash: 13846 } }],
  recordedKeys: new Set(),
  market: ZA,
});
assert(thinCash.ok === true && thinCash.severity === "act" && thinCash.evidence.status === "critical", "a cash-floor breach saves as act and critical");

for (const prompt of [ANALYST_SYSTEM, FINANCIAL_MANAGER_SYSTEM, ADVISOR_SYSTEM]) {
  assert(prompt.includes(THEO_BAD), "the prompt shows Theo's bad sentences");
  assert(prompt.includes(THEO_GOOD), "the prompt shows Theo's good sentences");
  assert(prompt.includes(MARGIN_DUMP), "the prompt shows the gross-margin title");
  assert(prompt.includes("Send the September debtors age analysis."), "the prompt shows the ask");
}
assert(AGENT_COPY_GUIDE.includes("R 13 846") && AGENT_COPY_GUIDE.includes("$13,846"), "the guide names both amount formats");
assert(AGENT_COPY_GUIDE.includes("8.6%"), "the guide keeps one decimal on a percent");
assert(AGENT_COPY_GUIDE.includes("30–60 day healthy band on file"), "the guide refuses an invented healthy band");
assert(AGENT_COPY_GUIDE.includes("stored 69 vs live 67"), "the guide forbids a stored-versus-live score");

const keptOpen = polishAgentCopy({
  text: "Next move: lift Profit Drivers (58/100) — review pricing on top lines and the fixed-cost base",
  role: "title",
});
assert(
  keptOpen.ok === true &&
    keptOpen.text === "Next move: lift Profit Drivers (58/100) — review pricing on top lines and the fixed-cost base.",
  "an active title gains a full stop",
);
const keptTwo = polishAgentCopy({
  text: "Profit Drivers is the weak pillar (50); stored health 69 vs live 67. Margin and pricing review for accountant",
  role: "title",
});
assert(
  keptTwo.ok === true &&
    keptTwo.text ===
      "Profit Drivers is the weak pillar (50); health 67. Margin and pricing review for accountant." &&
    !keptTwo.text.includes("69") &&
    !/stored\s+health/i.test(keptTwo.text),
  "a two-sentence title quotes the live score and drops the stored comparison",
);
const healthNotDays = polishAgentCopy({
  text: "Profit is the weak pillar (50); stored health 69 vs live 67.",
  role: "title",
  figures: { "Working Capital Days": 69, overall: 69, live_overall: 67 },
});
assert(
  healthNotDays.ok === true &&
    healthNotDays.text === "Profit is the weak pillar (50); health 67." &&
    !healthNotDays.text.includes("69") &&
    !healthNotDays.text.includes("days"),
  `a health score stays a score and quotes live 67 (${healthNotDays.ok ? healthNotDays.text : "refused"})`,
);
const doubledDays = polishAgentCopy({
  text: "Creditor days of 73 days days.",
  role: "detail",
  figures: { "Creditor Days": 73 },
});
assert(
  doubledDays.ok === true && doubledDays.text === "Creditor days of 73 days.",
  `days is written once (${doubledDays.ok ? doubledDays.text : "refused"})`,
);
const healthUnit = polishAgentCopy({
  text: "Stored health 69 days vs live 67.",
  role: "title",
  figures: { "Working Capital Days": 69, live_overall: 67 },
});
assert(
  healthUnit.ok === true &&
    healthUnit.text === "Health 67." &&
    !healthUnit.text.includes("69") &&
    !/stored\s+health/i.test(healthUnit.text),
  `health quotes the live score and loses a days unit (${healthUnit.ok ? healthUnit.text : "refused"})`,
);
assert(draftMetricUnit("overall", 69) === "count", "health is a score with no unit");
assert(draftMetricUnit("live_overall", 67) === "count", "live health is a score");
assert(draftMetricUnit("Working Capital Days", 69) === "days", "working capital days stay days");
assert(draftMetricUnit("Creditor Days", 73) === "days", "creditor days stay days");
assert(draftMetricUnit("Operating Margin", 0.086) === "percent", "operating margin is a percent");
const margin = polishAgentCopy({
  text: "The operating margin of 16.0% is the figure to quote.",
  role: "detail",
  figures: { "Operating Margin": 0.16 },
  canonicalRatios: { "Operating Margin": 0.086 },
});
assert(
  margin.ok === true && margin.text.includes("8.6%") && !margin.text.includes("16.0%"),
  `drafts quote the scorecard operating margin (${margin.ok ? margin.text : "refused"})`,
);
const keptDays = polishAgentCopy({
  text: "Oct 2026: debtor days 43.8 and creditor days 73 (Sep: 25 and 37). Confirm the swing before acting",
  role: "title",
});
assert(
  keptDays.ok === true &&
    keptDays.text ===
      "Oct 2026: debtor days 43.8 and creditor days 73 (Sep: 25 and 37). Confirm the swing before acting.",
  "a decimal day count is not split into a new sentence",
);

const refresh = refreshedFindingUpdate({
  title: "Cash is $46,300.",
  detail: "Opening cash is R 128 450.",
  seenAt: "2026-10-11T20:00:00.000Z",
  severity: "watch",
  existingSeverity: "info",
  existingEvidence: { figures: { cash: 1 }, draft: true, superseded_by: "stay-out" },
  nextEvidence: { figures: { week_1_closing: 46300 }, status: "attention", metrics: [{ metric: "week_1_closing", value: 46300, unit: "currency", period: "saved cashflow" }] },
});
assert(refresh.title === "Cash is $46,300." && refresh.detail === "Opening cash is R 128 450.", "a dedupe hit stores the new copy");
assert(refresh.severity === "watch" && refresh.last_seen === "2026-10-11T20:00:00.000Z", "a higher severity is kept with last_seen");
const refreshedEvidence = refresh.evidence as { status: string; draft: boolean; figures: { week_1_closing: number } };
assert(refreshedEvidence.status === "attention" && refreshedEvidence.draft === true, "status is refreshed and draft flags stay");
assert(refreshedEvidence.figures.week_1_closing === 46300, "the new figures replace the kept figures");
assert(!("id" in refresh) && !("created_at" in refresh) && !("superseded_by" in refresh), "id, first seen, and the superseded link stay off the patch");
const approved = refreshedFindingUpdate({
  title: "Cash is $46,300.",
  detail: "Send the September debtors age analysis.",
  seenAt: "2026-10-11T20:00:00.000Z",
  severity: "info",
  existingSeverity: "watch",
  existingEvidence: { figures: { cash: 1 }, draft: false, requires_human_approval: false },
  nextEvidence: { figures: { cash: 46300 }, draft: true, requires_human_approval: true, status: "healthy", metrics: [] },
});
const approvedEvidence = approved.evidence as { draft: boolean; requires_human_approval: boolean; status: string };
assert(approved.severity === "watch" && approvedEvidence.draft === false, "a dedupe hit does not reopen an approved draft");
assert(approvedEvidence.requires_human_approval === false && approvedEvidence.status === "attention", "approval flags stay and status follows the kept severity");
const keptAct = refreshedFindingUpdate({
  title: "Gross margin is 60%.",
  detail: "Net margin is 8.6%.",
  seenAt: "2026-10-11T20:00:00.000Z",
  severity: "watch",
  existingSeverity: "act",
  existingEvidence: { figures: { "Gross Margin": 0.6 }, status: "attention" },
  nextEvidence: { figures: { "Net Margin": 0.08571428571428572 }, status: "attention", metrics: [{ metric: "Net Margin", value: 0.08571428571428572, unit: "percent", period: "Oct 2026" }] },
});
const keptActEvidence = keptAct.evidence as { status: string };
assert(keptAct.severity === "act" && keptActEvidence.status === "critical", "a dedupe refresh keeps act and critical together");

const execute = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
const desk = readFileSync(resolve("supabase/functions/_shared/agent-desk.ts"), "utf8");
const draftSchema = readFileSync(resolve("src/lib/agent-draft.ts"), "utf8");
const analystPrompt = readFileSync(resolve("supabase/functions/_shared/agent-prompts/analyst.ts"), "utf8");
const backfill = readFileSync(resolve("supabase/migrations/20261012170000_agent_findings_copy_backfill.sql"), "utf8");
assert(execute.includes("shapeRecordedCopy"), "an analyst finding is shaped before it is saved");
assert(desk.includes("displayAmounts"), "the cashflow read formats amounts for the model");
assert(draftSchema.includes("1–2 complete sentences") && draftSchema.includes("≤4 short sentences, ≤600 chars"), "draft schemas name the sentence limits");
assert(analystPrompt.includes("1–2 complete sentences") && analystPrompt.includes("≤4 short sentences, ≤600 chars"), "analyst schemas name the sentence limits");
assert(backfill.includes("WHEN 'watch' THEN 'attention'") && backfill.includes("WHEN 'act' THEN 'critical'"), "the backfill maps severity onto evidence.status");
assert(backfill.includes("superseded_by IS NULL") && backfill.includes("dismissed_reason IS NULL"), "the backfill touches active findings");
assert(!/\bDELETE\b/i.test(backfill), "the backfill deletes nothing");
assert(backfill.includes("DROP FUNCTION"), "the title polisher does not stay as an API");
const statusSync = readFileSync(resolve("supabase/migrations/20261012190000_agent_findings_status_severity.sql"), "utf8");
assert(statusSync.includes("WHEN 'watch' THEN 'attention'") && statusSync.includes("WHEN 'act' THEN 'critical'"), "the status sync maps severity onto evidence.status");
assert(statusSync.includes("superseded_by IS NULL") && statusSync.includes("dismissed_reason IS NULL"), "the status sync touches active findings");
assert(statusSync.includes("2905a21a") && statusSync.includes("e37ea580") && statusSync.includes("8556e68f"), "the status sync names the mismatched rows");
assert(!/\bDELETE\b/i.test(statusSync), "the status sync deletes nothing");
assert(!statusSync.includes("SET severity"), "the status sync does not change severity");
const percentScale = readFileSync(resolve("supabase/migrations/20261012200000_agent_findings_percent_metrics.sql"), "utf8");
assert(percentScale.includes("unit") && percentScale.includes("percent") && percentScale.includes("* 100"), "the percent migration scales fraction metrics");
assert(percentScale.includes("value_raw"), "the percent migration keeps the stored fraction");
assert(percentScale.includes("superseded_by IS NULL") && percentScale.includes("dismissed_reason IS NULL"), "the percent migration touches active findings");
assert(!/\bDELETE\b/i.test(percentScale), "the percent migration deletes nothing");
assert(!percentScale.includes("SET severity"), "the percent migration does not change severity");

console.log("agent-copy: ok");
