/**
 * 14-day Starter clock. The product is not a forever-free plan.
 *
 * Applies only when the billed band is Starter and the firm has
 * starter_trial_enforced. End is Stripe trial_end when that timestamp
 * exists, otherwise subscription start + FIRM_TRIAL_DAYS. An unknown start
 * does not invent a block. This module does not write Stripe objects.
 */

import { FIRM_TRIAL_DAYS, type FirmBandId } from "./stripe-plans";
import {
  noPlanTrialEndMs,
  noPlanTrialStartMs,
  TRIAL_CLOCK_CUTOVER,
} from "./starter-trial-constants.ts";

export { STARTER_TRIAL_ENDED_MESSAGE, TRIAL_CLOCK_CUTOVER } from "./starter-trial-constants.ts";

const MS_DAY = 86_400_000;

/** Countdown banner starts on this day of the trial (1-based). */
export const STARTER_TRIAL_COUNTDOWN_FROM_DAY = 10;

export type StarterTrialBanner = {
  /** True only when the flag is on and the billed band is Starter. */
  enforced: boolean;
  expired: boolean;
  /** Day 10 through the day before expiry. */
  showCountdown: boolean;
  dayOfTrial: number | null;
  daysLeft: number | null;
  /** Enforced firm with no Stripe subscription. Trialing firms leave this unset. */
  cardFree?: boolean;
};

export function idleStarterTrialBanner(): StarterTrialBanner {
  return {
    enforced: false,
    expired: false,
    showCountdown: false,
    dayOfTrial: null,
    daysLeft: null,
  };
}

function parseInstant(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Unix seconds (Stripe) vs milliseconds (Date.now).
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
 * When a no-plan trial starts. Later of the firm row and the deploy cutover,
 * so a firm that already existed is not locked out on the day this ships.
 * A QA `startOverride` replaces that pair. A missing created_at does not
 * invent a start when the override is empty.
 */
export function noPlanTrialStart(
  createdAt: string | number | null | undefined,
  cutover: string = TRIAL_CLOCK_CUTOVER,
  startOverride?: string | number | null,
): number | null {
  return noPlanTrialStartMs(createdAt, cutover, startOverride);
}

/**
 * 14-day clock for a firm that has not started a subscription.
 * Exempt firms stay open. A firm that already has a plan uses
 * `starterTrialClock` instead. An unknown start does not invent a block.
 */
export function noPlanTrialClock(input: {
  enforced: boolean;
  /** True only when Stripe has no entitling subscription. */
  noPlan: boolean;
  /** Firm row created_at. Not a subscription start. */
  startedAt?: string | number | null;
  /**
   * QA clock start (`firms.trial_clock_start_override`). When set, this
   * replaces max(created_at, cutover). Null keeps the real clock.
   */
  startOverride?: string | number | null;
  now?: Date;
}): StarterTrialBanner {
  if (!input.enforced || !input.noPlan) return idleStarterTrialBanner();
  return {
    ...starterTrialClock({
      enforced: true,
      band: "starter",
      startedAt: noPlanTrialStart(input.startedAt, TRIAL_CLOCK_CUTOVER, input.startOverride),
      now: input.now,
    }),
    cardFree: true,
  };
}

/**
 * Trial clock for an active or trialing Starter subscription.
 * `enforced` is the per-firm pilot flag. Paid bands ignore it.
 */
export function starterTrialClock(input: {
  enforced: boolean;
  band: FirmBandId | null;
  /** Stripe trial_end, when the subscription has one. */
  stripeTrialEnd?: string | number | null;
  /** Stripe start_date, else created. */
  startedAt?: string | number | null;
  now?: Date;
}): StarterTrialBanner {
  if (!input.enforced || input.band !== "starter") return idleStarterTrialBanner();

  const now = (input.now ?? new Date()).getTime();
  const startedMs = parseInstant(input.startedAt);
  const stripeEndMs = parseInstant(input.stripeTrialEnd);
  const endMs = stripeEndMs ?? (startedMs == null ? null : noPlanTrialEndMs(startedMs));
  if (endMs == null) {
    return {
      enforced: true,
      expired: false,
      showCountdown: false,
      dayOfTrial: null,
      daysLeft: null,
    };
  }

  const expired = now >= endMs;
  const daysLeft = expired ? 0 : Math.ceil((endMs - now) / MS_DAY);
  const startForDay =
    startedMs ?? (stripeEndMs == null ? null : stripeEndMs - FIRM_TRIAL_DAYS * MS_DAY);
  const dayOfTrial = startForDay == null ? null : Math.floor((now - startForDay) / MS_DAY) + 1;
  const showCountdown =
    !expired && dayOfTrial != null && dayOfTrial >= STARTER_TRIAL_COUNTDOWN_FROM_DAY;

  return {
    enforced: true,
    expired,
    showCountdown,
    dayOfTrial,
    daysLeft,
  };
}

export function firmStarterTrialCountdownCopy(trial: StarterTrialBanner): string | null {
  if (!trial.showCountdown || trial.dayOfTrial == null || trial.daysLeft == null) return null;
  const days = `${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"}`;
  return `Trial day ${trial.dayOfTrial} of ${FIRM_TRIAL_DAYS} — ${days} left.`;
}
