/**
 * Ask AI context — filled deliverables, not raw statements.
 *
 * Run: pnpm test:ask-ai-context
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classify } from "../supabase/functions/ask-ai/classifier.ts";
import {
  computeRatiosFromFinancials,
  pillarBreakdownFromRatios,
  resolveRatioRecord,
} from "../supabase/functions/ask-ai/derive-ratios.ts";
import {
  buildDeliverableFills,
  extractWaterfallFigures,
  profileQuestionsFromOperating,
  rankNextSteps,
  summarizeActionPlan,
  summarizeCashForecast,
  summarizeProductLines,
  summarizeWaterfall,
} from "../supabase/functions/ask-ai/deliverable-summaries.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import type { AskAiContext, RatioRow } from "../supabase/functions/ask-ai/types.ts";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
  planActionsFromOverview,
} from "../supabase/functions/ask-ai/overview-brief.ts";
import {
  healthFromFlatFinancials,
  overviewRatios,
  scorecardHealthFromFinancials,
} from "../src/lib/health-score.ts";
import { assessClientMetrics, RUNWAY_PROFITABLE_LABEL } from "../src/lib/client-metrics.ts";
import { periodMonthsOf } from "../src/lib/ratios.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const builderSrc = readFileSync(
  resolve("supabase/functions/ask-ai/context-builder.ts"),
  "utf8",
);
const promptSrc = readFileSync(resolve("supabase/functions/ask-ai/prompt.ts"), "utf8");

assert(builderSrc.includes("operating_profile"), "loads company profile");
assert(builderSrc.includes("client_financial_snapshots"), "loads ratios");
assert(builderSrc.includes("action_plans"), "loads action plan");
assert(builderSrc.includes("action_items"), "loads action tasks");
assert(builderSrc.includes("client_review_signoffs"), "loads filled/signed deliverables");
assert(builderSrc.includes("summarizeWaterfall"), "builds waterfall output");
assert(builderSrc.includes("summarizeCashForecast"), "builds cash outlook");
assert(builderSrc.includes("summarizeProductLines"), "builds product lines");
assert(builderSrc.includes("rankNextSteps"), "builds next moves");
assert(builderSrc.includes("resolveRatioRecord"), "falls back to live financials when snapshot empty");
assert(builderSrc.includes("buildOverviewBrief"), "scores from the live Overview, not a second engine");
assert(!builderSrc.includes('.from("client_score_history")'), "does not query stale score history");
assert(!builderSrc.includes("JSON.stringify(financials)"), "does not dump raw financials JSON");
assert(promptSrc.includes("Profitability waterfall"), "prompt has waterfall section");
assert(promptSrc.includes("Score breakdown by category"), "prompt includes pillar scores");
assert(promptSrc.includes("vs peer"), "prompt labels peer bands");
assert(promptSrc.includes("Cash forecast outlook"), "prompt has cash outlook");
assert(promptSrc.includes("Product lines"), "prompt has product lines");
assert(promptSrc.includes("Top recommended next moves"), "prompt has next moves");
assert(promptSrc.includes("Planned / outstanding"), "prompt has action tasks");
assert(promptSrc.includes("Raw income-statement"), "system prompt forbids raw statements");

const questions = profileQuestionsFromOperating({
  version: 1,
  templateId: "retail_units",
  payMotion: "goods",
  volumeUnit: "units_sku",
  secondaryVolumeUnits: [],
  debtorDaysDefault: 30,
  costShape: "variable",
  seasonality: "mild",
  inventoryIntensity: "heavy",
  customerConcentration: "concentrated",
  debtPosition: "light",
  ownerGoal: "lift_margins",
  fyStartMonth: 3,
});
assert(questions.some((q) => q.label === "Owner goal" && q.value.includes("same revenue")), "profile goal");
assert(questions.some((q) => q.label === "Stock" && q.value.includes("inventory")), "profile stock");
assert(questions.every((q) => q.value), "no empty profile answers");

const weeklyFigures = extractWaterfallFigures({
  weeklyInputs: {
    weeks: {
      "2026-W35": { revenue: 100_000, costOfSales: 40_000, fixedCosts: 20_000, interest: 2_000, tax: 6_000 },
    },
  },
  revenue: 9_999_999,
  inventory: 500_000,
  receivables: 250_000,
});
assert(weeklyFigures.source === "weekly", "weekly wins over period");
assert(weeklyFigures.revenue === 100_000, "weekly revenue");
const waterfall = summarizeWaterfall(weeklyFigures);
assert(waterfall?.hasData === true, "waterfall filled");
assert(waterfall?.steps.find((s) => s.label === "Gross profit")?.pctOfRevenue === 60, "GP 60%");
assert(waterfall?.steps.find((s) => s.label === "Net income")?.pctOfRevenue === 32, "NI 32%");
assert(!JSON.stringify(waterfall).includes("100000"), "waterfall has no raw amounts");

const cash = summarizeCashForecast(
  {
    openingBalance: "80000",
    revenue: [{ amount: "20000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "50000", frequency: "recurring-weekly", startWeek: 1 }],
  },
  null,
);
assert(cash?.hasData === true, "cash filled");
assert(cash?.shortfall === true, "cash shortfall flagged");
assert(typeof cash?.runwayWeeks === "number", "runway weeks");
assert(cash?.trajectory === "down", "declining trajectory");
assert(!JSON.stringify(cash).includes("80000"), "cash summary has no raw balances");

const lines = summarizeProductLines({
  active: true,
  bestLineId: "a",
  worstLineId: "b",
  lines: [
    { id: "a", name: "Core kits", marginPct: 42, revenueSharePct: 55, gpSharePct: 70, sellPrice: 999, revenueAmount: 44000 },
    { id: "b", name: "Add-ons", marginPct: 12, revenueSharePct: 45, gpSharePct: 30 },
  ],
});
assert(lines.length === 2, "two product lines");
assert(lines[0].isBest && lines[1].isWorst, "best/worst flags");
assert(lines.every((l) => !("sellPrice" in l) && !("revenueAmount" in l)), "no product amounts");

const ratios: RatioRow[] = [
  { key: "grossMargin", value: 0.18, format: "pct", p25: 25, p50: 35, p75: 45, higher_is_better: true },
  { key: "debtorDays", value: 72, format: "days", p25: 30, p50: 45, p75: 60, higher_is_better: false },
  { key: "netMargin", value: 0.12, format: "pct", p25: 6, p50: 8, p75: 12, higher_is_better: true },
];
const next = rankNextSteps(ratios, 3);
assert(next.length >= 2, "ranked next steps");
assert(next[0].title.length > 0 && next[0].ratioName.length > 0, "next step has title");

const plan = summarizeActionPlan(
  { outcome_goal: "Free 15 cash days" },
  [
    { title: "Invoice same day", status: "in_progress", due_date: "2026-09-12", progress_pct: 40 },
    { title: "Chase 60-day debtors", status: "not_started", due_date: null, progress_pct: 0 },
    { title: "Old promo", status: "done", due_date: null, progress_pct: 100 },
  ],
);
assert(plan?.outcomeGoal === "Free 15 cash days", "plan goal");
assert(plan?.open.length === 2, "outstanding only");
assert(plan?.doneCount === 1, "completed counted separately");

const fills = buildDeliverableFills({
  hasRatios: true,
  hasScore: true,
  hasWaterfall: true,
  hasCash: true,
  hasProductLines: true,
  hasNextSteps: true,
  hasActionPlan: true,
  signedScopes: new Set(["financials", "cash_forecast"]),
});
assert(fills.find((d) => d.scope === "health")?.signedOff === true, "health signed via financials");
assert(fills.find((d) => d.scope === "cash")?.filled === true, "cash marked filled");

const derived = computeRatiosFromFinancials({
  revenue: 800_000,
  cogs: 400_000,
  netIncome: 120_000,
  ebit: 160_000,
  ebt: 140_000,
  totalAssets: 500_000,
  equity: 250_000,
  receivables: 80_000,
  inventory: 40_000,
  payables: 30_000,
});
assert(Math.abs(derived["Net Margin"] - 0.15) < 1e-9, "derive net margin from live financials");
assert(Math.abs(derived["Gross Margin"] - 0.5) < 1e-9, "derive gross margin");
assert(
  Object.keys(resolveRatioRecord(null, { revenue: 800_000, netIncome: 120_000 })).includes("Net Margin"),
  "empty snapshot still yields ratios from financials",
);
const liveOverSnapshot = resolveRatioRecord(
  { "Net Margin": 0.2, "Creditor Days": 28 },
  { revenue: 800_000, netIncome: 120_000, cogs: 400_000, payables: 30_000 },
);
assert(Math.abs(liveOverSnapshot["Net Margin"] - 0.15) < 1e-9, "live net margin wins over a stale snapshot");
assert(liveOverSnapshot["Creditor Days"] !== 28, "live creditor days win over a stale snapshot");
assert(
  Object.keys(resolveRatioRecord({ "Creditor Days": 28 }, null)).includes("Creditor Days"),
  "snapshot is the fallback only when live financials yield nothing",
);
const pillars = pillarBreakdownFromRatios(derived);
assert(pillars.some((p) => p.id === "profit" && p.score != null), "profit pillar scored");
assert(pillars.some((p) => p.id === "cash" && p.score != null), "cash pillar scored");

const ctx: AskAiContext = {
  profile: { client_id: "c1", entity_type: null, business_type: "retail", annual_revenue: 2_400_000, operating: null },
  profileQuestions: questions,
  scores: { overall_score: 86, pillars },
  ratios,
  playbook: [],
  copyPack: "za",
  waterfall,
  cashForecast: cash,
  productLines: lines,
  nextSteps: next,
  actionPlan: plan,
  deliverables: fills,
};

const { system, user } = buildPrompt("What should I focus on this month?", ctx, "full");
assert(user.includes("Company profile answers"), "prompt includes profile");
assert(user.includes("Key ratios"), "prompt includes ratios");
assert(user.includes("Score breakdown by category"), "prompt includes category scores");
assert(user.includes("Profitability:"), "prompt names profitability pillar");
assert(user.includes("Profitability waterfall"), "prompt includes waterfall");
assert(user.includes("Cash forecast outlook"), "prompt includes cash");
assert(user.includes("Product lines"), "prompt includes products");
assert(user.includes("Top recommended next moves"), "prompt includes next steps");
assert(user.includes("Invoice same day"), "prompt includes outstanding task");
assert(!user.includes("Old promo"), "completed tasks not listed as outstanding");
assert(!user.includes("999"), "no product sell price");
assert(!user.includes("44000"), "no product revenue amount");
assert(!user.includes("receivables") && !user.includes("9_999_999"), "no raw statement fields");
assert(system.includes("not provided"), "system forbids raw statements");

assert(classify("What is a gross margin?") === "none", "definitional stays none");
assert(classify("What should I focus on?") === "full", "priority stays full");
assert(classify("How is my waterfall looking?") === "full", "waterfall question is full");
assert(classify("What's on the action plan?") === "full", "action plan question is full");
assert(
  classify("What's the biggest drag on this client's score vs peers?") === "full",
  "peer-drag chip is full context",
);
assert(classify("How is performance vs peers?") === "full", "performance vs peers is full");

const nonePrompt = buildPrompt("What is a ratio?", ctx, "none");
assert(!nonePrompt.user.includes("BUSINESS CONTEXT"), "definitional questions get no client dump");

const accountantPrompt = buildPrompt("What should I focus on this month?", ctx, "full", "accountant");
assert(
  accountantPrompt.system.includes("this client"),
  "accountant audience talks about the client, not the owner as you",
);

const yankees = {
  cash: "7430.22",
  revenue: "8633.6",
  cogs: "775.98",
  ebit: "2501.12",
  ebt: "2501.12",
  netIncome: "2501.12",
  ebitda: "2501.12",
  operatingCashflow: "0",
  totalAssets: "21323.01",
  equity: "8266.73",
  payables: "8386.76",
  receivables: "9194.51",
  fixedCosts: "5356.5",
  periodMonths: "1",
};
const yankeesMetrics = assessClientMetrics({ financials: yankees });
const liveHealth = healthFromFlatFinancials(yankees, yankeesMetrics.runway.weeks, {
  country: "US",
  copyPack: "us",
});
const overview = buildOverviewBrief({
  financials: yankees,
  cash: yankeesMetrics.cash.amount,
  runwayWeeks: yankeesMetrics.runway.weeks,
  runwayLabel: yankeesMetrics.runway.label,
  copyPack: "us",
  clientName: "Fixture Co",
});
assert(
  liveHealth.overall === 71 && liveHealth.displayLabel === "Watch",
  `live overview is 71 Watch, got ${liveHealth.overall} ${liveHealth.displayLabel}`,
);
assert(overview.health === liveHealth.overall, `bot health ${overview.health} matches overview ${liveHealth.overall}`);
assert(overview.healthLabel === "Watch", "bot label matches Watch");
assert(overview.cash != null && Math.round(overview.cash) === 7430, "cash on file");
assert(overview.revenue != null && Math.round(overview.revenue) === 8634, "period revenue");
assert(yankeesMetrics.runway.kind === "cash_generative" && overview.runwayWeeks == null, "profitable cash is not 0 or 4 weeks");
assert(overview.runwayLabel === "Cash generative", "runway label");
assert(overview.creditorDays != null && Math.round(overview.creditorDays) === 329, "creditor days");
assert(overview.debtorDays != null && Math.round(overview.debtorDays) === 32, "debtor days");
assert(overview.grossMargin != null && overview.grossMargin > 0.9, "gross margin on file");
const grounded = formatOverviewForPrompt(overview, "accountant");
assert(grounded.includes("71/100 (Watch)"), "prompt quotes overview health");
assert(grounded.includes("$7,430"), "prompt quotes cash");
assert(grounded.includes("$8,634"), "prompt quotes revenue");
assert(grounded.includes("329 days"), "prompt quotes creditor days");
assert(grounded.includes("Cash generative"), "prompt quotes runway");
assert(grounded.includes("Cash runway:"), "prompt names cash runway");
assert(grounded.includes("Gross margin:"), "prompt names gross margin");
assert(grounded.includes("Total equity:"), "prompt names total equity from the Health grid");
assert(grounded.includes("Total assets:"), "prompt names total assets from the Health grid");
assert(/never ask/i.test(grounded), "prompt forbids asking for figures already on file");
assert(!/you are the/i.test(grounded), "accountant voice");
assert(!grounded.includes("86/100"), "stale score is not the overview");
const withOverview = buildPrompt("How healthy is this client?", { ...ctx, overview, scores: { overall_score: 86 } }, "full", "accountant");
assert(withOverview.user.includes("71/100 (Watch)"), "ask-ai prompt uses live health over a stale score");
assert(!withOverview.user.includes("86/100"), "stale 86 is not shown once overview is loaded");
assert(withOverview.user.includes("$7,430"), "ask-ai prompt includes cash");
const moves = planActionsFromOverview(overview);
assert(!moves.some((m) => m.sourceMoveKey === "bot:cash-runway"), "cash generative is not a zero-week action");
assert(moves.some((m) => m.sourceMoveKey === "bot:creditor-days"), "creditor days become an action");
assert(grounded.includes("healthy band 30–60 days"), "prompt quotes the shared creditor band");
assert(!grounded.includes("40-day"), "prompt does not call the creditor band 40 days");
assert(
  !planActionsFromOverview({ ...overview, creditorDays: 60 }).some((m) => m.sourceMoveKey === "bot:creditor-days"),
  "60 creditor days is inside the healthy band",
);
assert(
  planActionsFromOverview({ ...overview, creditorDays: 61 }).some((m) => m.sourceMoveKey === "bot:creditor-days"),
  "61 creditor days is outside the shared band",
);

// Live QA US file. Stored cover is 12 months (debtor 25 / creditor 37).
// A January–September year span annualises to 19 / 28. The Bot must quote 37.
const qaUs = {
  cash: "128450",
  revenue: "700000",
  cogs: "280000",
  ebit: "60000",
  netIncome: "60000",
  receivables: "48500",
  payables: "28500",
  inventory: "62000",
  periodMonths: "12",
  periodEnd: "2026-09-30",
};
const qaRatios = overviewRatios(qaUs, { fyStartMonth: 1, periodMonths: periodMonthsOf(qaUs) });
assert(qaRatios["Debtor Days"] === 25, `Ratios debtor days 25, got ${qaRatios["Debtor Days"]}`);
assert(qaRatios["Creditor Days"] === 37, `Ratios creditor days 37, got ${qaRatios["Creditor Days"]}`);
assert(Math.round(qaRatios["Gross Margin"] * 1000) === 600, "Ratios gross margin 60%");
assert(Math.round(qaRatios["Operating Margin"] * 1000) === 86, "Ratios operating margin 8.6%");
assert(Math.round(qaRatios["Net Margin"] * 1000) === 86, "Ratios net margin 8.6%");
const yearSpan = computeRatiosFromFinancials(
  { ...qaUs, periodMonths: "9" },
  { fyStartMonth: 1, periodMonths: 9 },
);
assert(yearSpan["Creditor Days"] === 28, `year-span creditor days 28, got ${yearSpan["Creditor Days"]}`);
const storedCover = computeRatiosFromFinancials(qaUs, { fyStartMonth: 1 });
assert(storedCover["Debtor Days"] === 25, `stored cover debtor days 25, got ${storedCover["Debtor Days"]}`);
assert(storedCover["Creditor Days"] === 37, `stored cover creditor days 37, got ${storedCover["Creditor Days"]}`);
const qaHealth = scorecardHealthFromFinancials({
  financials: qaUs,
  fyStartMonth: 1,
  periodMonths: periodMonthsOf(qaUs),
  market: { country: "US", copyPack: "us" },
});
const qaBrief = buildOverviewBrief({
  financials: qaUs,
  ratios: { "Creditor Days": 28, "Operating Margin": 0.099 },
  cash: 128450,
  runwayLabel: RUNWAY_PROFITABLE_LABEL,
  copyPack: "us",
  fyStartMonth: 1,
  clientName: "QA US Test LLC",
});
const qaCash = qaHealth.pillars.find((p) => p.id === "cash")?.score;
const briefCash = qaBrief.pillars.find((p) => p.id === "cash")?.score;
assert(qaBrief.debtorDays === 25 && qaBrief.creditorDays === 37, `overview days ${qaBrief.debtorDays}/${qaBrief.creditorDays}`);
assert(briefCash === qaCash, `overview cash pillar ${briefCash} matches Ratios ${qaCash}`);
assert(qaBrief.health === qaHealth.overall, `overview health ${qaBrief.health} matches Ratios ${qaHealth.overall}`);
assert(Math.round((qaBrief.operatingMargin ?? 0) * 1000) === 86, "brief operating margin is 8.6%");
assert(Math.round((qaBrief.netMargin ?? 0) * 1000) === 86, "brief net margin is 8.6%");
const qaPrompt = formatOverviewForPrompt(qaBrief, "accountant");
assert(qaPrompt.includes("Debtor days: 25 days"), qaPrompt);
assert(qaPrompt.includes("Creditor days: 37 days"), qaPrompt);
assert(!qaPrompt.includes("28 days"), qaPrompt);
assert(qaPrompt.includes("Gross margin: 60.0%"), qaPrompt);
assert(qaPrompt.includes("Operating margin: 8.6%"), qaPrompt);
assert(qaPrompt.includes("Net margin: 8.6%"), qaPrompt);
assert(qaPrompt.includes("Operating margin is EBIT divided by revenue"), qaPrompt);
assert(qaPrompt.includes("no cash-flow statement is on file"), qaPrompt);
assert(!qaPrompt.includes("add a cash-flow statement or bank balance"), qaPrompt);
assert(qaPrompt.includes("Do not say the bank balance"), qaPrompt);
assert(qaPrompt.includes("$700,000"), "overview keeps period revenue");
assert(qaPrompt.includes("$128,450"), "overview keeps cash on file");
assert(!qaPrompt.includes("44 days") && !qaPrompt.includes("73 days") && !qaPrompt.includes("43.8"), qaPrompt);
const mixed = buildPrompt(
  "What's wrong with this client?",
  {
    profile: null,
    profileQuestions: [],
    scores: null,
    ratios: [{ key: "creditorDays", value: 37, format: "days", p25: null, p50: 40, p75: null, higher_is_better: null }],
    playbook: [],
    copyPack: "us",
    waterfall: {
      source: "period",
      hasData: true,
      steps: [
        { label: "Fixed / operating costs", pctOfRevenue: 50.1 },
        { label: "EBIT", pctOfRevenue: 9.9 },
        { label: "Net income", pctOfRevenue: 9.9 },
      ],
    },
    cashForecast: null,
    productLines: [],
    nextSteps: [],
    actionPlan: null,
    deliverables: [],
    overview: qaBrief,
  },
  "full",
  "accountant",
);
assert(mixed.user.includes("Operating margin: 8.6%"), mixed.user);
assert(mixed.user.includes("Net margin: 8.6%"), mixed.user);
assert(mixed.user.includes("Creditor Days: 37 days"), mixed.user);
assert(!mixed.user.includes("EBIT: 9.9%"), mixed.user);
assert(mixed.user.includes("do not quote a reconstructed EBIT"), mixed.user);
assert(mixed.system.includes("Never say there is no bank balance"), mixed.system);
const ownerSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(
  ownerSrc.includes("withCanonicalDebtorCreditorDays") &&
    /computeOverallHealth\(\s*\{/.test(ownerSrc),
  "owner health scores the same debtor and creditor days as Ratios",
);

console.log("ask-ai-context-test: all assertions passed");
