/**
 * Monthly recurrence on a 13-week horizon.
 * A calendar month is about 4.33 weeks, so a monthly amount lands about
 * three times, on the same day of the month as its start week. Stepping
 * every fourth week lands four times (weeks 1, 5, 9 and 13).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0-based week indexes where a monthly amount lands. */
export function monthlyOccurrenceWeeks(
  startWeek: number,
  weeks: number,
  weekDates?: readonly string[] | null,
): number[] {
  if (weeks <= 0) return [];
  const start = Math.max(0, Math.min(weeks - 1, Math.floor(startWeek)));
  if (weekDates && weekDates.length >= weeks && weekDates[start]) {
    const calendar = calendarMonthWeeks(start, weeks, weekDates);
    if (calendar.length > 0) return calendar;
  }
  return steppedMonthWeeks(start, weeks);
}

/** No week dates: about every 30 days, so week 1 hits indexes 0, 4 and 9. */
function steppedMonthWeeks(start: number, weeks: number): number[] {
  const out: number[] = [];
  for (let month = 0; ; month++) {
    const index = start + Math.round((month * 30) / 7);
    if (index >= weeks) break;
    if (out.length === 0 || out[out.length - 1] !== index) out.push(index);
  }
  return out;
}

function calendarMonthWeeks(start: number, weeks: number, weekDates: readonly string[]): number[] {
  const horizonStart = parseIso(weekDates[0] ?? "");
  const anchor = parseIso(weekDates[start] ?? "");
  if (!horizonStart || !anchor) return [];
  const horizonEnd = horizonStart.getTime() + weeks * 7 * DAY_MS;
  const day = anchor.getUTCDate();
  const out: number[] = [];
  for (let month = 0; ; month++) {
    const hit = addMonthsClamped(anchor, month, day);
    if (hit.getTime() >= horizonEnd) break;
    if (hit.getTime() < horizonStart.getTime()) continue;
    const index = Math.floor((hit.getTime() - horizonStart.getTime()) / (7 * DAY_MS));
    if (index >= weeks) break;
    if (index < 0) continue;
    if (out.length === 0 || out[out.length - 1] !== index) out.push(index);
  }
  return out;
}

function parseIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonthsClamped(anchor: Date, months: number, day: number): Date {
  const monthIndex = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last)));
}
