/**
 * Pro-rata period label shared with the Vite app.
 * Eng2 owns `src/lib/firm-year-label.ts` (`proratedPeriodLabel`,
 * `compactMonthRange`, `isProratedPeriodLabel`). This twin has no `@/`
 * imports and no app dependencies. The strings must stay byte-identical.
 *
 * Same year: "Mar–Sep 2026" (en dash, no spaces).
 * Cross year: "Nov 2025 – Feb 2026" (the same shape as formatMonthRange).
 * A slice that is not a strict subset of the statement has no label.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const EN_DASH = "\u2013";

function yearMonth(ym: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/** "Mar–Sep 2026" in one year. "Nov 2025 – Feb 2026" when the year changes. */
export function compactMonthRange(months: readonly string[]): string | null {
  if (!months.length) return null;
  const start = yearMonth(months[0] ?? "");
  const end = yearMonth(months[months.length - 1] ?? "");
  if (!start || !end) return null;
  const left = MONTHS[start.month - 1];
  const right = MONTHS[end.month - 1];
  if (!left || !right) return null;
  if (start.year === end.year && start.month === end.month) return `${left} ${start.year}`;
  if (start.year === end.year) return `${left}${EN_DASH}${right} ${start.year}`;
  return `${left} ${start.year} ${EN_DASH} ${right} ${end.year}`;
}

/**
 * "Mar–Sep 2026, pro-rated from your Jan–Sep 2026 statement".
 * Null unless every slice month sits in the statement and the slice is shorter.
 */
export function proratedPeriodLabel(
  sliceMonths: readonly string[],
  statementMonths: readonly string[],
): string | null {
  if (!sliceMonths.length || !statementMonths.length) return null;
  if (sliceMonths.length >= statementMonths.length) return null;
  const statement = new Set(statementMonths);
  if (!sliceMonths.every((month) => statement.has(month))) return null;
  const slice = compactMonthRange(sliceMonths);
  const full = compactMonthRange(statementMonths);
  if (!slice || !full) return null;
  return `${slice}, pro-rated from your ${full} statement`;
}

export function isProratedPeriodLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && label.includes(", pro-rated from your ");
}
