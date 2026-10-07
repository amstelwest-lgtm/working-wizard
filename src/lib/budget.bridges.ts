/**
 * Budget bridges — seed from financials, push near-term into 13-week cash forecast.
 */

import type { BudgetActuals, BudgetDocument } from "@/lib/budget.types";
import { fyMonths } from "@/lib/budget.months";
import { computeBudgetMonths, normalizeBudgetDocument } from "@/lib/budget.compute";
import { newId } from "@/lib/budget.templates";
import type { CashForecastPublishPayload } from "@/lib/cash-from-banks.types";
import { annualiseFinancials, FLOW_FIELD_KEYS } from "@/lib/ratios";

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

/**
 * Period P&L → a year, for the budget seed.
 * A dated span shorter than a year uses 365 / inclusive days, so 1–21 Sep
 * is not treated as one month or as a finished year. With no dates,
 * `periodMonths` scales the same way the ratio layer does (missing → 12).
 */
export function annualiseBudgetFinancials<T extends Record<string, unknown>>(fin: T): T {
  const days = inclusivePeriodDays(
    fin.periodStart as string | null | undefined,
    fin.periodEnd as string | null | undefined,
  );
  if (days != null && days > 0 && days < 360) {
    return scaleFlowFields(fin, 365 / days);
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
  if (presentNumber(normalised.fixedCosts) == null && presentNumber(normalised.operating_expenses) != null) {
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

/** Variance-card badge. Statement pace is not "no actuals". */
export function budgetActualsBadge(importedMonths: number, statementPace: boolean): string {
  if (importedMonths > 0) return `${importedMonths} imported`;
  if (statementPace) return "Statement pace";
  return "No actuals yet";
}

function budgetYearTotals(doc: BudgetDocument): { revenue: number; cogs: number } {
  const rows = computeBudgetMonths(doc, doc.activeScenario);
  return {
    revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    cogs: rows.reduce((sum, row) => sum + row.cogs, 0),
  };
}

/**
 * A stored budget that cannot be the same business as the latest actuals.
 * COGS of 0 while the period has cost of sales, or a year of revenue more
 * than about 3× the annualised actual. Callers prompt; they do not overwrite.
 */
export function budgetIsImplausible(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined> | null | undefined,
): boolean {
  if (!periodFinancials) return false;
  const annual = annualiseBudgetFinancials(withCostAliases(periodFinancials));
  const actualRevenue = presentNumber(annual.revenue);
  const actualCogs = presentNumber(annual.cogs);
  const budget = budgetYearTotals(doc);
  if (actualCogs != null && actualCogs > 0 && budget.cogs <= 0.5) return true;
  if (
    actualRevenue != null &&
    actualRevenue > 0 &&
    budget.revenue > actualRevenue * BUDGET_IMPLAUSIBLE_REVENUE_MULTIPLE + 1
  ) {
    return true;
  }
  return false;
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
  const fixedCosts = presentNumber(financials.fixedCosts);
  const laborCost = presentNumber(financials.laborCost);
  const receivables = num(financials.receivables);
  const payables = num(financials.payables);
  const inventory = num(financials.inventory);

  let next: BudgetDocument = {
    ...doc,
    updatedAt: new Date().toISOString(),
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
    changes.push("Overheads seeded from fixed/labour costs across the FY");
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
