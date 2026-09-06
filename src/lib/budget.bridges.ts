/**
 * Budget bridges — seed from financials, push near-term into 13-week cash forecast.
 */

import type { BudgetDocument } from "@/lib/budget.types";
import { fyMonths } from "@/lib/budget.months";
import { computeBudgetMonths } from "@/lib/budget.compute";
import { newId } from "@/lib/budget.templates";
import type { CashForecastPublishPayload } from "@/lib/cash-from-banks.types";
import { annualiseFinancials } from "@/lib/ratios";

function num(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type SeedFromFinancialsResult = {
  doc: BudgetDocument;
  changes: string[];
};

/** Apply period financials into budget assumptions (does not invent volume history). */
export function seedBudgetFromFinancials(
  doc: BudgetDocument,
  periodFinancials: Record<string, string | number | null | undefined>,
): SeedFromFinancialsResult {
  const changes: string[] = [];
  const months = fyMonths(doc.fyStart);
  // A quarter of actuals must seed a full year, not a year at a quarter's pace.
  const financials = annualiseFinancials(periodFinancials);
  const revenue = num(financials.revenue);
  const cogs = num(financials.cogs);
  const fixedCosts = num(financials.fixedCosts);
  const laborCost = num(financials.laborCost);
  const receivables = num(financials.receivables);
  const payables = num(financials.payables);
  const inventory = num(financials.inventory);

  let next: BudgetDocument = {
    ...doc,
    updatedAt: new Date().toISOString(),
  };

  if (revenue > 0 && cogs >= 0) {
    const gp = ((revenue - cogs) / revenue) * 100;
    next = { ...next, gpPct: Math.round(gp * 10) / 10, cogsMode: "gp_pct" };
    changes.push(`GP% set to ${next.gpPct} from period revenue/COGS`);
  }

  if (revenue > 0 && next.revenueLines[0]) {
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

  if (fixedCosts > 0 || laborCost > 0) {
    const peopleMonthly = laborCost > 0 ? laborCost / 12 : (fixedCosts * 0.55) / 12;
    const otherMonthly =
      fixedCosts > 0 ? Math.max(0, fixedCosts / 12 - (laborCost > 0 ? 0 : peopleMonthly * 0.2)) : 0;
    next = {
      ...next,
      overheads: next.overheads.map((oh) => {
        const monthly =
          oh.bucket === "people"
            ? Math.round(peopleMonthly * 100) / 100
            : oh.bucket === "ops"
              ? Math.round(otherMonthly * 0.5 * 100) / 100
              : oh.bucket === "premises"
                ? Math.round(otherMonthly * 0.3 * 100) / 100
                : oh.bucket === "sales"
                  ? Math.round(otherMonthly * 0.2 * 100) / 100
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
  if (revenue > 0 && receivables > 0) {
    wc.debtorDays = Math.round((receivables / revenue) * 365);
    changes.push(`Debtor days ≈ ${wc.debtorDays} from receivables/revenue`);
  }
  if (cogs > 0 && payables > 0) {
    wc.creditorDays = Math.round((payables / cogs) * 365);
    changes.push(`Creditor days ≈ ${wc.creditorDays} from payables/COGS`);
  }
  if (next.showInventoryDays && cogs > 0 && inventory > 0) {
    wc.inventoryDays = Math.round((inventory / cogs) * 365);
    changes.push(`Inventory days ≈ ${wc.inventoryDays}`);
  }
  next = { ...next, wc };

  const ocf = num(financials.operatingCashflow);
  if (ocf !== 0 && !(next.openingCash > 0)) {
    // Soft hint only when opening cash empty — OCF is not a bank balance
    changes.push("Opening cash left unchanged (set manually from bank balance)");
  }

  return { doc: next, changes };
}

function lineId(prefix: string): string {
  return newId(prefix);
}

/**
 * Build a cash-forecast publish payload from the first ~13 weeks of the budget
 * (months 1–3 recurring monthly lines + WC-derived collection delay).
 */
export function budgetToCashForecastPayload(doc: BudgetDocument): CashForecastPublishPayload {
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

  const [y, m] = doc.fyStart.split("-").map(Number);
  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const collectDelay = Math.min(8, Math.max(0, Math.round(doc.wc.debtorDays / 7)));

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
    seededFromBanksAt: new Date().toISOString(),
  };
}
