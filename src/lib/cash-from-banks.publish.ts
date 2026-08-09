/**
 * cash-from-banks.publish.ts
 * Map editable draft lines → clients.cashflow payload.
 */

import {
  cadenceToFrequency,
  publishAmountForLine,
  type CashForecastDraftLine,
  type CashForecastPublishPayload,
} from "@/lib/cash-from-banks.types";

function toLineItem(line: CashForecastDraftLine) {
  return {
    id: line.id,
    name: line.name,
    amount: String(Math.round(publishAmountForLine(line) * 100) / 100),
    frequency: cadenceToFrequency(line.cadence),
    startWeek: Math.max(1, Math.min(13, line.start_week || 1)),
    splitCount: Math.max(1, line.split_count || 3),
  };
}

export function buildCashflowPublishPayload(input: {
  lines: CashForecastDraftLine[];
  startDate: string;
  openingBalance: number;
}): CashForecastPublishPayload {
  const active = input.lines.filter((l) => l.status !== "excluded" && l.amount > 0);
  const revenue = active.filter((l) => l.side === "inflow").map(toLineItem);
  const expenseBuckets = new Set(["cos", "opex", "payroll", "rent", "interest", "tax"]);
  const expenses = active
    .filter((l) => l.side === "outflow" && expenseBuckets.has(l.bucket))
    .map(toLineItem);
  const other = active
    .filter((l) => l.side === "outflow" && !expenseBuckets.has(l.bucket))
    .map(toLineItem);

  // Ensure Cash Forecast has at least one row per section
  if (revenue.length === 0) {
    revenue.push({
      id: "seed-rev",
      name: "Trading receipts (add detail)",
      amount: "",
      frequency: "recurring-monthly",
      startWeek: 1,
      splitCount: 3,
    });
  }
  if (expenses.length === 0) {
    expenses.push({
      id: "seed-exp",
      name: "Operating payments (add detail)",
      amount: "",
      frequency: "recurring-monthly",
      startWeek: 1,
      splitCount: 3,
    });
  }
  if (other.length === 0) {
    other.push({
      id: "seed-other",
      name: "Other cash out",
      amount: "",
      frequency: "once-off",
      startWeek: 1,
      splitCount: 3,
    });
  }

  return {
    startDate: input.startDate,
    openingBalance: String(Math.round(input.openingBalance * 100) / 100),
    revenue,
    expenses,
    other,
    revAdj: 100,
    expAdj: 100,
    collectDelay: 0,
    headcountDelta: 0,
    avgSalary: "0",
    fixedCostDelta: "0",
    revGrowthPct: 0,
    capexAmount: "0",
    capexWeek: 1,
    seededFromBanksAt: new Date().toISOString(),
  };
}
