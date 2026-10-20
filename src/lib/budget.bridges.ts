/**
 * Budget bridges — seed from financials, push near-term into 13-week cash forecast.
 */

import type { BudgetActuals, BudgetDocument } from "@/lib/budget.types";
import { fyMonths } from "@/lib/budget.months";
import { computeBudgetMonths, normalizeBudgetDocument } from "@/lib/budget.compute";
import { BUDGET_TEMPLATES, newId } from "@/lib/budget.templates";
import type { CashForecastPublishPayload } from "@/lib/cash-from-banks.types";
import { periodProfitBridge } from "@/lib/period-profit";
import { assessClientMetrics, storedOpeningIsMissing } from "@/lib/client-metrics";
import {
  DAYS_REVIEW_LIMIT,
  computedDaysAp,
  computedDaysAr,
  daysNeedReview,
} from "@/lib/deliverable-input-config";
import { formatMonthRange } from "@/lib/market/date-presets";
import type { DateMarket } from "@/lib/market/format";
import { readStatementMeta } from "@/lib/statement-period";
import {
  annualiseFinancials,
  FLOW_FIELD_KEYS,
  PERIOD_MONTHS_CHOSEN_KEY,
  PERIOD_MONTHS_KEY,
  periodMonthsOf,
} from "@/lib/ratios";

function num(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Blank or missing P&L lines stay absent. They must not become a zero that forces 100% GP. */
function presentNumber(...values: Array<string | number | null | undefined>): number | null {
  for (const v of values) {
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export type SeedFromFinancialsResult = {
  doc: BudgetDocument;
  changes: string[];
};

/** Annual budget revenue above this multiple of the annualised actual is not credible. */
export const BUDGET_IMPLAUSIBLE_REVENUE_MULTIPLE = 3;

/**
 * Revenue or cost of sales above this multiple of the annualised actual
 * cannot be a growth plan. It is a bad scale (a short period treated as a
 * year, or a year multiplied again). Those plans are rebuilt.
 */
export const BUDGET_BROKEN_SCALE_MULTIPLE = 10;

/** File note written when an order-of-magnitude plan is replaced. */
export const BUDGET_REBUILT_NOTE =
  "Rebuilt from the saved statement. The stored plan was more than 10× a full year of revenue or cost of sales, so it was not kept.";

const BUDGET_REBUILT_PREFIXES = [
  "Rebuilt from the saved statement.",
  "Rebuilt from the latest actuals.",
] as const;

/** One phrase on the tab, the file note, and the PDF partner notes. */
export function presentBudgetRebuildNote(text: string): string {
  return text.replace(/^Rebuilt from the latest actuals\./, "Rebuilt from the saved statement.");
}

/** Inclusive day count of a statement span. Null when either date is missing. */
export function inclusivePeriodDays(
  start: string | number | null | undefined,
  end: string | number | null | undefined,
): number | null {
  const fromIso = String(start ?? "").slice(0, 10);
  const toIso = String(end ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return null;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / 86_400_000) + 1;
}

function scaleFlowFields<T extends Record<string, unknown>>(fin: T, scale: number): T {
  if (scale === 1) return fin;
  const out: Record<string, unknown> = { ...fin };
  for (const key of FLOW_FIELD_KEYS) {
    const raw = fin[key];
    if (raw === "" || raw == null) continue;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n)) continue;
    const scaled = Math.round(n * scale * 100) / 100;
    out[key] = typeof raw === "number" ? scaled : String(scaled);
  }
  return out as T;
}

/** Stored period length, or null when the blob does not say. */
function explicitPeriodMonths(fin: Record<string, unknown>): number | null {
  const raw = fin[PERIOD_MONTHS_KEY];
  if (raw == null || String(raw).trim() === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return Math.round(n);
}

/** True when the accountant locked "Figures cover" rather than leaving the default. */
function figuresCoverChosen(fin: Record<string, unknown>): boolean {
  return String(fin[PERIOD_MONTHS_CHOSEN_KEY] ?? "").trim() === "1";
}

/**
 * Period P&L → a year, for the budget seed.
 * A dated span shorter than a year uses 365 / inclusive days, so 1–21 Sep
 * is not treated as one month or as a finished year. With no dates,
 * `periodMonths` scales the same way the ratio layer does (missing → 12).
 *
 * A locked Figures cover wins over the dates: 12 months stays a year, and
 * a stated shorter length uses 12 / months. An unlocked length whose day
 * scale is more than {@link BUDGET_BROKEN_SCALE_MULTIPLE} times the stated
 * months is not applied — a two-day label must not turn one month into
 * ~180× a year.
 */
export function annualiseBudgetFinancials<T extends Record<string, unknown>>(fin: T): T {
  // Ratios' stored cover, including an unlocked 9 months. A dated span must
  // not leave that total looking like a 12-month year.
  const cover = periodMonthsOf(fin);
  if (cover >= 2 && cover < 12) {
    return scaleFlowFields(fin, 12 / cover);
  }

  const months = explicitPeriodMonths(fin);
  if (figuresCoverChosen(fin) && months != null) {
    if (months === 12) return fin;
    return scaleFlowFields(fin, 12 / months);
  }

  const days = inclusivePeriodDays(
    fin.periodStart as string | null | undefined,
    fin.periodEnd as string | null | undefined,
  );
  if (days != null && days > 0 && days < 360) {
    const dayScale = 365 / days;
    if (months != null && months < 12) {
      const monthScale = 12 / months;
      if (dayScale > monthScale * BUDGET_BROKEN_SCALE_MULTIPLE) {
        return scaleFlowFields(fin, monthScale);
      }
    }
    return scaleFlowFields(fin, dayScale);
  }
  return annualiseFinancials(fin);
}

function withCostAliases(
  periodFinancials: Record<string, string | number | null | undefined>,
): Record<string, string | number | null | undefined> {
  const normalised: Record<string, string | number | null | undefined> = { ...periodFinancials };
  if (presentNumber(normalised.cogs) == null && presentNumber(normalised.cost_of_sales) != null) {
    normalised.cogs = normalised.cost_of_sales;
  }
  if (
    presentNumber(normalised.fixedCosts) == null &&
    presentNumber(normalised.operating_expenses) != null
  ) {
    normalised.fixedCosts = normalised.operating_expenses;
  }
  if (presentNumber(normalised.laborCost) == null && presentNumber(normalised.labourCost) != null) {
    normalised.laborCost = normalised.labourCost;
  }
  return normalised;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Monthly overhead buckets that sum to the P&L.
 * Labour inside fixed costs is carved out. Labour at or above fixed costs
 * was reported without payroll, so it is added on top. No labour line means
 * the people share is part of fixed costs, not a second copy of them.
 */
export function splitOverheadMonthly(
  fixedCosts: number | null,
  laborCost: number | null,
): { people: number; ops: number; premises: number; sales: number } | null {
  const fixed = fixedCosts ?? 0;
  const labor = laborCost ?? 0;
  if (!(fixed > 0) && !(labor > 0)) return null;
  let people: number;
  let rest: number;
  if (labor > 0 && fixed > 0 && labor < fixed) {
    people = labor / 12;
    rest = (fixed - labor) / 12;
  } else if (labor > 0 && (fixed <= 0 || labor >= fixed)) {
    people = labor / 12;
    rest = fixed / 12;
  } else {
    people = (fixed * 0.55) / 12;
    rest = fixed / 12 - people;
  }
  const peopleR = round2(people);
  const ops = round2(rest * 0.5);
  const premises = round2(rest * 0.3);
  const target = round2(people + rest);
  const sales = round2(target - peopleR - ops - premises);
  return { people: peopleR, ops, premises, sales };
}

/** One month of a period statement, on the same annualise-then-÷12 pace as the seed. */
export function statementMonthActuals(
  periodFinancials: Record<string, unknown> | null | undefined,
  label: string,
): BudgetActuals | null {
  if (!periodFinancials) return null;
  const annual = annualiseBudgetFinancials(
    withCostAliases(periodFinancials as Record<string, string | number | null | undefined>),
  );
  const month = (value: number | null) => (value == null ? 0 : round2(value / 12));
  const actuals: BudgetActuals = {
    label,
    revenue: month(presentNumber(annual.revenue)),
    cogs: month(presentNumber(annual.cogs)),
    fixedCosts: month(presentNumber(annual.fixedCosts)),
  };
  if (!(actuals.revenue || actuals.cogs || actuals.fixedCosts)) return null;
  return actuals;
}

/** A snapshot that omitted opex must not hide the live operating expenses. */
export function mergeMonthActuals(
  primary: BudgetActuals | null,
  fallback: BudgetActuals | null,
): BudgetActuals | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    label: primary.label,
    revenue: primary.revenue || fallback.revenue,
    cogs: primary.cogs || fallback.cogs,
    fixedCosts: primary.fixedCosts || fallback.fixedCosts,
  };
}

export type BudgetActualsChip =
  | "From this month's actuals"
  | "Estimated from statement pace"
  | "None";

/** One actuals chip. Statement pace is not "None". */
export function budgetActualsBadge(importedMonths: number, statementPace: boolean): BudgetActualsChip {
  if (importedMonths > 0) return "From this month's actuals";
  if (statementPace) return "Estimated from statement pace";
  return "None";
}

/** "None" is the absence of a source, not a chip. */
export function showBudgetSourceChip(chip: BudgetActualsChip | null | undefined): boolean {
  return chip != null && chip !== "None";
}

function budgetYearTotals(doc: BudgetDocument): { revenue: number; cogs: number } {
  const rows = computeBudgetMonths(doc, doc.activeScenario);
  return {
    revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    cogs: rows.reduce((sum, row) => sum + row.cogs, 0),
  };
}

function annualisedActuals(periodFinancials: Record<string, string | number | null | undefined>): {
  revenue: number | null;
  cogs: number | null;
} {
  const annual = annualiseBudgetFinancials(withCostAliases(periodFinancials));
  return {
    revenue: presentNumber(annual.revenue),
    cogs: presentNumber(annual.cogs),
  };
}

function exceedsMultiple(budget: number, actual: number | null, multiple: number): boolean {
  return actual != null && actual > 0 && budget > actual * multiple + 1;
}

/**
 * A stored budget that cannot be the same business as the latest actuals.
 * COGS of 0 while the period has cost of sales, or a year of revenue or
 * cost of sales more than about 3× the annualised actual. Callers prompt.
 * An order-of-magnitude gap is rebuilt by {@link reseedBudgetIfScaleBroken}.
 */
function amountsNearBlank(amounts: readonly unknown[]): boolean {
  return amounts.every((amount) => amount == null || Math.abs(Number(amount)) < 0.5);
}

/**
 * Blank overheads, or a people line that is still labour ÷ 12.
 * A typed rent or a people amount that is not that seed is a real edit.
 */
function overheadSeedOnly(doc: BudgetDocument, annualLabor: number | null): boolean {
  const laborMonth = annualLabor != null && annualLabor > 0 ? annualLabor / 12 : null;
  return doc.overheads.every((line) => {
    const amounts = Object.values(line.months);
    if (line.bucket !== "people") return amountsNearBlank(amounts);
    if (amountsNearBlank(amounts)) return true;
    if (laborMonth == null) return false;
    return amounts.every((amount) => {
      const n = Number(amount) || 0;
      return Math.abs(n) < 0.5 || Math.abs(n - laborMonth) < 1;
    });
  });
}

/**
 * Display copy of an untouched template. Gross margin and operating expenses
 * come from the statement bridge. Rent is not invented when the statement
 * has no premises line. `updatedAt` is left alone so a load cannot stamp a rewrite.
 */
export function statementBudgetRead(
  doc: BudgetDocument,
  periodFinancials: Record<string, unknown> | null | undefined,
): { doc: BudgetDocument; fromStatement: boolean } {
  if (!periodFinancials) return { doc, fromStatement: false };
  const template = BUDGET_TEMPLATES[doc.templateId];
  if (!template) return { doc, fromStatement: false };
  if (Math.abs(doc.gpPct - template.defaultGpPct) > 0.05) return { doc, fromStatement: false };
  const labor = presentNumber(
    periodFinancials.laborCost as string | number | null | undefined,
    periodFinancials.labourCost as string | number | null | undefined,
  );
  if (!overheadSeedOnly(doc, labor)) return { doc, fromStatement: false };
  const bridge = periodProfitBridge(periodFinancials);
  if (!(bridge.revenue > 0)) return { doc, fromStatement: false };
  const gpPct = Math.round((bridge.grossProfit / bridge.revenue) * 1000) / 10;
  const annualOpex = bridge.operatingExpenses + bridge.depreciation;
  const monthlyOpex = annualOpex / 12;
  let people = 0;
  let ops = monthlyOpex;
  if (labor != null && labor > 0 && annualOpex > labor) {
    people = labor / 12;
    ops = monthlyOpex - people;
  }
  const months = fyMonths(doc.fyStart);
  const bucketAmount = (bucket: string): number | null => {
    if (bucket === "people") return round2(people);
    if (bucket === "ops") return round2(ops);
    return null;
  };
  const monthlyRevenue = round2(bridge.revenue / 12);
  return {
    fromStatement: true,
    doc: {
      ...doc,
      gpPct,
      cogsMode: "gp_pct",
      revenueLines: doc.revenueLines.map((line, index) => {
        if (index !== 0) return line;
        const keys = Object.keys(line.months);
        const targets = keys.length > 0 ? keys : months;
        return {
          ...line,
          months: Object.fromEntries(targets.map((month) => [month, { volume: 1, price: monthlyRevenue }])),
        };
      }),
      overheads: doc.overheads.map((line) => {
        const amount = bucketAmount(line.bucket);
        if (amount == null) return line;
        const keys = Object.keys(line.months);
        const targets = keys.length > 0 ? keys : months;
        return { ...line, months: Object.fromEntries(targets.map((month) => [month, amount])) };
      }),
    },
  };
}

export function budgetIsImplausible(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined> | null | undefined,
): boolean {
  if (!periodFinancials) return false;
  const actual = annualisedActuals(periodFinancials);
  const budget = budgetYearTotals(doc);
  // An empty plan is "not built", not a variance against a zero budget.
  if (budget.revenue < 1 && budget.cogs < 1) return false;
  if (actual.cogs != null && actual.cogs > 0 && budget.cogs <= 0.5) return true;
  if (exceedsMultiple(budget.revenue, actual.revenue, BUDGET_IMPLAUSIBLE_REVENUE_MULTIPLE))
    return true;
  if (exceedsMultiple(budget.cogs, actual.cogs, BUDGET_IMPLAUSIBLE_REVENUE_MULTIPLE)) return true;
  return false;
}

export type BudgetScaleBreak = "revenue" | "cogs";

/**
 * Revenue or cost of sales more than 10× the annualised actual.
 * That ratio is a broken scale, not a plan someone meant to keep.
 */
export function budgetScaleBreak(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined> | null | undefined,
): BudgetScaleBreak | null {
  if (!periodFinancials) return null;
  const actual = annualisedActuals(periodFinancials);
  const budget = budgetYearTotals(doc);
  if (exceedsMultiple(budget.revenue, actual.revenue, BUDGET_BROKEN_SCALE_MULTIPLE))
    return "revenue";
  if (exceedsMultiple(budget.cogs, actual.cogs, BUDGET_BROKEN_SCALE_MULTIPLE)) return "cogs";
  return null;
}

export function budgetWasRebuiltFromActuals(doc: BudgetDocument): boolean {
  return (doc.notes ?? []).some((note) =>
    BUDGET_REBUILT_PREFIXES.some((prefix) => (note.text ?? "").startsWith(prefix)),
  );
}

/**
 * Replace a stored plan whose revenue or cost of sales is more than 10× the
 * annualised actual. The replacement is the same seed a new budget would
 * get, plus a file note. A second call is a no-op. If the seed would still
 * be an order of magnitude off, the stored plan is left for the rebuild prompt.
 */
export function reseedBudgetIfScaleBroken(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined> | null | undefined,
): BudgetDocument {
  const normalized = normalizeBudgetDocument(doc);
  if (!periodFinancials || !budgetScaleBreak(normalized, periodFinancials)) return normalized;
  const seeded = seedBudgetFromFinancials(normalized, periodFinancials);
  if (budgetScaleBreak(seeded.doc, periodFinancials)) return normalized;
  if (budgetWasRebuiltFromActuals(seeded.doc)) {
    return normalizeBudgetDocument(seeded.doc);
  }
  return normalizeBudgetDocument({
    ...seeded.doc,
    notes: [
      ...(seeded.doc.notes ?? []),
      {
        id: newId("note"),
        at: new Date().toISOString(),
        by: "Milōn",
        kind: "note" as const,
        text: BUDGET_REBUILT_NOTE,
      },
    ],
  });
}

/** Apply period financials into budget assumptions (does not invent volume history). */
export function seedBudgetFromFinancials(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined>,
): SeedFromFinancialsResult {
  const changes: string[] = [];
  const months = fyMonths(doc.fyStart);
  // A short period must seed a full year at the period's pace, not at a year's pace.
  const financials = annualiseBudgetFinancials(withCostAliases(periodFinancials));
  const revenue = presentNumber(financials.revenue);
  const cogs = presentNumber(financials.cogs);
  const bridge = periodProfitBridge(financials);
  const fixedCosts = bridge.operatingExpenses;
  const laborCost = presentNumber(financials.laborCost);
  const receivables = num(financials.receivables);
  const payables = num(financials.payables);
  const inventory = num(financials.inventory);

  let next: BudgetDocument = {
    ...doc,
    updatedAt: new Date().toISOString(),
    statementDepreciation: bridge.depreciation,
  };

  if (revenue != null && revenue > 0 && cogs != null && cogs >= 0) {
    const gp = ((revenue - cogs) / revenue) * 100;
    // One pair drives both the GP% field and the month engine. Leaving
    // cogsMode on per-unit kept a typed GP% while months still booked COGS at 0.
    next = { ...next, gpPct: Math.round(gp * 10) / 10, cogsMode: "gp_pct", cogsPerUnit: {} };
    changes.push(`GP% set to ${next.gpPct} from period revenue/COGS`);
  }

  if (revenue != null && revenue > 0 && next.revenueLines[0]) {
    const monthly = Math.round((revenue / 12) * 100) / 100;
    const line = next.revenueLines[0];
    const monthsMap = { ...line.months };
    for (const mo of months) {
      // Keep volume/price separate: volume=1, price=monthly revenue equiv.
      monthsMap[mo] = { volume: 1, price: monthly };
    }
    next = {
      ...next,
      revenueLines: next.revenueLines.map((l, i) =>
        i === 0 ? { ...l, name: l.name || "Primary revenue", months: monthsMap } : l,
      ),
    };
    changes.push(`Primary revenue line seeded at ~${monthly}/month (volume 1 × price)`);
  }

  const overheadSplit = splitOverheadMonthly(fixedCosts, laborCost);
  if (overheadSplit) {
    next = {
      ...next,
      overheads: next.overheads.map((oh) => {
        const monthly =
          oh.bucket === "people"
            ? overheadSplit.people
            : oh.bucket === "ops"
              ? overheadSplit.ops
              : oh.bucket === "premises"
                ? overheadSplit.premises
                : oh.bucket === "sales"
                  ? overheadSplit.sales
                  : 0;
        if (monthly <= 0) return oh;
        return {
          ...oh,
          months: Object.fromEntries(months.map((m) => [m, monthly])),
        };
      }),
    };
    changes.push(
      bridge.depreciation > 0
        ? "Overheads seeded from operating expenses; depreciation seeded from EBITDA − EBIT"
        : "Overheads seeded from fixed/labour costs across the FY",
    );
  }

  const wc = { ...next.wc };
  if (revenue != null && revenue > 0 && receivables > 0) {
    wc.debtorDays = Math.round((receivables / revenue) * 365);
    changes.push(`Debtor days ≈ ${wc.debtorDays} from receivables/revenue`);
  }
  if (cogs != null && cogs > 0 && payables > 0) {
    wc.creditorDays = Math.round((payables / cogs) * 365);
    changes.push(`Creditor days ≈ ${wc.creditorDays} from payables/COGS`);
  }
  if (next.showInventoryDays && cogs != null && cogs > 0 && inventory > 0) {
    wc.inventoryDays = Math.round((inventory / cogs) * 365);
    changes.push(`Inventory days ≈ ${wc.inventoryDays}`);
  }
  next = { ...next, wc };

  const cash = presentNumber(financials.cash);
  if (cash != null && cash > 0 && !(next.openingCash > 0)) {
    next = { ...next, openingCash: cash };
    changes.push(`Opening cash set to ${cash} from the statement`);
  } else {
    const ocf = num(financials.operatingCashflow);
    if (ocf !== 0 && !(next.openingCash > 0)) {
      // Soft hint only when opening cash empty — OCF is not a bank balance
      changes.push("Opening cash left unchanged (set manually from bank balance)");
    }
  }

  return { doc: next, changes };
}

function lineId(prefix: string): string {
  return newId(prefix);
}

/**
 * Monday of the UTC week containing `now`.
 * Budget cash starts on that day. The FY month (`fyStart`) is not a cash date:
 * statement cash parked on 1 Sep and then rolled with budget P&L invents a balance.
 */
export function budgetForecastStartDate(now = new Date()): string {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mondayOffset = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - mondayOffset);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Build a cash-forecast publish payload from the first ~13 weeks of the budget
 * (months 1–3 recurring monthly lines + WC-derived collection delay).
 * `openingBalance` stays the statement / opening cash. Week 1 is this week,
 * not the first day of the financial year. This is not a bank publish.
 */
export function budgetToCashForecastPayload(
  doc: BudgetDocument,
  now = new Date(),
): CashForecastPublishPayload {
  const months = fyMonths(doc.fyStart);
  const near = months.slice(0, 3);
  const rows = computeBudgetMonths(doc, doc.activeScenario);
  const nearRows = rows.filter((r) => near.includes(r.month));
  const avg = (pick: (r: (typeof rows)[0]) => number) => {
    if (!nearRows.length) return 0;
    return Math.round((nearRows.reduce((s, r) => s + pick(r), 0) / nearRows.length) * 100) / 100;
  };

  const revenue = doc.revenueLines.map((l) => {
    const amounts = near.map((mo) => {
      const cell = l.months[mo] ?? { volume: 0, price: 0 };
      const f = doc.scenarios[doc.activeScenario];
      return (cell.volume || 0) * f.volumeFactor * (cell.price || 0) * f.priceFactor;
    });
    const mean = amounts.length
      ? Math.round((amounts.reduce((a, b) => a + b, 0) / amounts.length) * 100) / 100
      : 0;
    return {
      id: lineId("rev"),
      name: `${l.name} (from budget)`,
      amount: String(mean),
      frequency: "recurring-monthly" as const,
      startWeek: 1,
      splitCount: 3,
    };
  });

  const cogsAvg = avg((r) => r.cogs);
  const expenses = [
    {
      id: lineId("exp"),
      name: "COGS (from budget)",
      amount: String(cogsAvg),
      frequency: "recurring-monthly" as const,
      startWeek: 1,
      splitCount: 3,
    },
    ...doc.overheads
      .map((oh) => {
        const amounts = near.map(
          (mo) => (oh.months[mo] || 0) * doc.scenarios[doc.activeScenario].overheadFactor,
        );
        const mean = amounts.length
          ? Math.round((amounts.reduce((a, b) => a + b, 0) / amounts.length) * 100) / 100
          : 0;
        return {
          id: lineId("exp"),
          name: `${oh.name} (from budget)`,
          amount: String(mean),
          frequency: "recurring-monthly" as const,
          startWeek: 1,
          splitCount: 3,
        };
      })
      .filter((l) => parseFloat(l.amount) > 0),
  ];

  const startDate = budgetForecastStartDate(now);
  // Debtor days already lag budget cash. They must not turn a forecast
  // scenario on — collection delay stays off until someone moves the slider.
  const collectDelay = 0;

  return {
    startDate,
    openingBalance: String(doc.openingCash || 0),
    revenue: revenue.length
      ? revenue
      : [
          {
            id: lineId("rev"),
            name: "Revenue (from budget)",
            amount: String(avg((r) => r.revenue)),
            frequency: "recurring-monthly",
            startWeek: 1,
            splitCount: 3,
          },
        ],
    expenses,
    other: [
      {
        id: lineId("oth"),
        name: "Other",
        amount: "0",
        frequency: "recurring-monthly",
        startWeek: 1,
        splitCount: 3,
      },
    ],
    revAdj: 100,
    expAdj: 100,
    collectDelay,
    headcountDelta: 0,
    avgSalary: "0",
    fixedCostDelta: "0",
    revGrowthPct: 0,
    capexAmount: "0",
    capexWeek: 1,
  };
}

/**
 * A budget the funnel wrote and nobody edited. A note, or a real confirm
 * time, means leave the months alone and keep the rebuild prompt.
 */
export function budgetSeedIsUntouched(doc: BudgetDocument): boolean {
  if ((doc.notes ?? []).some((note) => note.text?.trim())) return false;
  return (doc.qualification?.confirmedAt ?? "").startsWith("1970-01-01");
}

/**
 * Opening cash and overhead buckets for an untouched seed. New budgets
 * already get this from seedBudgetFromFinancials; a stored seed was left
 * at opening 0 and the old double-counted overheads.
 */
export function repairUntouchedSeededBudget(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined> | null | undefined,
): BudgetDocument {
  const normalized = normalizeBudgetDocument(doc);
  if (!periodFinancials || !budgetSeedIsUntouched(normalized)) return normalized;
  return normalizeBudgetDocument(seedBudgetFromFinancials(normalized, periodFinancials).doc);
}

export type BudgetOpeningSource = "bank" | "statement" | "manual";

/** Same sentence as the 13-week forecast when the stored opening is blank. */
export const BUDGET_OPENING_MISSING_LINE = "Opening balance missing · add it";

/**
 * Budget opening of 0 is the forecast's missing opening, unless someone typed it.
 * A manual zero stays a zero. A sourced or non-zero opening stays money.
 */
export function budgetOpeningReadsMissing(input: {
  cashflow: unknown;
  openingCash: number | null | undefined;
  openingCashSource?: string | null;
}): boolean {
  if (input.openingCashSource === "manual") return false;
  const opening = input.openingCash ?? 0;
  if (!Number.isFinite(opening) || Math.abs(opening) >= 0.5) return false;
  return storedOpeningIsMissing(input.cashflow);
}

export function budgetOpeningSourceLabel(
  source: BudgetOpeningSource | null | undefined,
): string | null {
  if (source === "bank") return "Bank";
  if (source === "statement") return "Statement";
  if (source === "manual") return "Manual";
  return null;
}

/** Days past this need a review flag. The budget, Ratios, and Cash share the figure. */
export const BUDGET_DAYS_REVIEW = DAYS_REVIEW_LIMIT;

export function budgetDaysNeedReview(days: number | null | undefined): boolean {
  return daysNeedReview(days);
}

export function budgetDaysSourceLabel(
  source: "ratios" | "manual" | null | undefined,
): "Ratios" | "Manual" {
  return source === "manual" ? "Manual" : "Ratios";
}

/**
 * Opening cash for this client's own bank or statement.
 * A manual entry is kept. Anything else — including another client's
 * balance still sitting on the document — is replaced from this client's
 * cash figure (`assessClientMetrics` / `resolveClientCash`).
 */
export function alignBudgetOpeningCash(
  doc: BudgetDocument,
  input: {
    financials?: Record<string, unknown> | null;
    cashflow?: unknown;
    financialsUpdatedAt?: string | null;
  },
): BudgetDocument {
  if (doc.openingCashSource === "manual") return doc;
  const cash = assessClientMetrics({
    financials: input.financials ?? null,
    cashflow: input.cashflow,
    financialsUpdatedAt: input.financialsUpdatedAt ?? null,
  }).cash;
  if (cash.amount == null || !(cash.amount > 0)) return doc;
  const source: BudgetOpeningSource = cash.source === "bank" ? "bank" : "statement";
  if (doc.openingCash === cash.amount && doc.openingCashSource === source) return doc;
  return { ...doc, openingCash: cash.amount, openingCashSource: source };
}

/** Debtor and creditor days follow Ratios unless the accountant typed them. */
export function alignBudgetWorkingCapital(
  doc: BudgetDocument,
  periodFinancials: Record<string, unknown> | null | undefined,
): BudgetDocument {
  if (!periodFinancials || doc.wcDaysSource === "manual") return doc;
  const debtorDays = computedDaysAr(periodFinancials);
  const creditorDays = computedDaysAp(periodFinancials);
  if (debtorDays == null && creditorDays == null) return doc;
  const nextDebtor = debtorDays ?? doc.wc.debtorDays;
  const nextCreditor = creditorDays ?? doc.wc.creditorDays;
  if (
    doc.wcDaysSource === "ratios" &&
    doc.wc.debtorDays === nextDebtor &&
    doc.wc.creditorDays === nextCreditor
  ) {
    return doc;
  }
  return {
    ...doc,
    wcDaysSource: "ratios",
    wc: { ...doc.wc, debtorDays: nextDebtor, creditorDays: nextCreditor },
  };
}

/**
 * The budget the tab, the PDF, and Reports all read.
 * An order-of-magnitude plan is left as a suggestion (`budgetScaleBreak`).
 * It is not replaced here. Untouched seeds still pick up statement
 * depreciation. Opening cash and working-capital days are this client's.
 */
export function publishBudgetDocument(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined> | null | undefined,
  cash?: { cashflow?: unknown; financialsUpdatedAt?: string | null },
): BudgetDocument {
  const normalized = normalizeBudgetDocument(doc);
  const scaleBroken = budgetScaleBreak(normalized, periodFinancials) != null;
  const repaired =
    scaleBroken || !periodFinancials
      ? normalized
      : repairUntouchedSeededBudget(normalized, periodFinancials);
  const withDays = alignBudgetWorkingCapital(repaired, periodFinancials ?? null);
  return alignBudgetOpeningCash(withDays, {
    financials: periodFinancials ?? null,
    cashflow: cash?.cashflow,
    financialsUpdatedAt: cash?.financialsUpdatedAt ?? null,
  });
}

export function stablePlanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stablePlanValue);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = stablePlanValue(src[key]);
    return out;
  }
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  return value;
}

/** Plan figures the Budget & Variance page shows. Order, clocks, and source labels are not figures. */
export function budgetPlanSnapshot(doc: BudgetDocument): unknown {
  return {
    fyStart: doc.fyStart,
    fyStartMonth: doc.fyStartMonth,
    activeScenario: doc.activeScenario,
    openingCash: doc.openingCash,
    gpPct: doc.gpPct,
    cogsMode: doc.cogsMode,
    cogsPerUnit: doc.cogsPerUnit ?? {},
    statementDepreciation: doc.statementDepreciation ?? 0,
    wc: {
      debtorDays: doc.wc?.debtorDays ?? 0,
      creditorDays: doc.wc?.creditorDays ?? 0,
      inventoryDays: doc.wc?.inventoryDays ?? 0,
    },
    revenueLines: (doc.revenueLines ?? []).map((line) => ({ name: line.name, months: line.months })),
    overheads: (doc.overheads ?? []).map((line) => ({ name: line.name, months: line.months })),
    capex: (doc.capex ?? []).map((line) => ({ amount: line.amount, month: line.month })),
  };
}

export function budgetPlanFiguresChanged(before: BudgetDocument, after: BudgetDocument): boolean {
  return (
    JSON.stringify(stablePlanValue(budgetPlanSnapshot(before))) !==
    JSON.stringify(stablePlanValue(budgetPlanSnapshot(after)))
  );
}

/**
 * True when a signed budget snapshot and the plan now on file differ.
 * A missing snapshot is not a change — the clock alone cannot say the figures moved.
 */
export function budgetSignedFiguresChanged(
  signedSnapshot: unknown,
  doc: BudgetDocument | null | undefined,
): boolean {
  if (!doc || !signedSnapshot || typeof signedSnapshot !== "object") return false;
  const figures = (signedSnapshot as { budgetFigures?: unknown }).budgetFigures;
  if (figures == null || typeof figures !== "object") return false;
  return (
    JSON.stringify(stablePlanValue(figures)) !==
    JSON.stringify(stablePlanValue(budgetPlanSnapshot(doc)))
  );
}

/** Inclusive YYYY-MM keys from a statement start through its end. */
export function statementMonthKeys(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
): string[] | null {
  if (!periodStart || !periodEnd) return null;
  const start = periodStart.slice(0, 7);
  const end = periodEnd.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end) || start > end) return null;
  const out: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  for (let guard = 0; guard < 36; guard++) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    if (year === endYear && month === endMonth) return out;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

/** Every revenue cell and every overhead is the same amount in every month. */
export function budgetMonthsAreUniform(doc: BudgetDocument): boolean {
  const months = fyMonths(doc.fyStart);
  const first = months[0];
  if (!first) return false;
  for (const line of doc.revenueLines) {
    const seed = line.months[first] ?? { volume: 0, price: 0 };
    for (const month of months) {
      const cell = line.months[month] ?? { volume: 0, price: 0 };
      if (cell.volume !== seed.volume || cell.price !== seed.price) return false;
    }
  }
  for (const line of doc.overheads) {
    const seed = line.months[first] ?? 0;
    for (const month of months) {
      if ((line.months[month] ?? 0) !== seed) return false;
    }
  }
  return true;
}

function shiftUniformBudget(doc: BudgetDocument, targetStart: string): BudgetDocument {
  const oldMonths = fyMonths(doc.fyStart);
  const nextMonths = fyMonths(targetStart);
  const source = oldMonths[0];
  const startMonth = Number(targetStart.slice(5, 7));
  return {
    ...doc,
    fyStart: targetStart,
    fyStartMonth: startMonth >= 1 && startMonth <= 12 ? startMonth : doc.fyStartMonth,
    revenueLines: doc.revenueLines.map((line) => {
      const cell = (source ? line.months[source] : null) ?? { volume: 0, price: 0 };
      return {
        ...line,
        months: Object.fromEntries(
          nextMonths.map((month) => [month, { volume: cell.volume, price: cell.price }]),
        ),
      };
    }),
    overheads: doc.overheads.map((line) => {
      const amount = source ? (line.months[source] ?? 0) : 0;
      return {
        ...line,
        months: Object.fromEntries(nextMonths.map((month) => [month, amount])),
      };
    }),
    capex: (doc.capex ?? []).map((line) => {
      const index = oldMonths.indexOf(line.month);
      const month = index >= 0 ? nextMonths[index] : undefined;
      return month ? { ...line, month } : line;
    }),
  };
}

function uniformMatchesStatement(
  doc: BudgetDocument,
  financials: Record<string, unknown> | null | undefined,
): boolean {
  if (!financials) return false;
  const bridge = periodProfitBridge(
    withCostAliases(financials as Record<string, string | number | null | undefined>),
  );
  if (!(bridge.revenue > 0)) return false;
  const month = fyMonths(doc.fyStart)[0];
  if (!month) return false;
  let revenue = 0;
  for (const line of doc.revenueLines) {
    const cell = line.months[month] ?? { volume: 0, price: 0 };
    revenue += (cell.volume || 0) * (cell.price || 0);
  }
  const cover = Math.max(1, periodMonthsOf(financials));
  const annualPace = bridge.revenue * (12 / cover);
  return Math.abs(revenue * 12 - annualPace) <= Math.max(1, annualPace * 0.02);
}

function windowRangeLabel(months: readonly string[]): string {
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return "the statement";
  return formatMonthRange(first, last) ?? first;
}

export type BudgetUniformKind = "statement-seed" | "copy-forward";

export type BudgetPresentation = {
  doc: BudgetDocument;
  /** A flat year was placed on the statement's 12-month window. */
  moved: boolean;
  uniform: BudgetUniformKind | null;
  /** Period line for the chart. Full years, and both windows when they differ. */
  caption: string;
};

export function budgetUniformNote(kind: BudgetUniformKind | null): string | null {
  if (kind === "statement-seed") return "Same figure each month. Seeded from the statement.";
  if (kind === "copy-forward") return "Same figure each month. Copied forward.";
  return null;
}

/**
 * A flat Jan–Dec seed against an Oct–Sep set of books is the same figure
 * pasted onto the wrong year. Move that paste onto the statement window.
 * A year whose months differ stays put; the caption names both periods.
 */
export function presentBudgetOnStatementWindow(
  doc: BudgetDocument,
  financials: Record<string, unknown> | null | undefined,
  market: DateMarket,
  fromStatement = false,
): BudgetPresentation {
  const meta = financials ? readStatementMeta(financials, market) : null;
  const statementMonths = meta ? statementMonthKeys(meta.periodStart, meta.periodEnd) : null;
  const uniform = budgetMonthsAreUniform(doc);
  const storedMonths = fyMonths(doc.fyStart);
  let next = doc;
  let moved = false;
  if (
    uniform &&
    statementMonths &&
    statementMonths.length === 12 &&
    statementMonths[0] !== doc.fyStart
  ) {
    next = shiftUniformBudget(doc, statementMonths[0]!);
    moved = true;
  }
  const shown = fyMonths(next.fyStart);
  const overlap = statementMonths ? statementMonths.filter((month) => shown.includes(month)) : shown;
  const windowsMatch =
    !statementMonths ||
    (statementMonths.length === shown.length &&
      statementMonths.every((month, index) => month === shown[index]));
  const caption = windowsMatch
    ? windowRangeLabel(shown)
    : `Budget ${windowRangeLabel(storedMonths)}. Actuals ${windowRangeLabel(statementMonths ?? [])}. Variance compares ${
        overlap.length ? windowRangeLabel(overlap) : "no shared months"
      }.`;
  const kind: BudgetUniformKind | null = uniform
    ? fromStatement || uniformMatchesStatement(doc, financials)
      ? "statement-seed"
      : "copy-forward"
    : null;
  return { doc: next, moved, uniform: kind, caption };
}

/** The plan was copied from the statement it is being scored against. */
export const SEEDED_VARIANCE_NOTE =
  "Plan seeded from these actuals, so variance starts once new actuals arrive";

/** A missing figures cover is not a silent year. */
export const STATEMENT_PERIOD_UNKNOWN_NOTE =
  "Statement period is not on file, so these actuals are not scored against the budget.";

/** The dates are real, and none of them sit in this budget year. */
export const STATEMENT_PERIOD_OUTSIDE_NOTE =
  "The statement period does not fall in this budget year, so it is not scored against the plan.";

export type StatementPeriodBasis =
  | { kind: "dated"; keys: string[]; dayFraction: number | null }
  | { kind: "stored"; months: number }
  | { kind: "unknown" };

/**
 * How long the statement is, for a budget comparison.
 * A stored `periodMonths` is that cover, including 12. Dates are used only
 * when they describe the same length, or when no length is stored.
 * A dated year that only overlaps part of the plan stays that overlap.
 * No length and no dates are unknown — not 12 months.
 */
export function statementPeriodBasis(
  fin: Record<string, unknown> | null | undefined,
): StatementPeriodBasis {
  if (!fin) return { kind: "unknown" };
  const explicit = explicitPeriodMonths(fin);
  const start = typeof fin.periodStart === "string" ? fin.periodStart : null;
  const end = typeof fin.periodEnd === "string" ? fin.periodEnd : null;
  const dated = statementMonthKeys(start, end);
  const days = inclusivePeriodDays(start, end);
  const datesAgree =
    dated != null && dated.length > 0 && (explicit == null || explicit === dated.length);
  if (datesAgree && dated) {
    const partMonth =
      days != null && days < 28 && dated.length <= 1 && (explicit == null || explicit <= 1);
    return {
      kind: "dated",
      keys: dated,
      dayFraction: partMonth ? days / 30 : null,
    };
  }
  if (explicit != null) return { kind: "stored", months: explicit };
  return { kind: "unknown" };
}

/** Months of this plan the statement is scored against. Null when the period is unknown. */
export function varianceWindowKeys(
  basis: StatementPeriodBasis,
  fy: readonly string[],
  endMonth: string,
): { keys: string[]; dayFraction: number | null } | null {
  if (basis.kind === "unknown") return null;
  if (basis.kind === "stored") {
    const keys = coverMonths([...fy], endMonth, basis.months);
    return keys.length > 0 ? { keys, dayFraction: null } : null;
  }
  const keys = basis.keys.filter((month) => fy.includes(month));
  return { keys, dayFraction: basis.dayFraction };
}

export function statementSeedAmountsMatch(
  actualRevenue: number,
  budgetRevenue: number,
  actualEbit: number,
  budgetEbit: number,
): boolean {
  if (Math.abs(actualRevenue - budgetRevenue) >= 1) return false;
  const ebitGap = Math.abs(actualEbit - budgetEbit);
  const rounding = Math.max(1, Math.abs(actualRevenue) * 0.002);
  return ebitGap <= rounding;
}

/** "Jan 2026 – Sep 2026" for the months a statement comparison actually covers. */
export function budgetCoverWindowLabel(months: string[]): string {
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return "Statement";
  return formatMonthRange(first, last) ?? "Statement";
}

/** A statement comparison that is the seed itself is not a performance verdict. */
export function budgetSeededFromStatement(
  actuals: {
    chip?: string | null;
    revenue: number;
    budgetRevenue?: number;
    ebit?: number;
    budgetEbit?: number;
    seededFromActuals?: boolean;
  } | null | undefined,
): boolean {
  if (!actuals) return false;
  if (actuals.seededFromActuals) return true;
  if (actuals.chip !== "Estimated from statement pace") return false;
  if (actuals.budgetRevenue == null || actuals.ebit == null || actuals.budgetEbit == null) return false;
  return statementSeedAmountsMatch(
    actuals.revenue,
    actuals.budgetRevenue,
    actuals.ebit,
    actuals.budgetEbit,
  );
}

/** Sentence for a comparison that is not a result. Null when the variance is real. */
export function budgetComparisonNote(
  actuals: {
    chip?: string | null;
    revenue?: number;
    budgetRevenue?: number;
    ebit?: number;
    budgetEbit?: number;
    periodKnown?: boolean;
    seededFromActuals?: boolean;
    outsidePlan?: boolean;
  } | null | undefined,
): string | null {
  if (!actuals) return null;
  if (actuals.outsidePlan) return STATEMENT_PERIOD_OUTSIDE_NOTE;
  if (
    actuals.seededFromActuals ||
    (actuals.revenue != null &&
      budgetSeededFromStatement({
        chip: actuals.chip,
        revenue: actuals.revenue,
        budgetRevenue: actuals.budgetRevenue,
        ebit: actuals.ebit,
        budgetEbit: actuals.budgetEbit,
        seededFromActuals: actuals.seededFromActuals,
      }))
  ) {
    return SEEDED_VARIANCE_NOTE;
  }
  if (actuals.periodKnown === false) return STATEMENT_PERIOD_UNKNOWN_NOTE;
  return null;
}

function coverMonths(fy: string[], endMonth: string, periodMonths: number): string[] {
  const n = Math.max(1, Math.min(fy.length, Math.round(periodMonths) || fy.length));
  if (n >= fy.length) return fy.slice();
  const endIdx = fy.indexOf(endMonth);
  if (endIdx < 0) return fy.slice(0, n);
  const startIdx = Math.max(0, endIdx - n + 1);
  return fy.slice(startIdx, endIdx + 1);
}

/**
 * Statement window versus the same slice of the plan.
 * Actuals are the period totals Overview uses, not an annualised month.
 * A 21-day September is not shown as that month times 365/21/12.
 */
export function budgetVersusStatement(
  doc: BudgetDocument,
  periodFinancials: Record<string, unknown> | null | undefined,
  market: DateMarket,
): (BudgetActuals & {
  chip: BudgetActualsChip;
  budgetRevenue?: number;
  budgetCogs?: number;
  budgetOverheads?: number;
  ebit: number;
  budgetEbit?: number;
  periodMonths?: number;
  periodKnown: boolean;
  seededFromActuals: boolean;
  outsidePlan?: boolean;
}) | null {
  if (!periodFinancials) return null;
  const aliased = withCostAliases(
    periodFinancials as Record<string, string | number | null | undefined>,
  );
  const bridge = periodProfitBridge(aliased);
  if (!(bridge.revenue || bridge.cogs || bridge.operatingExpenses)) return null;
  const meta = readStatementMeta(periodFinancials, market);
  const rows = computeBudgetMonths(doc, doc.activeScenario);
  const fy = fyMonths(doc.fyStart);
  const endMonth = meta.periodEnd?.slice(0, 7) ?? "";
  const endInFy = /^\d{4}-\d{2}$/.test(endMonth) && fy.includes(endMonth);
  const window = varianceWindowKeys(
    statementPeriodBasis(periodFinancials),
    fy,
    endInFy ? endMonth : "",
  );
  const base = {
    revenue: bridge.revenue,
    cogs: bridge.cogs,
    fixedCosts: bridge.operatingExpenses,
    ebit: bridge.ebit,
    chip: "Estimated from statement pace" as const,
  };
  if (window && window.keys.length === 0) {
    return {
      ...base,
      label: "Outside this budget year",
      periodKnown: true,
      seededFromActuals: false,
      outsidePlan: true,
    };
  }
  if (!window) {
    const yearRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const yearEbit = rows.reduce((sum, row) => sum + row.ebit, 0);
    const seeded =
      budgetMonthsAreUniform(doc) &&
      statementSeedAmountsMatch(bridge.revenue, yearRevenue, bridge.ebit, yearEbit);
    return {
      ...base,
      label: "Statement period unknown",
      budgetRevenue: seeded ? bridge.revenue : undefined,
      budgetCogs: seeded ? bridge.cogs : undefined,
      budgetOverheads: seeded ? bridge.operatingExpenses : undefined,
      budgetEbit: seeded ? bridge.ebit : undefined,
      periodKnown: false,
      seededFromActuals: seeded,
    };
  }
  let budgetRevenue = 0;
  let budgetCogs = 0;
  let budgetOverheads = 0;
  let budgetEbit = 0;
  const scale = window.dayFraction ?? 1;
  for (const row of rows) {
    if (!window.keys.includes(row.month)) continue;
    budgetRevenue += row.revenue * scale;
    budgetCogs += row.cogs * scale;
    budgetOverheads += row.overheads * scale;
    budgetEbit += row.ebit * scale;
  }
  const dated = window.dayFraction != null ? meta.periodLabel?.trim() : "";
  const label = dated
    ? `${dated}, prorated`
    : `${budgetCoverWindowLabel(window.keys)}, prorated`;
  const seeded =
    budgetMonthsAreUniform(doc) &&
    statementSeedAmountsMatch(bridge.revenue, budgetRevenue, bridge.ebit, budgetEbit);
  return {
    ...base,
    label,
    budgetRevenue,
    budgetCogs,
    budgetOverheads,
    budgetEbit,
    periodMonths: window.keys.length,
    periodKnown: true,
    seededFromActuals: seeded,
  };
}
