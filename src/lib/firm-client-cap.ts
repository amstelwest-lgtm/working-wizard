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
  | "starter_trial_ended";

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
  /** Server-derived. False for every non-SA firm. */
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

  if (input.phase === "trialing") {
    const trialLimit = FIRM_TRIAL_CLIENT_LIMIT;
    if (input.clientCount >= trialLimit) {
      const bandName = input.band ? FIRM_BAND_CATALOG[input.band].name : "Starter";
      return {
        allowed: false,
        code: "trial_client_cap",
        bandName,
        message: `${FIRM_TRIAL_SENTENCE} on Starter. This practice already has ${trialLimit} clients.`,
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

export type FirmPlanStatusCopy = {
  phase: FirmSubscriptionPhase;
  band: FirmBandId | null;
  /** Primary line, e.g. "Trial — 9 days left" or "Solo". Null when Stripe is not configured. */
  headline: string | null;
  /** Secondary line. Trial uses the trial client cap, not the paid band's limit. */
  detail: string | null;
  /** Calendar date from Stripe trial_end. Null when there is no trial end to show. */
  trialEndsOn: string | null;
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

/** Date label for a Stripe trial end. Null when the timestamp is missing. */
export function trialEndDateLabel(trialEndIso: string | null | undefined): string | null {
  if (!trialEndIso) return null;
  const end = Date.parse(trialEndIso);
  if (!Number.isFinite(end)) return null;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(end));
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
  now?: Date;
}): FirmPlanStatusCopy {
  const band = input.band && isFirmBandId(input.band) ? input.band : null;
  const bandName = band ? FIRM_BAND_CATALOG[band].name : null;

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
      trialEndsOn: trialEndDateLabel(input.trialEndIso),
    };
  }

  if (input.phase === "active") {
    return {
      phase: "active",
      band,
      headline: bandName ?? "Paid plan",
      detail: band ? firmClientLimitLabel(band) : null,
      trialEndsOn: null,
    };
  }

  return { phase: "none", band: null, headline: "No active plan", detail: null, trialEndsOn: null };
}
