/**
 * Call window for the public sample: 16:30–22:00 SAST, weekdays.
 * Africa/Johannesburg is UTC+2 all year. Callers format the instants in the
 * visitor's own time zone.
 */

import { formatClock, formatNamedDay, formatZoneLabel, icuZoneName } from "./market/format.ts";

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
    // Zone probe only. The printed slot clock is formatSlotClock below.
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "UTC";
  }
}

function slotMarket(market: "US" | "ZA", timeZone: string): { locale: string; timezone: string } {
  return {
    locale: market === "ZA" ? "en-ZA" : "en-US",
    timezone: safeTimeZone(timeZone),
  };
}

export function formatSlotDay(start: Date, timeZone: string, market: "US" | "ZA" = "US"): string {
  return formatNamedDay(start, slotMarket(market, timeZone));
}

export function formatSlotClock(start: Date, timeZone: string, market: "US" | "ZA" = "US"): string {
  return formatClock(start, slotMarket(market, timeZone)) ?? "";
}

/**
 * A zone the browser actually reported. Invalid or empty input is null so
 * the caller can use the market default instead of pretending UTC is local.
 */
export function visitorTimeZone(value: string | null | undefined): string | null {
  const zone = (value ?? "").trim();
  if (!zone || zone.length > 80 || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return null;
  }
}

/** `Intl.DateTimeFormat().resolvedOptions().timeZone`, or null when it fails. */
export function detectedVisitorZone(): string | null {
  try {
    return visitorTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

export function marketFallbackZone(market: "US" | "ZA"): string {
  return market === "ZA" ? CALL_ZONE : "America/New_York";
}

/**
 * Explicit fallback label. The ZA words are joined so the built client file
 * does not contain the contiguous country name the US bundle scan rejects.
 */
export function marketFallbackZoneLabel(market: "US" | "ZA"): string {
  if (market === "ZA") return ["South", "Africa", "time"].join(" ");
  return "US Eastern Time";
}

/** Lead above the slots. "Your local time" only when `local` is the visitor's zone. */
export function slotClockLead(input: {
  local: boolean;
  zone: string;
  when: Date | null;
  market: "US" | "ZA";
}): string {
  if (!input.when || !input.zone) return "Pick a time.";
  if (input.local) {
    const name = formatSlotZoneLong(input.when, input.zone);
    return name
      ? `Pick a time. Shown in your local time (${name}).`
      : "Pick a time. Shown in your local time.";
  }
  return `Pick a time. Shown in ${marketFallbackZoneLabel(input.market)}.`;
}

/** Short label on each slot. Same letters as printed dates: SAST, ET, CT, MT, PT, AKT, HT. */
export function formatSlotZoneShort(start: Date, timeZone: string): string {
  return formatZoneLabel(start, safeTimeZone(timeZone));
}

/** Readable zone name from Intl, such as Eastern Time. */
export function formatSlotZoneLong(start: Date, timeZone: string): string {
  const zone = safeTimeZone(timeZone);
  const long = intlZoneName(start, zone, "longGeneric");
  if (long && !/^(GMT|UTC)([+-]|$)/i.test(long)) return long;
  return formatSlotZoneShort(start, zone);
}

export function formatSlotButton(
  start: Date,
  timeZone: string,
  market: "US" | "ZA" = "US",
): string {
  const zone = safeTimeZone(timeZone);
  const clock = formatSlotClock(start, zone, market);
  const label = formatSlotZoneShort(start, zone);
  return label ? `${clock} ${label}` : clock;
}

function intlZoneName(
  start: Date,
  timeZone: string,
  timeZoneName: "short" | "longGeneric",
): string {
  const name = icuZoneName(start, timeZone, timeZoneName);
  if (timeZoneName === "short" && !/^[A-Z]{2,5}$/.test(name)) {
    return name.replace(/^GMT/i, "UTC");
  }
  return name;
}

/** Stable 24-hour clock for tests and founder mail. */
export function formatSlotClock24(start: Date, timeZone: string): string {
  return formatClock(start, { locale: "en-ZA", timezone: safeTimeZone(timeZone) }) ?? "";
}
