/**
 * Pure client-cap decisions for firm billing.
 * Trial (status trialing): 3 clients, whatever paid band Checkout started.
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
  priceCurrency: "USD" | "ZAR";
  interval: FirmInterval;
  zarByBand: Partial<Record<FirmBandId, { month: number | null; year: number | null }>>;
  /** Server-derived. False for every non-SA firm. */
  saDiscount: boolean;
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

export function decideFirmClientCreate(input: {
  /** Local deploys without a Stripe key do not invent a cap. */
  stripeConfigured: boolean;
  phase: FirmSubscriptionPhase;
  band: FirmBandId | null;
  clientCount: number;
  /**
   * Enforced Starter past day 14. Omitted means the caller is not applying
   * the clock (existing firms, paid bands, or a missing start).
   */
  starterTrialExpired?: boolean;
}): FirmClientCreateDecision {
  if (!input.stripeConfigured) return { allowed: true };

  if (input.starterTrialExpired) {
    return {
      allowed: false,
      code: "starter_trial_ended",
      bandName: input.band ? FIRM_BAND_CATALOG[input.band].name : "Starter",
      message: STARTER_TRIAL_ENDED_MESSAGE,
    };
  }

  if (input.phase === "trialing") {
    if (input.clientCount >= FIRM_TRIAL_CLIENT_LIMIT) {
      return {
        allowed: false,
        code: "trial_client_cap",
        bandName: input.band ? FIRM_BAND_CATALOG[input.band].name : null,
        message: `${FIRM_TRIAL_SENTENCE}. This practice already has ${FIRM_TRIAL_CLIENT_LIMIT} clients. Upgrade to a paid plan to add another.`,
      };
    }
    return { allowed: true };
  }

  if (input.phase === "active" && input.band && isFirmBandId(input.band)) {
    const band = FIRM_BAND_CATALOG[input.band];
    if (band.clientLimit == null) return { allowed: true };
    if (input.clientCount >= band.clientLimit) {
      return {
        allowed: false,
        code: "band_client_cap",
        bandName: band.name,
        message: `${band.name} includes up to ${band.clientLimit} active clients. Upgrade to a larger band to add another.`,
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
};

export type FirmPlanDisplay = FirmPlanStatusCopy & {
  configured: boolean;
  clientCount: number | null;
  clientLimit: number | null;
  /** e.g. "3 of 3 clients". Null when the plan could not be loaded. */
  usageLabel: string | null;
  canUpgrade: boolean;
  priceCurrency: "USD" | "ZAR";
  interval: FirmInterval;
  zarByBand: Partial<Record<FirmBandId, { month: number | null; year: number | null }>>;
  starterTrial: StarterTrialBanner;
  saDiscount: boolean;
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
 * Read-only plan line for Settings. Trial copy uses `FIRM_TRIAL_CLIENT_LIMIT`
 * (the cap the billing gate enforces), not the paid band's larger limit.
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
    const cap = `Up to ${FIRM_TRIAL_CLIENT_LIMIT} clients`;
    const detail = bandName ? `${cap} · ${bandName} after the trial` : cap;
    return { phase: "trialing", band, headline, detail };
  }

  if (input.phase === "active") {
    return {
      phase: "active",
      band,
      headline: bandName ?? "Paid plan",
      detail: band ? firmClientLimitLabel(band) : null,
    };
  }

  return { phase: "none", band: null, headline: "No active plan", detail: null };
}
