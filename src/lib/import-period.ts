/**
 * Statement period chosen on the trial-balance / financials confirm step.
 * Never invents the current calendar month when the file has no period.
 */

import { MONTHS } from "@/lib/market/date-presets";

export type ImportPeriodParts = {
  /** 1–12 */
  month: number;
  year: number;
};

export type ConfirmedImportPeriod = {
  /** Last calendar day of the chosen month, or the file's own end date. */
  periodEnd: string;
  /** Short stamp, e.g. "Oct 2026", or the file's own range. */
  periodLabel: string;
  /** Set when the file printed a start date. A month pick alone leaves this empty. */
  periodStart?: string | null;
  /** Inclusive months on the file. Empty when only a month was chosen. */
  periodMonths?: number | null;
};

export function importMonthNames(): readonly string[] {
  return MONTHS;
}

/** ISO date only. Unparseable or empty input is "not detected" — not "today". */
export function detectImportPeriod(periodEnd: string | null | undefined): ImportPeriodParts | null {
  const raw = periodEnd?.trim() ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month };
}

export function importPeriodFromParts(
  yearRaw: string | number | null | undefined,
  monthRaw: string | number | null | undefined,
): ConfirmedImportPeriod | null {
  const year = typeof yearRaw === "number" ? yearRaw : Number(String(yearRaw ?? "").trim());
  const month = typeof monthRaw === "number" ? monthRaw : Number(String(monthRaw ?? "").trim());
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { periodEnd, periodLabel: `${MONTHS[month - 1]} ${year}` };
}
