/**
 * Call window for the public sample: 16:30–22:00 SAST, weekdays.
 * Africa/Johannesburg is UTC+2 all year. Callers format the instants in the
 * visitor's own time zone.
 */

export const CALL_ZONE = "Africa/Johannesburg";
export const CALL_OPEN_MINUTES = 16 * 60 + 30;
export const CALL_CLOSE_MINUTES = 22 * 60;
export const CALL_SLOT_MINUTES = 30;
export const CALL_WEEKDAYS = 5;
const JOHANNESBURG_OFFSET_MINUTES = 2 * 60;

export type CallSlot = {
  start: Date;
  end: Date;
};

type Ymd = { year: number; month: number; day: number };

function johannesburgClock(instant: Date): Ymd & { minutes: number } {
  const shifted = new Date(instant.getTime() + JOHANNESBURG_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function weekdayOf(date: Ymd): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function nextDate(date: Ymd): Ymd {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day) + 24 * 60 * 60_000);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function atJohannesburg(date: Ymd, minutes: number): Date {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, hours, mins) -
      JOHANNESBURG_OFFSET_MINUTES * 60_000,
  );
}

export function callSlots(now: Date, weekdays = CALL_WEEKDAYS): CallSlot[] {
  const slots: CallSlot[] = [];
  let date: Ymd = johannesburgClock(now);
  let counted = 0;
  for (let guard = 0; guard < 21 && counted < weekdays; guard += 1) {
    const weekend = weekdayOf(date) === 0 || weekdayOf(date) === 6;
    if (!weekend) {
      const daySlots: CallSlot[] = [];
      for (
        let minute = CALL_OPEN_MINUTES;
        minute < CALL_CLOSE_MINUTES;
        minute += CALL_SLOT_MINUTES
      ) {
        const start = atJohannesburg(date, minute);
        if (start.getTime() <= now.getTime()) continue;
        daySlots.push({
          start,
          end: new Date(start.getTime() + CALL_SLOT_MINUTES * 60_000),
        });
      }
      const today = johannesburgClock(now);
      const isToday =
        date.year === today.year && date.month === today.month && date.day === today.day;
      if (daySlots.length > 0 || !isToday) {
        slots.push(...daySlots);
        counted += 1;
      }
    }
    date = nextDate(date);
  }
  return slots;
}

export function isOfferedSlot(startIso: string, now: Date): CallSlot | null {
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return null;
  return callSlots(now).find((slot) => slot.start.getTime() === startMs) ?? null;
}

export function safeTimeZone(value: string | null | undefined): string {
  const zone = (value ?? "").trim();
  if (!zone || zone.length > 80 || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) return "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "UTC";
  }
}

export function formatSlotDay(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(start);
}

export function formatSlotClock(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

/** Stable 24-hour clock for tests and founder mail. */
export function formatSlotClock24(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(start);
}
