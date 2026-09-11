/**
 * Auto-populate deliverables from an upload — first upload fills everything,
 * later uploads follow the checkboxes, every write resets accountant sign-off.
 * Run: pnpm test:auto-populate
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTO_POPULATE_TARGETS,
  buildAutoPopulateWrites,
  cashForecastFromBankDraft,
  defaultAutoPopulatePrefs,
  isFirstUpload,
  nextStoredPrefs,
  parseAutoPopulatePrefs,
  resolveAutoPopulatePlan,
  resolveBudgetDocForAutoPopulate,
  scopesResetByPlan,
  summariseAutoPopulate,
} from "../src/lib/auto-populate";
import { computeIsStale } from "../src/components/review-signoff";
import type { ClientReviewSignoff } from "../src/lib/review-signoffs.functions";
import type { CashFromBanksDraftResult } from "../src/lib/cash-from-banks.types";
import { ZA_MARKET } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// ── prefs ───────────────────────────────────────────────────────────────────
assert(AUTO_POPULATE_TARGETS.length === 3, "three deliverables");
const d = parseAutoPopulatePrefs(null);
assert(d.profitability && d.cash_forecast && d.budget && d.remember, "null prefs → all on");
const p = parseAutoPopulatePrefs({ cash_forecast: false, remember: "yes", junk: 1 });
assert(p.profitability && !p.cash_forecast && p.budget && p.remember, "partial prefs coerced");

// ── first upload detection (durable, DB-based) ──────────────────────────────
assert(isFirstUpload(null), "no row → first");
assert(isFirstUpload({}), "no stamps → first");
assert(!isFirstUpload({ financials_updated_at: "2026-01-01" }), "financials stamped → not first");
assert(!isFirstUpload({ budget_updated_at: "2026-01-01" }), "budget stamped → not first");

// ── plan ────────────────────────────────────────────────────────────────────
const off = { profitability: false, cash_forecast: false, budget: false };
const first = resolveAutoPopulatePlan({ firstUpload: true, prefs: off });
assert(first.profitability && first.cash_forecast && first.budget, "first upload ignores unchecked");
const later = resolveAutoPopulatePlan({
  firstUpload: false,
  prefs: { profitability: true, cash_forecast: false, budget: true },
});
assert(later.profitability && !later.cash_forecast && later.budget, "later upload honours boxes");

// ── sign-off scopes reset ───────────────────────────────────────────────────
const scopes = scopesResetByPlan(later);
assert(scopes.includes("financials") && scopes.includes("profitability"), "profit resets both");
assert(scopes.includes("budget") && !scopes.includes("cash_forecast"), "unchecked cash keeps sign-off");

// ── remember ────────────────────────────────────────────────────────────────
const stored = { ...defaultAutoPopulatePrefs(), cash_forecast: false };
const forgot = nextStoredPrefs(stored, { ...defaultAutoPopulatePrefs(), budget: false, remember: false });
assert(!forgot.cash_forecast && forgot.budget, "remember off → stored prefs untouched");
const kept = nextStoredPrefs(stored, { ...defaultAutoPopulatePrefs(), budget: false, remember: true });
assert(kept.cash_forecast && !kept.budget, "remember on → chosen prefs stored");

// ── writes: financial statement (no bank txns) ──────────────────────────────
const fields = { revenue: "1200000", cogs: "480000", fixedCosts: "360000", cash: "150000", periodMonths: "12" };
const now = "2026-09-11T08:00:00.000Z";
const w1 = buildAutoPopulateWrites(first, {
  fields,
  market: ZA_MARKET,
  fyStartMonth: 3,
  firstActualsMonth: "2026-06",
  now,
});
assert(w1.applied.length === 3, `statement upload fills all three: ${w1.applied.join(",")}`);
assert(w1.update.financials_updated_at === now, "profit stamp");
assert(w1.update.budget_updated_at === now, "budget stamp");
assert(w1.update.last_forecast_at === now, "cash stamp");
const budget = w1.update.budget as { version: number; gpPct: number; templateId: string };
assert(budget.version === 1 && budget.gpPct === 60, `budget seeded GP% 60 (got ${budget.gpPct})`);
assert(budget.templateId === "hybrid_primary", "no profile → hybrid kit");
const cf = w1.update.cashflow as { openingBalance: string; revenue: Array<{ amount: string }> };
assert(cf.openingBalance === "150000", "statement cash balance becomes opening balance");
assert(parseFloat(cf.revenue[0]!.amount) > 0, "cash forecast has revenue from budget");
assert(w1.scopesReset.length === 4, "all four review scopes reset");

// ── writes: nothing to seed from ────────────────────────────────────────────
const w2 = buildAutoPopulateWrites(first, { fields: {}, market: ZA_MARKET, now });
assert(w2.applied.includes("profitability"), "profit stamp still applied");
assert(w2.skipped.some((s) => s.target === "budget"), "budget skipped without figures");
assert(w2.skipped.some((s) => s.target === "cash_forecast"), "cash skipped without figures");
assert(!("budget" in w2.update) && !("cashflow" in w2.update), "no empty deliverables written");

// ── writes: bank pack uses the draft lines, replace policy ──────────────────
const draft: CashFromBanksDraftResult = {
  extract: {
    period_start: "2026-06-01",
    period_end: "2026-08-31",
    opening_balance: 50000,
    closing_balance: 82000,
    currency: "ZAR",
    transactions: [],
    notes: null,
  },
  startDate: "2026-09-01",
  openingBalance: 82000,
  warnings: [],
  lines: [
    {
      id: "a",
      side: "inflow",
      bucket: "trading",
      name: "Card settlements",
      amount: 90000,
      cadence: "weekly",
      start_week: 1,
      split_count: 3,
      status: "proposed",
      confidence: 0.9,
      source: "ai",
      txn_count: 12,
      sample_descriptions: [],
    },
    {
      id: "b",
      side: "outflow",
      bucket: "payroll",
      name: "Salaries",
      amount: 120000,
      cadence: "monthly",
      start_week: 4,
      split_count: 3,
      status: "proposed",
      confidence: 0.9,
      source: "ai",
      txn_count: 3,
      sample_descriptions: [],
    },
    {
      id: "c",
      side: "outflow",
      bucket: "transfer",
      name: "Own transfer",
      amount: 5000,
      cadence: "once_off",
      start_week: 1,
      split_count: 3,
      status: "excluded",
      confidence: 0.5,
      source: "ai",
      txn_count: 1,
      sample_descriptions: [],
    },
  ],
};
const existing = {
  revenue: [{ id: "old", name: "Old line", amount: "999", frequency: "recurring-monthly" as const, startWeek: 1, splitCount: 3 }],
  revAdj: 80,
};
const cfBank = cashForecastFromBankDraft(draft, existing);
assert(cfBank.revenue.length === 1 && cfBank.revenue[0]!.name === "Card settlements", "replace, not merge");
assert(cfBank.revenue[0]!.frequency === "recurring-weekly", "cadence mapped");
assert(cfBank.expenses.length === 1 && cfBank.expenses[0]!.name === "Salaries", "payroll → expenses");
assert(cfBank.openingBalance === "82000" && cfBank.startDate === "2026-09-01", "bank balances adopted");
assert(cfBank.revAdj === 100, "scenario knobs neutral on auto publish");

const w3 = buildAutoPopulateWrites(
  { profitability: false, cash_forecast: true, budget: false },
  { fields, cashDraft: draft, market: ZA_MARKET, now },
);
assert(w3.applied.length === 1 && w3.applied[0] === "cash_forecast", "only cash when only cash ticked");
assert(!("budget" in w3.update) && !("financials_updated_at" in w3.update), "budget/profit untouched");
assert(w3.update.cashflow_bank_draft === draft, "bank draft kept for the workspace");
assert(w3.scopesReset.length === 1 && w3.scopesReset[0] === "cash_forecast", "only cash sign-off reset");

// ── the stamps really make an existing sign-off stale ───────────────────────
const signoff: ClientReviewSignoff = {
  id: "s",
  client_id: "c",
  scope: "budget",
  signed_off_by_id: "u",
  signed_off_by_name: "Ada",
  signed_off_by_initials: "A",
  signed_off_by_title: null,
  firm_name: null,
  note: null,
  signature_data: null,
  signed_off_at: "2026-09-01T00:00:00.000Z",
};
assert(computeIsStale(signoff, w1.update.budget_updated_at as string), "auto budget → needs re-review");
assert(!computeIsStale(signoff, "2026-08-01T00:00:00.000Z"), "older data keeps sign-off");

// ── budget doc resolution keeps existing docs ───────────────────────────────
const existingDoc = resolveBudgetDocForAutoPopulate({ existingBudget: budget, market: ZA_MARKET });
assert(existingDoc.templateId === budget.templateId, "existing budget doc reused");

// ── copy ────────────────────────────────────────────────────────────────────
assert(/drafted your profitability, cash forecast and budget/.test(summariseAutoPopulate(w1, true)), "first copy");
assert(/sign-off is needed again/.test(summariseAutoPopulate(w3, false)), "later copy mentions re-sign");
assert(/Nothing else/.test(summariseAutoPopulate({ ...w2, applied: [] }, false)), "empty copy");

// ── wiring: both portals, all three upload dialogs, migration + types ───────
const drafter = read("src/components/bank-statement-drafter.tsx");
assert(drafter.includes("<AutoPopulateOptions"), "bank drafter shows options");
assert(drafter.includes("autoPopulate: autoPrefs"), "bank drafter returns chosen prefs");
const review = read("src/components/extraction-review-modal.tsx");
assert(review.includes("<AutoPopulateOptions") && review.includes("onConfirm(mapped, autoPrefs)"), "owner statement modal wired");
const upload = read("src/components/upload-financials.tsx");
assert(upload.includes("<AutoPopulateOptions") && upload.includes("onConfirm?.(result, autoPrefs)"), "accountant statement upload wired");
const owner = read("src/routes/app.tsx");
assert((owner.match(/runAutoPopulate\(/g) ?? []).length >= 2, "owner: bank + statement paths run auto-populate");
assert(!owner.includes("setShowCashFromBanks(true), 400"), "owner: no second cash dialog after bank apply");
assert(owner.includes("reloadToken={budgetReloadToken}"), "owner budget tab reloads");
const acct = read("src/routes/_authenticated/clients.$clientId.tsx");
assert((acct.match(/runAutoPopulate\(/g) ?? []).length >= 2, "accountant: bank + statement paths run auto-populate");
assert(acct.includes('role: "accountant"'), "accountant copy");
assert(acct.includes("reloadToken={budgetReloadToken}"), "accountant budget tab reloads");
const options = read("src/components/auto-populate-options.tsx");
assert(options.includes("Remember for next upload"), "remember checkbox");
assert(options.includes("sign-off again"), "options warn about re-sign");
const migration = read("supabase/migrations/20260911090000_clients_auto_update_prefs.sql");
assert(/ADD COLUMN IF NOT EXISTS auto_update_prefs JSONB/.test(migration), "migration adds prefs column");
assert(read("src/integrations/supabase/types.ts").includes("auto_update_prefs: Json | null"), "types include column");
const runner = read("src/lib/auto-populate.client.ts");
assert(/auto_update_prefs\|42703/.test(runner), "runner tolerates un-migrated column");

console.log("auto-populate: all assertions passed");
