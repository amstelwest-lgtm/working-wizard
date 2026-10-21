/**
 * Pure client-cap decisions for firm billing.
 * Trial (status trialing): Starter's cap on every band.
 * Paid (status active): that band's catalog limit.
 */

import {
  STARTER_TRIAL_ENDED_MESSAGE,
  idleStarterTrialBanner,
  type StarterTrialBanner,
} from "./firm-starter-trial";
import { formatDate } from "./market/format.ts";
import { marketForFirm } from "./market/scope.ts";
import {
  FIRM_BAND_CATALOG,
  FIRM_TRIAL_CLIENT_LIMIT,
  FIRM_TRIAL_SENTENCE,
  firmClientLimitLabel,
  isFirmBandId,
  starterClientLimit,
  type FirmBandId,
  type FirmInterval,
} from "./stripe-plans";

export type FirmSubscriptionPhase = "trialing" | "active" | "none";

export type FirmClientCreateBlockCode =
  | "trial_client_cap"
  | "band_client_cap"
  | "starter_trial_ended"
  | "billing_required";

export { idleStarterTrialBanner, type StarterTrialBanner };

export type FirmClientCreateDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: FirmClientCreateBlockCode;
      message: string;
      bandName: string | null;
    };

/** Band list payload for Add client. Kept here so the cap module does not import the upgrade module. */
export type FirmUpgradeAllowance = {
  canUpgrade: boolean;
  band: FirmBandId | null;
  phase: FirmSubscriptionPhase;
  clientCount: number;
  clientLimit: number | null;
  usageLabel: string;
  priceCurrency: "USD" | "zar";
  interval: FirmInterval;
  zarByBand: Partial<Record<FirmBandId, { month: number | null; year: number | null }>>;
  /** Practice list is in rand. Not the Checkout charge currency. */
  saDiscount: boolean;
  zaLabels?: Partial<Record<FirmBandId, { month: string; year: string }>> | null;
  zaPriceLabel?: string | null;
};

export type FirmClientCreateAllowance = FirmClientCreateDecision & {
  /** Actor's email is the Stripe customer, so they can end the trial now. */
  canEndTrial: boolean;
  /** Present when the cap check loaded the firm. Absent on the unconfigured fallback. */
  upgrade?: FirmUpgradeAllowance;
  /** Idle when the firm is exempt, not on Starter, or Stripe is not configured. */
  starterTrial: StarterTrialBanner;
};

export function phaseFromSubscriptionStatus(
  status: string | null | undefined,
): FirmSubscriptionPhase {
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  return "none";
}

export function bandIdFromStripeMetadata(
  metadata: { milon_plan?: string | null } | null | undefined,
): FirmBandId | null {
  const raw = metadata?.milon_plan?.trim().toLowerCase();
  if (!raw || !isFirmBandId(raw)) return null;
  return raw;
}

/**
 * A first firm subscription gets the intro trial. Any prior subscription
 * (including a canceled or unpaid trial) does not get another 14 days.
 */
export function eligibleForIntroTrial(priorSubscriptionCount: number): boolean {
  return priorSubscriptionCount <= 0;
}

/**
 * Trial-ended copy applies only when the trial is the subscription state.
 * An active (CURRENT) plan, including paid or legacy Starter, is not that state.
 */
export function showStarterTrialEndedCopy(
  phase: FirmSubscriptionPhase | null | undefined,
  expired: boolean | null | undefined,
): boolean {
  if (!expired) return false;
  return phase !== "active";
}

/** Drop the ended flag when the live subscription is already the current plan. */
export function starterTrialForPlanState(
  phase: FirmSubscriptionPhase | null | undefined,
  clock: StarterTrialBanner,
): StarterTrialBanner {
  if (phase === "active") return { ...clock, expired: false, showCountdown: false };
  return clock;
}

function bandClientCapMessage(name: string, clientLimit: number, starter: boolean): string {
  if (starter) {
    return `You can't add another client on Starter. Starter includes up to ${clientLimit} active clients. Upgrade to Solo to add another.`;
  }
  return `${name} includes up to ${clientLimit} active clients. Upgrade to a larger band to add another.`;
}

export function decideFirmClientCreate(input: {
  /** Local deploys without a Stripe key do not invent a cap. */
  stripeConfigured: boolean;
  phase: FirmSubscriptionPhase;
  band: FirmBandId | null;
  clientCount: number;
  /**
   * Billed price unit_amount. 0 keeps the legacy $0 Starter cap.
   * Omitted means the catalog limit (paid Starter is 5).
   */
  unitAmount?: number | null;
  /**
   * Enforced Starter past day 14. Omitted means the caller is not applying
   * the clock (existing firms, paid bands, or a missing start).
   * Ignored when `phase` is active: that subscription is the current plan.
   */
  starterTrialExpired?: boolean;
  /**
   * firms.starter_trial_enforced. A card-free (phase none) enforced firm
   * may add the first client, then must start a trial before the next one.
   * A Stripe trial still uses the 5-client cap.
   */
  noPlanTrialEnforced?: boolean;
}): FirmClientCreateDecision {
  if (!input.stripeConfigured) return { allowed: true };

  if (showStarterTrialEndedCopy(input.phase, input.starterTrialExpired)) {
    return {
      allowed: false,
      code: "starter_trial_ended",
      bandName: input.band ? FIRM_BAND_CATALOG[input.band].name : "Starter",
      message: STARTER_TRIAL_ENDED_MESSAGE,
    };
  }

  // Card-free enforced firm: the first client can be created. Another one
  // goes to the Start trial wall instead of inserting a row.
  if (input.noPlanTrialEnforced === true && input.phase === "none") {
    if (input.clientCount >= 1) {
      return {
        allowed: false,
        code: "billing_required",
        bandName: "Starter",
        message: "Start a trial before adding another client.",
      };
    }
    return { allowed: true };
  }

  // Fail closed on an enforced firm whose band could not be read. A Stripe
  // trial keeps the 5-client cap.
  const enforcedUnknownPlan =
    input.noPlanTrialEnforced === true &&
    input.phase === "active" &&
    !(input.band && isFirmBandId(input.band));
  if (input.phase === "trialing" || enforcedUnknownPlan) {
    const trialLimit = FIRM_TRIAL_CLIENT_LIMIT;
    if (input.clientCount >= trialLimit) {
      const bandName = input.band ? FIRM_BAND_CATALOG[input.band].name : "Starter";
      return {
        allowed: false,
        code: "trial_client_cap",
        bandName,
        message: `${FIRM_TRIAL_SENTENCE} on Starter. This practice has reached the ${trialLimit}-client trial limit.`,
      };
    }
    return { allowed: true };
  }

  if (input.phase === "active" && input.band && isFirmBandId(input.band)) {
    const band = FIRM_BAND_CATALOG[input.band];
    const clientLimit =
      band.id === "starter" ? FIRM_BAND_CATALOG.starter.clientLimit : band.clientLimit;
    if (clientLimit == null) return { allowed: true };
    if (input.clientCount >= clientLimit) {
      return {
        allowed: false,
        code: "band_client_cap",
        bandName: band.name,
        message: bandClientCapMessage(band.name, clientLimit, band.id === "starter"),
      };
    }
  }

  return { allowed: true };
}

/** Add client leaves the drawer for the Start trial wall. Other blocks stay on the cap card. */
export function firmAddClientDestination(
  decision: FirmClientCreateDecision,
): "/billing/required" | null {
  if (decision.allowed || decision.code !== "billing_required") return null;
  return "/billing/required";
}

export type FirmPlanStatusCopy = {
  phase: FirmSubscriptionPhase;
  band: FirmBandId | null;
  /** Primary line, e.g. "Trial — 9 days left" or "Solo". Null when Stripe is not configured. */
  headline: string | null;
  /** Secondary line. Trial uses the trial client cap, not the paid band's limit. */
  detail: string | null;
  /** Calendar date from Stripe trial_end. Null when there is no trial end to show. */
  trialEndsOn: string | null;
  /** Calendar date from Stripe current_period_end. Null unless the plan is active and Stripe sent a period end. */
  renewsOn: string | null;
};

/**
 * Settings billing line. Only a real trial end date is shown.
 * Missing subscription data returns null so the page does not invent a date.
 */
export function firmTrialStatusLine(input: {
  phase: FirmSubscriptionPhase | null | undefined;
  trialEndsOn: string | null | undefined;
}): string | null {
  if (input.phase !== "trialing") return null;
  const date = input.trialEndsOn?.trim();
  if (!date) return null;
  return `Free trial · ends ${date}`;
}

/**
 * Settings line for a paid plan. Null when the phase is not active or Stripe
 * did not send current_period_end, so the page does not invent a renewal date.
 */
export function firmRenewalStatusLine(input: {
  phase: FirmSubscriptionPhase | null | undefined;
  renewsOn: string | null | undefined;
}): string | null {
  if (input.phase !== "active") return null;
  const date = input.renewsOn?.trim();
  if (!date) return null;
  return `Renews ${date}`;
}

/** Date label for a Stripe trial end, in the firm's market. Null when the timestamp is missing. */
export function trialEndDateLabel(
  trialEndIso: string | null | undefined,
  market: { locale?: string | null; timezone?: string },
): string | null {
  if (!trialEndIso) return null;
  const end = Date.parse(trialEndIso);
  if (!Number.isFinite(end)) return null;
  const label = formatDate(end, market);
  return label === "—" ? null : label;
}

export type FirmPlanDisplay = FirmPlanStatusCopy & {
  configured: boolean;
  clientCount: number | null;
  clientLimit: number | null;
  /** e.g. "8 active clients · Starter limit 5". Null when the plan could not be loaded. */
  usageLabel: string | null;
  canUpgrade: boolean;
  priceCurrency: "USD" | "zar";
  interval: FirmInterval;
  zarByBand: Partial<Record<FirmBandId, { month: number | null; year: number | null }>>;
  starterTrial: StarterTrialBanner;
  /** True when this billing customer has never had a Stripe subscription. */
  introTrialEligible: boolean;
  saDiscount: boolean;
  zaLabels?: Partial<Record<FirmBandId, { month: string; year: string }>> | null;
  zaPriceLabel?: string | null;
};

/** Whole days until `trialEndIso`. 0 when the trial end is now or in the past. */
export function trialDaysRemaining(
  trialEndIso: string | null | undefined,
  now = new Date(),
): number | null {
  if (!trialEndIso) return null;
  const end = Date.parse(trialEndIso);
  if (!Number.isFinite(end)) return null;
  const diff = end - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86_400_000);
}

/**
 * Read-only plan line for Settings. A trial is Starter's cap on every band,
 * not the paid band's larger limit.
 */
export function formatFirmPlanStatus(input: {
  phase: FirmSubscriptionPhase;
  band: FirmBandId | null;
  trialEndIso?: string | null;
  /** Stripe current_period_end. Shown only for an active plan. */
  periodEndIso?: string | null;
  now?: Date;
  market?: { locale?: string | null; timezone?: string };
}): FirmPlanStatusCopy {
  const band = input.band && isFirmBandId(input.band) ? input.band : null;
  const bandName = band ? FIRM_BAND_CATALOG[band].name : null;
  const market = input.market ?? marketForFirm(null);

  if (input.phase === "trialing") {
    const days = trialDaysRemaining(input.trialEndIso, input.now);
    const headline =
      days == null
        ? "Trial"
        : days <= 0
          ? "Trial — ends today"
          : `Trial — ${days} day${days === 1 ? "" : "s"} left`;
    const detail = `Starter · ${FIRM_TRIAL_SENTENCE}`;
    return {
      phase: "trialing",
      band,
      headline,
      detail,
      trialEndsOn: trialEndDateLabel(input.trialEndIso, market),
      renewsOn: null,
    };
  }

  if (input.phase === "active") {
    return {
      phase: "active",
      band,
      headline: bandName ?? "Paid plan",
      detail: band ? firmClientLimitLabel(band) : null,
      trialEndsOn: null,
      renewsOn: trialEndDateLabel(input.periodEndIso, market),
    };
  }

  return {
    phase: "none",
    band: null,
    headline: "No active plan",
    detail: null,
    trialEndsOn: null,
    renewsOn: null,
  };
}
