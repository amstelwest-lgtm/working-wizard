import type { OwnerEntitlement, StartOwnerCheckoutResult } from "@/lib/owner-billing";

export type OwnerSubscribeView =
  | { kind: "pending" }
  | { kind: "subscribe" }
  | { kind: "manage" }
  | { kind: "covered"; firmName: string }
  | { kind: "unavailable" };

export const OWNER_SUBSCRIBE_LABEL = "Subscribe";
export const OWNER_MANAGE_LABEL = "Manage billing";
export const OWNER_UNAVAILABLE_LINE = "Subscriptions open shortly";
export const OWNER_PLAN_FREE_LINE = "Free when your accountant joins Milōn";
export const OWNER_PLAN_INVITE_LABEL = "Invite your accountant";
export const OWNER_PLAN_BENEFITS = [
  "Three Milōn agents watching your books",
  "Cash forecast and budget",
  "Next moves",
  "The accountant portal",
] as const;

export function ownerCoveredLine(firmName: string): string {
  const who = firmName.trim() || "Your accountant";
  return `Included, ${who} covers your plan`;
}

export function ownerCheckoutReturnCopy(kind: "success" | "cancel"): string {
  if (kind === "cancel") return "Nothing was charged.";
  return "Payment received. Your plan updates in a moment.";
}

/**
 * Plan and Settings action. An accountant-covered owner has no Subscribe
 * button and no checkout CTA, even when the entitlement read still says
 * subscribe.
 */
export function ownerPlanBillingView(input: {
  accountantOnMilon: boolean;
  firmName: string | null;
  billing: OwnerSubscribeView;
}): OwnerSubscribeView {
  if (!input.accountantOnMilon) return input.billing;
  if (input.billing.kind === "covered") return input.billing;
  return { kind: "covered", firmName: input.firmName?.trim() || "" };
}

/** What the plan page shows. Firm coverage and an unavailable price have no button. */
export function ownerSubscribeView(input: {
  entitlement: OwnerEntitlement | null;
  checkout: StartOwnerCheckoutResult | null;
}): OwnerSubscribeView {
  const checkout = input.checkout;
  if (checkout?.status === "owner_price_unavailable") return { kind: "unavailable" };
  if (checkout?.status === "covered_by_firm") {
    return { kind: "covered", firmName: checkout.firm_name };
  }
  const entitlement = input.entitlement;
  if (!entitlement) return { kind: "pending" };
  if (entitlement.source === "firm" || entitlement.status === "covered_by_firm") {
    return { kind: "covered", firmName: entitlement.firmName ?? "" };
  }
  if (entitlement.source === "stripe" && entitlement.entitled) return { kind: "manage" };
  return { kind: "subscribe" };
}

export function ownerCheckoutHref(result: StartOwnerCheckoutResult): string | null {
  if (result.status === "checkout" || result.status === "portal") return result.url;
  return null;
}
