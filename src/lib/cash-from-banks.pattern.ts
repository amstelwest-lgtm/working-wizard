/**
 * Pattern engine: classified bank transactions → preliminary cash forecast lines.
 * Pure functions — no I/O. Used by the server after Claude extraction.
 */

import {
  type CashBankExtract,
  type CashBucket,
  type CashCadence,
  type CashForecastDraftLine,
  type CashStatementTransaction,
  bucketToSide,
} from "@/lib/cash-from-banks.types";

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function normalizeKey(txn: CashStatementTransaction): string {
  const raw = (txn.counterparty || txn.description || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Keep first 3 meaningful tokens so "ABSA LOAN 123" ≈ "ABSA LOAN 456"
  const tokens = raw.split(" ").filter((t) => t.length > 1 && !/^\d+$/.test(t)).slice(0, 3);
  const label = tokens.join(" ") || raw.slice(0, 24) || "unknown";
  return `${txn.direction}|${txn.ai_bucket}|${label}`;
}

function prettyName(txn: CashStatementTransaction): string {
  const base = (txn.counterparty || txn.description || "Cash movement").trim();
  return base.replace(/\s+/g, " ").slice(0, 60);
}

function dayGaps(dates: string[]): number[] {
  const sorted = [...dates].filter(Boolean).sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = Date.parse(sorted[i - 1]!);
    const b = Date.parse(sorted[i]!);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      gaps.push(Math.round((b - a) / 86_400_000));
    }
  }
  return gaps;
}

function inferCadence(txnCount: number, gaps: number[], bucket: CashBucket): {
  cadence: CashCadence;
  confidence: number;
} {
  if (txnCount <= 1 || gaps.length === 0) {
    // Annual-ish buckets with a single hit in a short window stay once-off for now
    if (bucket === "capex") return { cadence: "once_off", confidence: 0.55 };
    return { cadence: "once_off", confidence: 0.5 };
  }

  const medGap = median(gaps);
  if (medGap >= 5 && medGap <= 9 && txnCount >= 3) {
    return { cadence: "weekly", confidence: Math.min(0.95, 0.55 + txnCount * 0.08) };
  }
  if (medGap >= 25 && medGap <= 35 && txnCount >= 2) {
    return { cadence: "monthly", confidence: Math.min(0.92, 0.55 + txnCount * 0.1) };
  }
  if (medGap >= 350 && medGap <= 380) {
    return { cadence: "annual", confidence: 0.7 };
  }
  if (txnCount >= 3 && medGap > 9 && medGap < 25) {
    return { cadence: "split_weeks", confidence: 0.45 };
  }
  if (txnCount >= 2) {
    return { cadence: "monthly", confidence: 0.4 };
  }
  return { cadence: "once_off", confidence: 0.45 };
}

function defaultStartWeek(
  cadence: CashCadence,
  dates: string[],
  periodEnd: string | null,
): number {
  if (cadence === "once_off" || cadence === "split_weeks" || cadence === "split_months") {
    // Put once-offs early so owners see them
    return 1;
  }
  if (!periodEnd || !dates.length) return 1;
  const last = dates.slice().sort().at(-1);
  if (!last) return 1;
  const end = Date.parse(periodEnd);
  const lastMs = Date.parse(last);
  if (!Number.isFinite(end) || !Number.isFinite(lastMs)) return 1;
  // Days since last occurrence → approximate week offset into the forecast
  const daysSince = Math.max(0, Math.round((end - lastMs) / 86_400_000));
  if (cadence === "weekly") {
    const rem = 7 - (daysSince % 7);
    return Math.min(13, Math.max(1, rem <= 0 ? 1 : Math.ceil(rem / 7)));
  }
  if (cadence === "monthly" || cadence === "annual") {
    const rem = 30 - (daysSince % 30);
    return Math.min(13, Math.max(1, Math.ceil(rem / 7)));
  }
  return 1;
}

function isExcludedBucket(bucket: CashBucket, excludedFlag: boolean): boolean {
  if (excludedFlag) return true;
  // Transfers are noise for a trading cash forecast by default
  return bucket === "transfer";
}

/**
 * Build preliminary draft lines from an extract.
 * Transfers are excluded by default; VAT/owner/loan/capex stay as outflows/inflows
 * so cash timing is honest (unlike the P&L drafter).
 */
export function buildDraftLinesFromExtract(extract: CashBankExtract): CashForecastDraftLine[] {
  const groups = new Map<string, CashStatementTransaction[]>();
  for (const txn of extract.transactions) {
    if (!txn.amount || !Number.isFinite(txn.amount)) continue;
    const key = normalizeKey(txn);
    const list = groups.get(key) ?? [];
    list.push(txn);
    groups.set(key, list);
  }

  const lines: CashForecastDraftLine[] = [];
  for (const [, txns] of groups) {
    const sample = txns[0]!;
    const bucket = sample.ai_bucket;
    const allExcluded = txns.every((t) => isExcludedBucket(t.ai_bucket, t.excluded));
    const amounts = txns.map((t) => Math.abs(t.amount));
    const dates = txns.map((t) => t.txn_date).filter(Boolean);
    const gaps = dayGaps(dates);
    const { cadence, confidence } = inferCadence(txns.length, gaps, bucket);
    const side = bucketToSide(bucket, sample.direction);
    const name = prettyName(
      txns.slice().sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0] ?? sample,
    );

    lines.push({
      id: newId(),
      side,
      bucket,
      name,
      amount: Math.round(median(amounts) * 100) / 100,
      cadence,
      start_week: defaultStartWeek(cadence, dates, extract.period_end),
      split_count: cadence.startsWith("split") ? Math.min(6, Math.max(2, txns.length)) : 3,
      status: allExcluded ? "excluded" : "proposed",
      confidence,
      source: "ai",
      txn_count: txns.length,
      sample_descriptions: [...new Set(txns.map((t) => t.description).filter(Boolean))].slice(0, 3),
    });
  }

  // Stable sort: inflows first, then by absolute amount desc
  return lines.sort((a, b) => {
    if (a.status !== b.status) return a.status === "excluded" ? 1 : -1;
    if (a.side !== b.side) return a.side === "inflow" ? -1 : 1;
    return b.amount - a.amount;
  });
}

export function nextForecastStartDate(periodEnd: string | null): string {
  const base = periodEnd && Number.isFinite(Date.parse(periodEnd))
    ? new Date(periodEnd)
    : new Date();
  // Day after statement period
  base.setDate(base.getDate() + 1);
  return base.toISOString().slice(0, 10);
}

export function resolveOpeningBalance(extract: CashBankExtract): number {
  if (extract.closing_balance != null && Number.isFinite(extract.closing_balance)) {
    return extract.closing_balance;
  }
  if (extract.opening_balance != null && Number.isFinite(extract.opening_balance)) {
    return extract.opening_balance;
  }
  return 0;
}
