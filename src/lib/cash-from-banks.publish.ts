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
import { formatCalendarDay } from "@/lib/market/format";

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

function finiteAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Opening cash the publish would replace: period cash when it is on file, else the forecast opening. */
export function openingCashToConfirm(forecastOpening: unknown, periodCash: unknown): number | null {
  const period = finiteAmount(periodCash);
  if (period != null) return period;
  return finiteAmount(forecastOpening);
}

function signedMoney(n: number, currency: "USD" | "ZAR", locale: string): string {
  const body = Math.abs(Math.round(n)).toLocaleString(locale);
  const symbol = currency === "USD" ? "$" : "R";
  return n < 0 ? `\u2212${symbol}${body}` : `${symbol}${body}`;
}

/**
 * Confirm copy when publishing would overwrite hand-entered opening cash
 * with the bank closing balance. Null when the two already agree.
 */
export function openingCashReplaceNotice(input: {
  currentOpening: number | null | undefined;
  bankClosing: number;
  bankDate?: string | null;
  currency?: "USD" | "ZAR";
  locale?: "en-ZA" | "en-US";
}): string | null {
  if (input.currentOpening == null || !Number.isFinite(input.currentOpening)) return null;
  if (!Number.isFinite(input.bankClosing)) return null;
  if (Math.abs(input.currentOpening - input.bankClosing) < 0.5) return null;
  const currency = input.currency === "ZAR" ? "ZAR" : "USD";
  const locale = input.locale ?? "en-US";
  const from = signedMoney(input.currentOpening, currency, locale);
  const to = signedMoney(input.bankClosing, currency, locale);
  const iso = input.bankDate?.slice(0, 10) ?? "";
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? formatCalendarDay(iso, { locale }, { day: "numeric", month: "short", year: "numeric" })
    : "";
  const onDate = dated && dated !== "—" ? ` on ${dated}` : "";
  return `This replaces opening cash ${from} → ${to} (bank closing balance${onDate})`;
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

  return {
    startDate: adopt || !existing?.startDate ? input.startDate : existing.startDate,
    openingBalance:
      adopt || existing?.openingBalance == null
        ? String(Math.round(input.openingBalance * 100) / 100)
        : existing.openingBalance,
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
