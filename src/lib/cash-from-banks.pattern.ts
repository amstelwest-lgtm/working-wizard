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
import { forecastAnchorDate } from "@/lib/client-metrics";

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
const PAYEE_NOISE = new Set([
  "payment",
  "payments",
  "receipt",
  "receipts",
  "received",
  "customer",
  "customers",
  "from",
  "ach",
  "wire",
  "credit",
  "debit",
  "deposit",
  "online",
  "pos",
  "purchase",
  "transfer",
  "subscription",
  "monthly",
  "eft",
  "com",
  "www",
  "the",
  "and",
]);

const PAYEE_SUFFIX = new Set([
  "llc",
  "inc",
  "ltd",
  "limited",
  "pty",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
]);

/**
 * Stable counterparty key. Month names, reference tokens, and narration
 * noise ("customer receipt", "payment", invoice numbers) drop out so
 * "Northwind INV-1042" and "Customer receipt Northwind" are one series.
 * Display labels still use `normalisePayeeLabel`.
 */
export function payeeGroupKey(raw: string): string {
  const text = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = text.split(" ").filter((token) => {
    if (token.length <= 1) return false;
    if (/\d/.test(token)) return false;
    if (MONTH_TOKENS.has(token)) return false;
    if (REF_WORDS.has(token)) return false;
    return true;
  });
  const content = tokens.filter((token) => !PAYEE_NOISE.has(token));
  const kept = (content.length ? content : tokens).slice();
  while (kept.length > 1 && PAYEE_SUFFIX.has(kept[kept.length - 1]!)) kept.pop();
  return kept.slice(0, 3).join(" ");
}

function groupingLabel(txn: CashStatementTransaction): string {
  const fromPayee = payeeGroupKey(txn.counterparty || "");
  const fromNarration = payeeGroupKey(txn.description || "");
  return fromPayee || fromNarration || "unknown";
}

function normalizeKey(txn: CashStatementTransaction): string {
  const payee = groupingLabel(txn);
  // Transfers stay on their own key. Other buckets for the same payer
  // (a receipt tagged trading and another tagged other) are one series.
  if (txn.ai_bucket === "transfer") return `transfer|${payee}`;
  return `${txn.direction}|${payee}`;
}

/** Opening / closing rows are balances, not movements. */
export function isStatementBalanceRow(txn: {
  description?: string | null;
  counterparty?: string | null;
}): boolean {
  const text = `${txn.description ?? ""} ${txn.counterparty ?? ""}`
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(opening|closing) balance\b/.test(text)) return true;
  if (/\bbalance (brought|carried) forward\b/.test(text)) return true;
  if (/\b(brought|carried) forward\b/.test(text)) return true;
  return false;
}

function majorityBucket(txns: CashStatementTransaction[]): CashBucket {
  const counts = new Map<CashBucket, number>();
  for (const txn of txns) counts.set(txn.ai_bucket, (counts.get(txn.ai_bucket) ?? 0) + 1);
  let best = txns[0]!.ai_bucket;
  let n = 0;
  for (const [bucket, count] of counts) {
    if (count > n) {
      best = bucket;
      n = count;
    }
  }
  return best;
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

function calendarMonth(iso: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 7) : null;
}

function spanDays(dates: string[]): number {
  const sorted = dates.filter(Boolean).sort();
  if (sorted.length < 2) return 0;
  const start = Date.parse(sorted[0]!);
  const end = Date.parse(sorted[sorted.length - 1]!);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Population coefficient of variation. Zero when every amount matches. */
function coefficientOfVariation(amounts: number[]): number {
  if (amounts.length < 2) return 0;
  const abs = amounts.map((n) => Math.abs(n));
  const mean = abs.reduce((sum, n) => sum + n, 0) / abs.length;
  if (!(mean > 0)) return 0;
  const variance = abs.reduce((sum, n) => sum + (n - mean) ** 2, 0) / abs.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Shown confidence. Same base as an equal monthly series (0.55 + 0.1 per
 * txn, cap 0.92), then scaled by 1/(1+cv). Variation lowers the figure.
 * It never decides whether the series is monthly.
 */
function confidenceWithVariation(txnCount: number, cv: number): number {
  const base = Math.min(0.92, 0.55 + txnCount * 0.1);
  const scaled = base / (1 + Math.max(0, cv));
  return Math.round(Math.min(0.92, Math.max(0.35, scaled)) * 1000) / 1000;
}

/**
 * Same counterparty across two or more calendar months, spanning at least
 * 45 days, is monthly even when the amounts differ. Forecast amount is the
 * median of the monthly totals. The week is the median day of each month's
 * largest receipt.
 */
function monthlyFromCalendar(txns: CashStatementTransaction[]): {
  amount: number;
  dates: string[];
  confidence: number;
} | null {
  const byMonth = new Map<string, { total: number; largest: number; date: string }>();
  const amounts: number[] = [];
  const allDates: string[] = [];
  for (const txn of txns) {
    const month = calendarMonth(txn.txn_date);
    if (!month) continue;
    const abs = Math.abs(txn.amount);
    if (!Number.isFinite(abs)) continue;
    amounts.push(abs);
    allDates.push(txn.txn_date);
    const prev = byMonth.get(month);
    if (!prev) {
      byMonth.set(month, { total: abs, largest: abs, date: txn.txn_date });
    } else {
      prev.total += abs;
      if (abs > prev.largest) {
        prev.largest = abs;
        prev.date = txn.txn_date;
      }
    }
  }
  if (byMonth.size < 2 || spanDays(allDates) < 45) return null;
  const totals = [...byMonth.values()].map((row) => row.total);
  return {
    amount: Math.round(median(totals) * 100) / 100,
    dates: [...byMonth.values()].map((row) => row.date),
    confidence: confidenceWithVariation(amounts.length, coefficientOfVariation(amounts)),
  };
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
  // is actually weekly or roughly monthly. Two unrelated hits are not a subscription.
  if (!similar) return { cadence: "once_off", confidence: 0.4 };

  const medGap = median(gaps);
  if (medGap >= 5 && medGap <= 9 && txnCount >= 3) {
    return { cadence: "weekly", confidence: Math.min(0.95, 0.55 + txnCount * 0.08) };
  }
  // A calendar month is 28–31 days. Customer receipts and supplier pulls
  // slip by about a week, so 21–40 days is still monthly. Same rule for
  // inflows and outflows.
  if (medGap >= 21 && medGap <= 40 && txnCount >= 2) {
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

/** Week of the month that holds this day. 1–7 → week 1 … 22–31 → week 4. */
export function forecastWeekForDayOfMonth(day: number): number {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function usualDayOfMonth(dates: string[]): number | null {
  const days = dates
    .map((iso) => Number(iso.slice(8, 10)))
    .filter((day) => day >= 1 && day <= 31);
  if (!days.length) return null;
  return Math.round(median(days));
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
  if (cadence === "monthly" || cadence === "annual") {
    const day = usualDayOfMonth(dates);
    if (day != null) return forecastWeekForDayOfMonth(day);
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
    if (isStatementBalanceRow(txn)) continue;
    const key = normalizeKey(txn);
    const list = groups.get(key) ?? [];
    list.push(txn);
    groups.set(key, list);
  }

  const lines: CashForecastDraftLine[] = [];
  for (const [, txns] of groups) {
    const sample = txns[0]!;
    const bucket = majorityBucket(txns);
    const allExcluded = txns.every((t) => isExcludedBucket(t.ai_bucket, t.excluded));
    const amounts = txns.map((t) => Math.abs(t.amount));
    const dates = txns.map((t) => t.txn_date).filter(Boolean);
    const gaps = dayGaps(dates);
    const similar = amountsSimilar(amounts);
    // A similar weekly series stays weekly even when it also covers two
    // months. Everything else with a 45-day multi-month span is monthly,
    // including receipts whose amounts vary and months with two hits.
    const medGap = gaps.length ? median(gaps) : 0;
    const weekly = similar && txns.length >= 3 && medGap >= 5 && medGap <= 9;
    const calendar = weekly ? null : monthlyFromCalendar(txns);
    const inferred = calendar
      ? { cadence: "monthly" as const, confidence: calendar.confidence }
      : inferCadence(txns.length, gaps, bucket, similar);
    const cadence = inferred.cadence;
    const confidence = inferred.confidence;
    const forecastAmount = calendar ? calendar.amount : Math.round(median(amounts) * 100) / 100;
    const weekDates = calendar ? calendar.dates : dates;
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
      amount: forecastAmount,
      cadence,
      start_week: defaultStartWeek(cadence, weekDates, extract.period_end),
      split_count: cadence.startsWith("split") ? Math.min(6, Math.max(2, txns.length)) : 3,
      status: allExcluded ? "excluded" : "proposed",
      confidence,
      source: "ai",
      period_total: Math.round(amounts.reduce((sum, n) => sum + n, 0) * 100) / 100,
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

/**
 * Week 1 of a bank draft. The current week in the firm's timezone, or the day
 * after the statement when that day is still in the future. A past statement
 * end must not leave the first weeks already behind.
 */
export function nextForecastStartDate(
  periodEnd: string | null,
  opts?: { now?: Date; timeZone?: string | null },
): string {
  return forecastAnchorDate({
    now: opts?.now,
    periodEnd,
    timeZone: opts?.timeZone,
  });
}

export type ReviewCashTotals = {
  /** Both sides cover the uploaded statement, not one occurrence of a recurring line. */
  basis: "statement period";
  inflow: number;
  outflow: number;
};

/**
 * Bank-review footer totals. Each included line contributes the sum of its
 * source transactions (`period_total`). A typical amount × count is only the
 * fallback for a hand-built line that has no stored sum — that product
 * overstates the statement when the amounts in a series are not identical.
 */
export function reviewCashTotals(
  lines: Array<
    Pick<CashForecastDraftLine, "status" | "side" | "amount" | "txn_count" | "period_total">
  >,
): ReviewCashTotals {
  let inflow = 0;
  let outflow = 0;
  for (const line of lines) {
    if (line.status === "excluded") continue;
    const period =
      line.period_total != null && Number.isFinite(line.period_total)
        ? Math.abs(line.period_total)
        : Math.abs(line.amount) * Math.max(1, line.txn_count || 1);
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
