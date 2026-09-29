/**
 * Pure client-cap decisions for firm billing.
 * Trial (status trialing): 3 clients, whatever paid band Checkout started.
 * Paid (status active): that band's catalog limit.
 */

import {
  FIRM_BAND_CATALOG,
  FIRM_TRIAL_CLIENT_LIMIT,
  FIRM_TRIAL_SENTENCE,
  isFirmBandId,
  type FirmBandId,
} from "@/lib/stripe-plans";

export type FirmSubscriptionPhase = "trialing" | "active" | "none";

export type FirmClientCreateBlockCode = "trial_client_cap" | "band_client_cap";

export type FirmClientCreateDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: FirmClientCreateBlockCode;
      message: string;
      bandName: string | null;
    };

export type FirmClientCreateAllowance = FirmClientCreateDecision & {
  /** Actor's email is the Stripe customer, so they can end the trial now. */
  canEndTrial: boolean;
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
}): FirmClientCreateDecision {
  if (!input.stripeConfigured) return { allowed: true };

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
