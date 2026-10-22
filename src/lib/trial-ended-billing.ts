/**
 * Plan & billing, the same destinations the Settings menu already uses.
 * Practice firm billing lives on Settings. An owner on their own plan opens Plan.
 * An owner linked to an accountant firm does not get that link. They see the
 * renewal note: the accountant chooses the plan.
 */
export type TrialEndedBillingAudience = "accountant" | "owner";

export const TRIAL_ENDED_BILLING_LABEL = "Plan & billing";

export function trialEndedBillingHref(audience: TrialEndedBillingAudience): string {
  return audience === "owner" ? "/app?screen=plan" : "/settings#firm-billing";
}

/** True when this owner is the client of an accountant firm, so the accountant pays. */
export function trialEndedOwnerAsksAccountant(
  audience: TrialEndedBillingAudience,
  firmId: string | null | undefined,
): boolean {
  return audience === "owner" && typeof firmId === "string" && firmId.trim().length > 0;
}
