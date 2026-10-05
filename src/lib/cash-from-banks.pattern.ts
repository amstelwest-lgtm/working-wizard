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

/** Month names and short forms, English plus Afrikaans. Whole tokens only. */
const MONTH_TOKENS = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "januarie",
  "februarie",
  "maart",
  "mei",
  "junie",
  "julie",
  "augustus",
  "oktober",
  "desember",
  "mrt",
  "okt",
  "des",
]);

const REF_WORDS = new Set([
  "inv",
  "invoice",
  "ref",
  "reference",
  "txn",
  "trans",
  "doc",
  "pmt",
  "payment",
]);

/**
 * Payee key for recurring grouping. Strips months, dates, years, standalone
 * numbers and reference / invoice numbers, then collapses case and whitespace.
 */
export function normalisePayeeLabel(raw: string): string {
  const text = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = text.split(" ").filter((token) => {
    if (token.length <= 1) return false;
    if (/^\d+$/.test(token)) return false;
    if (/^\d{1,2}(?:st|nd|rd|th)$/.test(token)) return false;
    if (/^(?:19|20)\d{2}$/.test(token)) return false;
    if (MONTH_TOKENS.has(token)) return false;
    if (/^(?:inv|invoice|ref|reference|txn|trans|doc|pmt|payment)\d+$/.test(token)) return false;
    return true;
  });
  const withoutRefs = tokens.filter((token) => !REF_WORDS.has(token));
  const kept = (withoutRefs.length ? withoutRefs : tokens).slice(0, 3);
  return kept.join(" ");
}

/**
 * Recurrence key for the bank-statement → forecast draft.
 * Month names, dates and reference numbers are stripped from the payee and,
 * when that leaves nothing, from the narration. "Salaries July" and
 * "Salaries September" are one payroll series, not three once-offs.
 */
function groupingLabel(txn: CashStatementTransaction): string {
  const fromPayee = normalisePayeeLabel(txn.counterparty || "");
  const fromNarration = normalisePayeeLabel(txn.description || "");
  return fromPayee || fromNarration || "unknown";
}

function normalizeKey(txn: CashStatementTransaction): string {
  return `${txn.direction}|${txn.ai_bucket}|${groupingLabel(txn)}`;
}

function titleCaseLabel(label: string): string {
  return label.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
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

/** Same payee with a similar amount: within 15% of the median, or R1, whichever is larger. */
export function amountsSimilar(amounts: number[]): boolean {
  if (amounts.length < 2) return true;
  const med = median(amounts.map((n) => Math.abs(n)));
  const tol = Math.max(Math.abs(med) * 0.15, 1);
  return amounts.every((amount) => Math.abs(Math.abs(amount) - med) <= tol);
}

function inferCadence(
  txnCount: number,
  gaps: number[],
  bucket: CashBucket,
  similar: boolean,
): {
  cadence: CashCadence;
  confidence: number;
} {
  if (txnCount <= 1 || gaps.length === 0) {
    // Annual-ish buckets with a single hit in a short window stay once-off for now
    if (bucket === "capex") return { cadence: "once_off", confidence: 0.55 };
    return { cadence: "once_off", confidence: 0.5 };
  }

  // A repeated payee is recurring only when the amount is similar and the gap
  // is actually weekly or monthly. Two unrelated hits are not a subscription.
  if (!similar) return { cadence: "once_off", confidence: 0.4 };

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
  return { cadence: "once_off", confidence: 0.45 };
}

/** Label shown where classified bank lines are reviewed. */
export function recurringReviewLabel(line: { cadence: string; txn_count: number }): string | null {
  if (line.txn_count < 2) return null;
  if (line.cadence === "weekly") return "Recurring · weekly";
  if (line.cadence === "monthly") return "Recurring · monthly";
  return null;
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
    const { cadence, confidence } = inferCadence(
      txns.length,
      gaps,
      bucket,
      amountsSimilar(amounts),
    );
    const side = bucketToSide(bucket, sample.direction);
    const stripped = groupingLabel(sample);
    const name =
      txns.length >= 2 && stripped !== "unknown"
        ? titleCaseLabel(stripped).slice(0, 60)
        : prettyName(
            txns.slice().sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0] ??
              sample,
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

export type ReviewCashTotals = {
  /** Both sides cover the uploaded statement, not one occurrence of a recurring line. */
  basis: "statement period";
  inflow: number;
  outflow: number;
};

/**
 * Bank-review footer totals. Every included line contributes amount × occurrences,
 * so a monthly receipt and a payroll series are both the full statement window.
 */
export function reviewCashTotals(
  lines: Array<
    Pick<CashForecastDraftLine, "status" | "side" | "amount" | "txn_count">
  >,
): ReviewCashTotals {
  let inflow = 0;
  let outflow = 0;
  for (const line of lines) {
    if (line.status === "excluded") continue;
    const occurrences = Math.max(1, line.txn_count || 1);
    const period = Math.abs(line.amount) * occurrences;
    if (line.side === "inflow") inflow += period;
    else outflow += period;
  }
  return {
    basis: "statement period",
    inflow: Math.round(inflow * 100) / 100,
    outflow: Math.round(outflow * 100) / 100,
  };
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
