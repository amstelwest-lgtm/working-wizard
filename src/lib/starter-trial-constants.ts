/**
 * Trial copy with no imports.
 * Edge functions load this file by URL. Importing stripe-plans.ts from that
 * graph pulls app aliases the Deno bundle cannot resolve.
 */

export const FIRM_TRIAL_DAYS = 14;
export const FIRM_TRIAL_CLIENT_LIMIT = 5;
export const FIRM_TRIAL_SENTENCE = `${FIRM_TRIAL_DAYS}-day free trial · up to ${FIRM_TRIAL_CLIENT_LIMIT} clients`;
/** Asked at the pre-card wall, after the first result. Not at signup. */
export const FIRM_TRIAL_CARD_NOTE = "You add a card once you have seen your first result.";
export const FIRM_TRIAL_CARD_LINE = `${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE}`;

export const STARTER_TRIAL_ENDED_MESSAGE = "Your trial has ended, choose a plan";

export const STARTER_TRIAL_ENDED_CODE = "starter_trial_ended";

/**
 * Deploy date for the no-plan 14-day clock. Firms created before this get a
 * fresh 14 days from here. Firms created after it run from signup. Change
 * this one string to move the cutover.
 */
export const TRIAL_CLOCK_CUTOVER = "2026-10-21";

const MS_DAY = 86_400_000;

function parseInstant(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    return ms;
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * When a no-plan trial starts. A QA override replaces max(created_at, cutover).
 * A missing created_at does not invent a start. An unreadable override does not
 * either: the clock falls back to the firm row and the cutover.
 */
export function noPlanTrialStartMs(
  createdAt: string | number | null | undefined,
  cutover: string = TRIAL_CLOCK_CUTOVER,
  startOverride?: string | number | null,
): number | null {
  const overrideMs = parseInstant(startOverride);
  if (overrideMs != null) return overrideMs;
  const created = parseInstant(createdAt);
  if (created == null) return null;
  const cutoverMs = parseInstant(cutover);
  if (cutoverMs == null) return created;
  return Math.max(created, cutoverMs);
}

/** End of a no-plan trial that started at `startMs`. The same instant the banner uses. */
export function noPlanTrialEndMs(startMs: number): number {
  return startMs + FIRM_TRIAL_DAYS * MS_DAY;
}
