/**
 * Firm-year pro-rata label and the ask-ai / milon-bot quotes.
 *
 * The Budget header Actuals slot inserts `fiscalStatementSlice().label`
 * and does not build a second period string. ask-ai and milon-bot use the
 * Deno twin `proratedPeriodLabel`.
 *
 * Run: pnpm test:j4-za-firm-year-label
 */
import { readFileSync } from "node:fs";
import { budgetCaptionActuals, presentBudgetOnStatementWindow } from "../src/lib/budget.bridges.ts";
import { fiscalStatementSlice } from "../src/lib/budget-period.ts";
import { createBudgetDocument } from "../src/lib/budget.months.ts";
import type { BudgetQualification } from "../src/lib/budget.types.ts";
import { formatMonthRange } from "../src/lib/market/date-presets.ts";
import { resolveMarket } from "../src/lib/market/resolve.ts";
import {
  compactMonthRange,
  isProratedPeriodLabel,
  proratedPeriodLabel,
} from "../supabase/functions/_shared/firm-year-label.ts";
import { firmYearSlice } from "../supabase/functions/_shared/firm-year-slice.ts";
import {
  extractWaterfallFigures,
  slicedWaterfallQuote,
  summarizeWaterfall,
} from "../supabase/functions/ask-ai/deliverable-summaries.ts";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
  overviewFactLines,
} from "../supabase/functions/ask-ai/overview-brief.ts";
import { shapeSnapshot } from "../supabase/functions/milon-bot/tools.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function months(start: string, count: number): string[] {
  const [y0, m0] = start.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y0!, m0! - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const SAME_SLICE = months("2026-03", 7);
const SAME_STATEMENT = months("2026-01", 9);
const CROSS_SLICE = months("2025-11", 4);
const CROSS_STATEMENT = months("2025-09", 6);
const SAME_LABEL = "Mar\u2013Sep 2026, pro-rated from your Jan\u2013Sep 2026 statement";
const CROSS_LABEL = "Nov 2025 \u2013 Feb 2026, pro-rated from your Sep 2025 \u2013 Feb 2026 statement";

assert(proratedPeriodLabel(SAME_SLICE, SAME_STATEMENT) === SAME_LABEL, proratedPeriodLabel(SAME_SLICE, SAME_STATEMENT) ?? "null");
assert(compactMonthRange(SAME_SLICE) === "Mar\u2013Sep 2026", compactMonthRange(SAME_SLICE) ?? "null");
assert(compactMonthRange(SAME_STATEMENT) === "Jan\u2013Sep 2026", compactMonthRange(SAME_STATEMENT) ?? "null");
assert(
  proratedPeriodLabel(CROSS_SLICE, CROSS_STATEMENT) === CROSS_LABEL,
  proratedPeriodLabel(CROSS_SLICE, CROSS_STATEMENT) ?? "null",
);
assert(
  compactMonthRange(CROSS_SLICE) === formatMonthRange("2025-11", "2026-02"),
  "cross-year compact range matches formatMonthRange",
);
assert(compactMonthRange(CROSS_SLICE) === "Nov 2025 \u2013 Feb 2026", compactMonthRange(CROSS_SLICE) ?? "null");
assert(proratedPeriodLabel(SAME_STATEMENT, SAME_STATEMENT) == null, "a slice that is the whole statement has no label");
assert(proratedPeriodLabel(SAME_SLICE, CROSS_STATEMENT) == null, "a slice that is not a subset has no label");
assert(proratedPeriodLabel(SAME_SLICE, months("2026-03", 7)) == null, "equal ranges have no label");
assert(isProratedPeriodLabel(SAME_LABEL), "the same-year sentence is recognised");
assert(isProratedPeriodLabel(CROSS_LABEL), "the cross-year sentence is recognised");
assert(!isProratedPeriodLabel("Mar 2026 \u2013 Sep 2026, prorated"), "the old caption is not the pro-rata label");
assert(!isProratedPeriodLabel(null), "a missing label is not pro-rata");

const ZA_FIN = {
  revenue: "412000",
  cogs: "171000",
  ebit: "52000",
  netIncome: "38200",
  periodMonths: "9",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
};
const US_YEAR = {
  ...ZA_FIN,
  grossProfit: "241000",
  periodMonths: "12",
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
};
const US_JAN = {
  ...ZA_FIN,
  grossProfit: "241000",
  periodMonths: "9",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
};

const appSlice = fiscalStatementSlice(ZA_FIN, 3);
const edgeSlice = firmYearSlice(ZA_FIN, 3);
assert(appSlice != null && edgeSlice != null, "both slices exist");
for (const key of ["revenue", "cogs", "grossProfit", "operatingProfit", "netProfit"] as const) {
  assert(appSlice[key] != null && edgeSlice[key] != null, `${key} is present`);
  assert(Math.abs(appSlice[key]! - edgeSlice[key]!) < 0.02, `${key} ${appSlice[key]} vs ${edgeSlice[key]}`);
}
assert(edgeSlice.label === SAME_LABEL, edgeSlice.label ?? "missing edge label");
assert(edgeSlice.prorated === true, "ZA January statement is clipped to March");

const ZA = resolveMarket({ country: "ZA" });
const qualification: BudgetQualification = {
  payMotion: "time_delivery",
  volumeUnit: "billable_hours",
  driverKind: "hours_rate",
  costShape: "payroll_heavy",
  debtorDaysDefault: 30,
  capexMode: "none",
  confirmedAt: "2026-03-01T00:00:00.000Z",
};
const doc = createBudgetDocument({
  templateId: "services_hours",
  qualification,
  fyStart: "2026-03",
  fyStartMonth: 3,
  ref: new Date("2026-09-15T12:00:00Z"),
  market: ZA,
});
const presented = presentBudgetOnStatementWindow(doc, ZA_FIN, ZA, false);
const header = budgetCaptionActuals(presented.caption, appSlice.prorated ? appSlice.label : null);
const actuals = header.match(/Actuals (.*?)\. Variance/)?.[1] ?? "";
assert(actuals === appSlice.label, `header Actuals ${actuals} vs slice ${appSlice.label}`);
assert(!actuals.startsWith("Jan 2026"), actuals);

const zaBrief = buildOverviewBrief({ financials: ZA_FIN, copyPack: "za", fyStartMonth: 3, clientName: "ZA" });
const zaPrompt = formatOverviewForPrompt(zaBrief, "owner");
const zaLines = overviewFactLines(zaBrief).join("\n");
const zaWaterfall = summarizeWaterfall(extractWaterfallFigures(ZA_FIN, 3));
const zaQuote = slicedWaterfallQuote(zaWaterfall, "za") ?? "";
for (const text of [zaPrompt, zaLines, zaQuote]) {
  assert(text.includes("R 187 444"), text);
  assert(text.includes("R 29 711"), text);
  assert(text.includes(SAME_LABEL), text);
}
assert(isProratedPeriodLabel(zaBrief.estimateLabel), zaBrief.estimateLabel ?? "missing estimate");
const snapshot = shapeSnapshot({
  periodLabel: "1 Jan 2026 – 30 Sep 2026",
  periodDate: "2026-09-30",
  ratios: {},
  financials: ZA_FIN,
  cashRunwayWeeks: null,
  fyStartMonth: 3,
});
assert(snapshot.period_label === SAME_LABEL, String(snapshot.period_label));
const totals = snapshot.statement_totals as { grossProfit?: number; netIncome?: number };
assert(totals.grossProfit != null && Math.abs(totals.grossProfit - (241000 * 7) / 9) < 0.02, String(totals.grossProfit));
assert(totals.netIncome != null && Math.abs(totals.netIncome - (38200 * 7) / 9) < 0.02, String(totals.netIncome));

function usStays(fin: Record<string, string>, fy: number, name: string) {
  const brief = buildOverviewBrief({ financials: fin, copyPack: "us", fyStartMonth: fy, clientName: name });
  const prompt = formatOverviewForPrompt(brief, "owner");
  assert(prompt.includes("$241,000"), prompt);
  assert(prompt.includes("$38,200"), prompt);
  assert(!prompt.includes("R "), `${name} shows a rand amount`);
  assert(!prompt.includes("pro-rated"), `${name} uses the ZA clip label`);
  assert(brief.estimateLabel == null, `${name} estimate ${brief.estimateLabel}`);
  const slice = firmYearSlice(fin, fy);
  assert(slice != null && slice.prorated === false, `${name} is not clipped`);
  assert(slice.revenue === 412000 && slice.netProfit === 38200, `${name} keeps the full statement`);
}
usStays(US_YEAR, 1, "US year");
usStays(US_JAN, 1, "US January");

const owner = readFileSync("src/routes/app.tsx", "utf8");
const accountant = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
const panel = readFileSync("src/components/budget/budget-panel.tsx", "utf8");
const bot = readFileSync("supabase/functions/milon-bot/execute.ts", "utf8");
assert(owner.includes("<BudgetPanel"), "owner budget uses BudgetPanel");
assert(accountant.includes("<BudgetPanel"), "accountant budget uses BudgetPanel");
assert(panel.includes("budgetCaptionActuals"), "both portals insert the slice label");
assert(bot.includes("brief.periodLabel"), "milon-bot health quotes the overview period");
assert(bot.includes("fyStartMonth,"), "milon-bot snapshot receives the firm year");
assert(!/^export (?!const Route\b)/m.test(owner), "owner route exports only Route");
assert(!/^export (?!const Route\b)/m.test(accountant), "accountant route exports only Route");

console.log("j4-za-firm-year-label: ok");
