/**
 * Interval and start week for one 13-week cash line.
 * The labels match the forecast setup table. The engine already spreads
 * these five cadences; nothing else is offered.
 */
import type { WeekOverrides } from "./cash-week-overrides.ts";

export const CASH_LINE_FREQUENCIES = [
  "recurring-weekly",
  "recurring-monthly",
  "once-off",
  "split-weeks",
  "split-months",
] as const;

export type CashLineFrequency = (typeof CASH_LINE_FREQUENCIES)[number];

export const CASH_LINE_FREQUENCY_LABEL: Record<CashLineFrequency, string> = {
  "recurring-weekly": "Weekly",
  "recurring-monthly": "Monthly",
  "once-off": "Once-off",
  "split-weeks": "Split over weeks",
  "split-months": "Split over months",
};

const FREQUENCY_ALIAS: Record<string, CashLineFrequency> = {
  weekly: "recurring-weekly",
  "recurring-weekly": "recurring-weekly",
  monthly: "recurring-monthly",
  annual: "recurring-monthly",
  "recurring-monthly": "recurring-monthly",
  once: "once-off",
  "once-off": "once-off",
  split: "split-weeks",
  "split-weeks": "split-weeks",
  "split-months": "split-months",
};

export function normalizeCashLineFrequency(value: string | null | undefined): CashLineFrequency {
  return FREQUENCY_ALIAS[(value ?? "").trim()] ?? "recurring-monthly";
}

export function clampCashStartWeek(value: number, weeks = 13): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(weeks, Math.floor(value)));
}

export type CashLineSchedulePatch = {
  frequency?: string;
  startWeek?: number;
  splitCount?: number;
};

type ScheduledLine = {
  frequency: string;
  startWeek: number;
  splitCount?: number;
  weekOverrides?: WeekOverrides;
  /** The accountant chose this cadence. Display rules must not rewrite it. */
  scheduleExplicit?: boolean;
};

/**
 * Cadence that fills the 13 weeks. A choice made on the line wins.
 * Otherwise the caller passes the projected cadence (monthly rent, and so on).
 */
export function cashLineFillFrequency(
  line: { frequency?: string | null; scheduleExplicit?: boolean },
  projected: string,
): string {
  if (line.scheduleExplicit && line.frequency) return line.frequency;
  return projected;
}

/**
 * Write an interval or start week onto a line and drop week overrides.
 * Overrides are hand edits of single cells. A new cadence refills every week
 * from the line amount, the same way the setup table's frequency does.
 * An unchanged schedule returns the same line.
 */
export function applyCashLineSchedule<T extends ScheduledLine>(
  line: T,
  patch: CashLineSchedulePatch,
  weeks = 13,
): T {
  const frequency = normalizeCashLineFrequency(patch.frequency ?? line.frequency);
  const startWeek = clampCashStartWeek(patch.startWeek ?? line.startWeek, weeks);
  const splitCount =
    patch.splitCount != null
      ? Math.max(1, Math.floor(patch.splitCount) || 1)
      : Math.max(1, Math.floor(line.splitCount ?? 3) || 3);
  const unchanged =
    normalizeCashLineFrequency(line.frequency) === frequency &&
    clampCashStartWeek(line.startWeek, weeks) === startWeek &&
    Math.max(1, Math.floor(line.splitCount ?? 3) || 3) === splitCount;
  if (unchanged) return line;
  const next: T = { ...line, frequency, startWeek, splitCount };
  delete next.weekOverrides;
  if (patch.frequency != null || patch.splitCount != null) next.scheduleExplicit = true;
  return next;
}
