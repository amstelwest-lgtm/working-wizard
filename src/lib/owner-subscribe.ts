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

export function ownerCoveredLine(firmName: string): string {
  const who = firmName.trim() || "Your accountant";
  return `Included, ${who} covers your plan`;
}

export function ownerCheckoutReturnCopy(kind: "success" | "cancel"): string {
  if (kind === "cancel") return "Nothing was charged.";
  return "Payment received. Your plan updates in a moment.";
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
