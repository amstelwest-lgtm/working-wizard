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
  evidenceMetrics,
  polishAgentCopy,
} from "../src/lib/agent-bus.ts";
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
assert(bad.ok === false, "Theo's fragment is refused");
if (!bad.ok) {
  assert(bad.error.includes("one or two complete sentences"), "three clipped sentences are refused");
}
const fragment = polishAgentCopy({ text: "Low R 36 154", role: "title" });
assert(fragment.ok === false && fragment.error.includes("fragment"), "a bare amount is a fragment");
const bare = polishAgentCopy({ text: "13846", role: "summary" });
assert(bare.ok === false, "a bare number is refused");

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
  assert(ask.evidence.status === "attention", "watch is attention when cash is not under the floor");
  const margin = ask.evidence.metrics?.find((metric) => metric.metric === "Gross Margin");
  const days = ask.evidence.metrics?.find((metric) => metric.metric === "Debtor Days");
  assert(margin?.value === 60 && margin.unit === "percent" && margin.period === "Sep 2026", "gross margin is stored as 60 percent");
  assert(days?.value === 44 && days.unit === "days", "debtor days are stored as whole days");
}

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
assert(costRatio?.unit === "percent" && costRatio.value === 60, "a cost ratio is a percent");

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
assert(agentCopyStatus("info", cashMetrics) === "critical", "cash under the floor is critical");
assert(agentCopyStatus("info", []) === "healthy", "info with no floor breach is healthy");
assert(agentCopyStatus("watch", []) === "attention", "watch is attention");
assert(agentCopyStatus("act", []) === "critical", "act is critical");

for (const prompt of [ANALYST_SYSTEM, FINANCIAL_MANAGER_SYSTEM, ADVISOR_SYSTEM]) {
  assert(prompt.includes(THEO_BAD), "the prompt shows Theo's bad sentences");
  assert(prompt.includes(THEO_GOOD), "the prompt shows Theo's good sentences");
  assert(prompt.includes(MARGIN_DUMP), "the prompt shows the gross-margin title");
  assert(prompt.includes("Send the September debtors age analysis."), "the prompt shows the ask");
}
assert(AGENT_COPY_GUIDE.includes("R 13 846") && AGENT_COPY_GUIDE.includes("$13,846"), "the guide names both amount formats");

const execute = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
const desk = readFileSync(resolve("supabase/functions/_shared/agent-desk.ts"), "utf8");
assert(execute.includes("shapeRecordedCopy"), "an analyst finding is shaped before it is saved");
assert(desk.includes("moneyMarketFromClient"), "a draft uses the client market");

console.log("agent-copy: ok");
