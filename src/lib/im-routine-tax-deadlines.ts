/**
 * ZA tax deadline watch for IM routines — pure SAST calendar math, no SARS calls.
 */
import { parseOperatingProfile } from "@/lib/client-profile";
import { calendarDateInTimeZone, calendarMonthBounds } from "@/lib/statement-period";
import { companyTaxDeadlines } from "@/lib/tax-specialist/sample-compute";
const IM_ROUTINE_TIME_ZONE = "Africa/Johannesburg";
const APPROACH_BUSINESS_DAYS = 5;

function ymdInTimeZone(now: Date, timeZone: string): string {
  const { year, month, day } = calendarDateInTimeZone(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isWeekdayInTimeZone(instant: Date, timeZone: string): boolean {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  return day !== "Sat" && day !== "Sun";
}

/** Walk back to the last weekday on or before `ymd` (still in SAST). */
export function lastBusinessDayOnOrBeforeYmd(ymd: string, timeZone = IM_ROUTINE_TIME_ZONE): string {
  let cursor = new Date(`${ymd}T12:00:00+02:00`);
  while (!isWeekdayInTimeZone(cursor, timeZone)) {
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return ymdInTimeZone(cursor, timeZone);
}

function businessDaysBeforeYmd(ymd: string, n: number, timeZone = IM_ROUTINE_TIME_ZONE): string {
  let cursor = new Date(`${ymd}T12:00:00+02:00`);
  let counted = 0;
  while (counted < n) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    if (isWeekdayInTimeZone(cursor, timeZone)) counted += 1;
  }
  return ymdInTimeZone(cursor, timeZone);
}

export function isTaxDeadlineApproachingWindow(dueYmd: string, now: Date, timeZone = IM_ROUTINE_TIME_ZONE): boolean {
  const due = lastBusinessDayOnOrBeforeYmd(dueYmd, timeZone);
  const today = ymdInTimeZone(now, timeZone);
  if (today > due) return false;
  const windowStart = businessDaysBeforeYmd(due, APPROACH_BUSINESS_DAYS, timeZone);
  return today >= windowStart;
}

/** VAT201 and EMP201 — last business day of the current SAST month. */
export function imPeriodicTaxReturnsApproaching(now: Date): boolean {
  const { to: monthEndYmd } = calendarMonthBounds(now, 0, IM_ROUTINE_TIME_ZONE);
  const due = lastBusinessDayOnOrBeforeYmd(monthEndYmd);
  return isTaxDeadlineApproachingWindow(due, now);
}

/** Company year-end YMD from operating profile fy start month, for IRP6 / ITR14 windows. */
export function companyYearEndFromOperatingProfile(operatingProfile: unknown, now: Date): string | null {
  const fyStart = parseOperatingProfile(operatingProfile)?.fyStartMonth;
  if (fyStart == null || fyStart < 1 || fyStart > 12) return null;
  const yearEndMonth = fyStart === 1 ? 12 : fyStart - 1;
  const { year, month } = calendarDateInTimeZone(now, IM_ROUTINE_TIME_ZONE);
  const inCurrentFy = month >= fyStart;
  const fyStartYear = inCurrentFy ? year : year - 1;
  const endYear = yearEndMonth < fyStart ? fyStartYear + 1 : fyStartYear;
  const lastDay = new Date(Date.UTC(endYear, yearEndMonth, 0)).getUTCDate();
  return `${endYear}-${String(yearEndMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function imCompanyTaxDeadlinesApproaching(companyYearEndYmd: string, now: Date): boolean {
  for (const row of companyTaxDeadlines(companyYearEndYmd)) {
    if (isTaxDeadlineApproachingWindow(row.due, now)) return true;
  }
  return false;
}

export function imTaxDeadlineApproaching(now: Date, operatingProfile: unknown): boolean {
  if (imPeriodicTaxReturnsApproaching(now)) return true;
  const yearEnd = companyYearEndFromOperatingProfile(operatingProfile, now);
  if (yearEnd && imCompanyTaxDeadlinesApproaching(yearEnd, now)) return true;
  return false;
}