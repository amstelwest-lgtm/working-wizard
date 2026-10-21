/**
 * Open-path billing answer from firms.billing_plan_known.
 * Stripe is not called while the in-process stamp is inside the window.
 * There is no stored timestamp column. Do not add one for this.
 */

import { emptyFirmUpgradeSnapshot } from "@/lib/firm-band-upgrade";
import type { StoredFirmPlan } from "@/lib/billing-check-failure";
import {
  formatFirmPlanStatus,
  idleStarterTrialBanner,
  type FirmClientCreateAllowance,
  type FirmPlanDisplay,
} from "@/lib/firm-client-cap";
import type { FirmBillingEntitlement } from "@/lib/stripe-entitlement";

/** Inside 10–15 minutes. One Stripe refresh per firm per process, at most. */
export const FIRM_BILLING_STRIPE_REFRESH_MS = 12 * 60 * 1000;

const refreshedAt = new Map<string, number>();

export type FirmBillingOpenResult = FirmBillingEntitlement & {
  plan?: FirmPlanDisplay;
  allowance?: FirmClientCreateAllowance;
};

export function firmBillingStripeRefreshDue(firmId: string | null | undefined, now = Date.now()): boolean {
  const id = firmId?.trim() ?? "";
  if (!id) return false;
  const at = refreshedAt.get(id);
  if (at == null) return false;
  return now - at >= FIRM_BILLING_STRIPE_REFRESH_MS;
}

export function noteFirmBillingStripeRefresh(firmId: string | null | undefined, now = Date.now()): void {
  const id = firmId?.trim() ?? "";
  if (!id) return;
  refreshedAt.set(id, now);
}

export function resetFirmBillingStripeRefreshForTests(): void {
  refreshedAt.clear();
}

export function setFirmBillingStripeRefreshForTests(firmId: string, at: number): void {
  const id = firmId.trim();
  if (!id) return;
  refreshedAt.set(id, at);
}

/** Entitlement, plan line, and add-client allowance from the stored plan only. */
export function entitlementFromStoredPlan(plan: StoredFirmPlan): FirmBillingOpenResult {
  const phase = plan === "entitled" ? "active" : "none";
  const upgrade = {
    ...emptyFirmUpgradeSnapshot(),
    phase,
    band: null,
    canUpgrade: false,
  };
  const allowance: FirmClientCreateAllowance = {
    allowed: true,
    canEndTrial: false,
    starterTrial: idleStarterTrialBanner(),
    upgrade,
  };
  return {
    entitled: plan === "entitled",
    reason: plan === "entitled" ? "active_subscription" : "no_active_subscription",
    plan: {
      configured: true,
      ...formatFirmPlanStatus({ phase, band: null }),
      clientCount: null,
      clientLimit: null,
      usageLabel: null,
      canUpgrade: false,
      priceCurrency: "USD",
      interval: "month",
      zarByBand: {},
      starterTrial: idleStarterTrialBanner(),
      introTrialEligible: false,
      saDiscount: false,
      zaLabels: null,
      zaPriceLabel: null,
    },
    allowance,
  };
}
