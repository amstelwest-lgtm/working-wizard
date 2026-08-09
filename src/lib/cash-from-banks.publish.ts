/**
 * cash-from-banks.publish.ts
 * Map editable draft lines → clients.cashflow payload, with replace/merge policies.
 */

import {
  cadenceToFrequency,
  publishAmountForLine,
  type CashForecastDraftLine,
  type CashForecastPublishPayload,
  type ForecastFrequency,
} from "@/lib/cash-from-banks.types";

export type PublishPolicy = "replace" | "merge";

type LineItem = {
  id: string;
  name: string;
  amount: string;
  frequency: ForecastFrequency;
  startWeek: number;
  splitCount: number;
};

export type ExistingCashflow = {
  startDate?: string;
  openingBalance?: string;
  revenue?: LineItem[];
  expenses?: LineItem[];
  other?: LineItem[];
  revAdj?: number;
  expAdj?: number;
  collectDelay?: number;
  headcountDelta?: number;
  avgSalary?: string;
  fixedCostDelta?: string;
  revGrowthPct?: number;
  capexAmount?: string;
  capexWeek?: number;
  seededFromBanksAt?: string;
};

function toLineItem(line: CashForecastDraftLine): LineItem {
  return {
    id: line.id,
    name: line.name,
    amount: String(Math.round(publishAmountForLine(line) * 100) / 100),
    frequency: cadenceToFrequency(line.cadence),
    startWeek: Math.max(1, Math.min(13, line.start_week || 1)),
    splitCount: Math.max(1, line.split_count || 3),
  };
}

function ensureSection(items: LineItem[], fallback: LineItem): LineItem[] {
  return items.length ? items : [fallback];
}

function hasMeaningfulExisting(existing: ExistingCashflow | null | undefined): boolean {
  if (!existing) return false;
  const all = [...(existing.revenue ?? []), ...(existing.expenses ?? []), ...(existing.other ?? [])];
  return all.some((l) => (parseFloat(l.amount) || 0) !== 0);
}

export function existingCashflowIsMeaningful(existing: ExistingCashflow | null | undefined): boolean {
  return hasMeaningfulExisting(existing);
}

function remapId(id: string): string {
  return `m_${id}_${Math.random().toString(36).slice(2, 6)}`;
}

export function buildCashflowPublishPayload(input: {
  lines: CashForecastDraftLine[];
  startDate: string;
  openingBalance: number;
  policy?: PublishPolicy;
  existing?: ExistingCashflow | null;
  /** When merging, whether to overwrite opening balance / start date from the bank draft */
  adoptBankBalances?: boolean;
}): CashForecastPublishPayload {
  const policy = input.policy ?? "replace";
  const active = input.lines.filter((l) => l.status !== "excluded" && l.amount > 0);
  const expenseBuckets = new Set(["cos", "opex", "payroll", "rent", "interest", "tax"]);

  let revenue = active.filter((l) => l.side === "inflow").map(toLineItem);
  let expenses = active
    .filter((l) => l.side === "outflow" && expenseBuckets.has(l.bucket))
    .map(toLineItem);
  let other = active
    .filter((l) => l.side === "outflow" && !expenseBuckets.has(l.bucket))
    .map(toLineItem);

  const existing = input.existing;
  if (policy === "merge" && existing && hasMeaningfulExisting(existing)) {
    // Fresh ids so merge doesn't collide with existing line ids
    revenue = [
      ...(existing.revenue ?? []),
      ...revenue.map((l) => ({ ...l, id: remapId(l.id) })),
    ];
    expenses = [
      ...(existing.expenses ?? []),
      ...expenses.map((l) => ({ ...l, id: remapId(l.id) })),
    ];
    other = [
      ...(existing.other ?? []),
      ...other.map((l) => ({ ...l, id: remapId(l.id) })),
    ];
  }

  revenue = ensureSection(revenue, {
    id: "seed-rev",
    name: "Trading receipts (add detail)",
    amount: "",
    frequency: "recurring-monthly",
    startWeek: 1,
    splitCount: 3,
  });
  expenses = ensureSection(expenses, {
    id: "seed-exp",
    name: "Operating payments (add detail)",
    amount: "",
    frequency: "recurring-monthly",
    startWeek: 1,
    splitCount: 3,
  });
  other = ensureSection(other, {
    id: "seed-other",
    name: "Other cash out",
    amount: "",
    frequency: "once-off",
    startWeek: 1,
    splitCount: 3,
  });

  const adopt = input.adoptBankBalances !== false;
  const keepScenario = policy === "merge" && existing;

  return {
    startDate: adopt || !existing?.startDate ? input.startDate : existing.startDate,
    openingBalance:
      adopt || existing?.openingBalance == null
        ? String(Math.round(input.openingBalance * 100) / 100)
        : existing.openingBalance,
    revenue,
    expenses,
    other,
    revAdj: keepScenario ? (existing?.revAdj ?? 100) : 100,
    expAdj: keepScenario ? (existing?.expAdj ?? 100) : 100,
    collectDelay: keepScenario ? (existing?.collectDelay ?? 0) : 0,
    headcountDelta: keepScenario ? (existing?.headcountDelta ?? 0) : 0,
    avgSalary: keepScenario ? (existing?.avgSalary ?? "0") : "0",
    fixedCostDelta: keepScenario ? (existing?.fixedCostDelta ?? "0") : "0",
    revGrowthPct: keepScenario ? (existing?.revGrowthPct ?? 0) : 0,
    capexAmount: keepScenario ? (existing?.capexAmount ?? "0") : "0",
    capexWeek: keepScenario ? (existing?.capexWeek ?? 1) : 1,
    seededFromBanksAt: new Date().toISOString(),
  };
}
