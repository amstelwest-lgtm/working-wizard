/**
 * Calendar presets. Month names come from this table only.
 * Numbers come from the caller (ISO parts, or formatToParts in format.ts).
 * en-ZA Intl prints "Sept" and a padded day, so locale month names are not used.
 */

export const MONTHS = [
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

export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTHS_LONG_LOWER = MONTHS_LONG.map((name) => name.toLowerCase());

export type DateOrder = "za" | "us";

const EN_DASH = "\u2013";

export function dateOrder(localeOrPack: string | null | undefined): DateOrder {
  if (localeOrPack === "en-US" || localeOrPack === "us" || localeOrPack === "US") return "us";
  return "za";
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function calendarDayLabel(
  year: number,
  month: number,
  day: number,
  order: DateOrder,
): string | null {
  const mon = MONTHS[month - 1];
  if (!mon || day < 1 || day > daysInMonth(year, month)) return null;
  return order === "us" ? `${mon} ${day}, ${year}` : `${day} ${mon} ${year}`;
}

export function weekHeaderLabel(month: number, day: number, order: DateOrder): string | null {
  const mon = MONTHS[month - 1];
  if (!mon || day < 1 || day > 31) return null;
  return order === "us" ? `${mon} ${day}` : `${day} ${mon}`;
}

/** Month column, both markets: "Oct 26". */
export function monthColumnLabel(year: number, month: number): string | null {
  const mon = MONTHS[month - 1];
  if (!mon || !Number.isInteger(year)) return null;
  return `${mon} ${String(year % 100).padStart(2, "0")}`;
}

export function monthYearLabel(year: number, month: number): string | null {
  const mon = MONTHS[month - 1];
  if (!mon || !Number.isInteger(year)) return null;
  return `${mon} ${year}`;
}

/** "Mar 2026" or "Mar 2026 – Feb 2027". */
export function formatMonthRange(startYm: string, endYm: string): string | null {
  const start = yearMonth(startYm);
  const end = yearMonth(endYm);
  if (!start || !end) return null;
  const left = monthYearLabel(start.year, start.month);
  const right = monthYearLabel(end.year, end.month);
  if (!left || !right) return null;
  if (left === right) return left;
  return `${left} ${EN_DASH} ${right}`;
}

export function calendarDayFromIso(iso: string, order: DateOrder): string | null {
  const parts = ymd(iso);
  if (!parts) return null;
  return calendarDayLabel(parts.year, parts.month, parts.day, order);
}

export function weekHeaderFromIso(iso: string, order: DateOrder): string | null {
  const parts = ymd(iso);
  if (!parts) return null;
  return weekHeaderLabel(parts.month, parts.day, order);
}

function twelveHour(hour24: number, minute: string): string {
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

/** ZA "09:54". US "9:54 AM". */
export function clockLabel(hour24: number, minute: number, order: DateOrder): string | null {
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return null;
  const mm = String(minute).padStart(2, "0");
  return order === "us" ? twelveHour(hour24, mm) : `${String(hour24).padStart(2, "0")}:${mm}`;
}

/** ZA "2 Nov 2026, 09:54 SAST". US "Nov 2, 2026, 9:54 AM ET". */
export function dateTimeLabel(
  year: number,
  month: number,
  day: number,
  hour24: number,
  minute: number,
  zone: string,
  order: DateOrder,
): string | null {
  const calendar = calendarDayLabel(year, month, day, order);
  const clock = clockLabel(hour24, minute, order);
  if (!calendar || !clock) return null;
  const label = zone.trim();
  return label ? `${calendar}, ${clock} ${label}` : `${calendar}, ${clock}`;
}

function ymd(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function yearMonth(ym: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}
