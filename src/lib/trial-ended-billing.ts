/**
 * Plan & billing, the same destinations the Settings menu already uses.
 * Practice firm billing lives on Settings. The owner door opens Plan.
 */
export type TrialEndedBillingAudience = "accountant" | "owner";

export const TRIAL_ENDED_BILLING_LABEL = "Plan & billing";

export function trialEndedBillingHref(audience: TrialEndedBillingAudience): string {
  return audience === "owner" ? "/app?screen=plan" : "/settings#firm-billing";
}
