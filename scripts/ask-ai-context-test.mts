/**
 * Ask AI context — filled deliverables, not raw statements.
 *
 * Run: pnpm test:ask-ai-context
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classify } from "../supabase/functions/ask-ai/classifier.ts";
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
assert(!builderSrc.includes("JSON.stringify(financials)"), "does not dump raw financials JSON");
assert(promptSrc.includes("Profitability waterfall"), "prompt has waterfall section");
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

const ctx: AskAiContext = {
  profile: { client_id: "c1", entity_type: null, business_type: "retail", annual_revenue: 2_400_000, operating: null },
  profileQuestions: questions,
  scores: { overall_score: 61 },
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

const nonePrompt = buildPrompt("What is a ratio?", ctx, "none");
assert(!nonePrompt.user.includes("BUSINESS CONTEXT"), "definitional questions get no client dump");

const accountantPrompt = buildPrompt("What should I focus on this month?", ctx, "full", "accountant");
assert(
  accountantPrompt.system.includes("this client"),
  "accountant audience talks about the client, not the owner as you",
);

console.log("ask-ai-context-test: all assertions passed");
