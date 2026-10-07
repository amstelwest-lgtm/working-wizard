/**
 * Firm-product Stripe entitlement (live API by customer email).
 * Stripe Dashboard is source of truth until a webhook writes a local row.
 *
 * Owner Spark and invited firm staff (non-owners) are not billed on their
 * own email. The firm owner must complete Checkout. A trialing subscription
 * (14-day card-on-file trial) entitles the firm product. When the trial ends
 * unpaid or canceled, status is no longer active/trialing and the
 * billing/required resume path applies.
 *
 * An active $0 Starter subscription (no Stripe trial_end) also entitles the
 * product, so an expired Starter keeps read access. The 14-day work gate
 * (no new clients, packs, or deliverables) is starterTrialClock plus
 * firms.starter_trial_enforced, not this status check.
 */

import { isPreInsightWorkspacePath } from "@/lib/funnel-timing";

export const ENTITLING_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;
export type EntitlingSubscriptionStatus = (typeof ENTITLING_SUBSCRIPTION_STATUSES)[number];

export type FirmBillingReason =
  | "active_subscription"
  | "firm_member"
  | "stripe_unconfigured"
  | "no_active_subscription"
  | "stripe_error";

export type FirmBillingEntitlement = {
  entitled: boolean;
  reason: FirmBillingReason;
};

export type FirmBillingPathDecision = "allow" | "require_billing";

/** Stripe-like subset used by tests — no secret key, no SDK import. */
export type StripeCustomerSubscriptionReader = {
  customers: {
    list: (params: { email: string; limit: number }) => Promise<{ data: Array<{ id: string }> }>;
  };
  subscriptions: {
    list: (params: {
      customer: string;
      status: string;
      limit: number;
    }) => Promise<{ data: Array<{ id: string; status?: string }> }>;
  };
};

export function subscriptionStatusEntitles(
  status: string | null | undefined,
): status is EntitlingSubscriptionStatus {
  return status === "active" || status === "trialing";
}

/**
 * Checkout success. A trial session completes with no_payment_required
 * because the first invoice is $0; the card is still collected.
 */
export function checkoutSessionUnlocksFirm(session: {
  status?: string | null;
  paymentStatus?: string | null;
}): boolean {
  if (session.status === "complete") return true;
  if (session.paymentStatus === "paid") return true;
  if (session.paymentStatus === "no_payment_required") return true;
  return false;
}

export function isBillingExemptPath(pathname: string): boolean {
  return pathname === "/billing" || pathname.startsWith("/billing/");
}

export function isOwnerSparkPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function isOpsPath(pathname: string): boolean {
  return pathname === "/ops" || pathname.startsWith("/ops/");
}

/**
 * Accountant / firm product UI — gated until the firm owner has an
 * entitling Stripe subscription. Shared `/settings` stays open so owners
 * can still use Spark settings and so a firm can open Customer Portal.
 */
export function isFirmProductPath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/clients") ||
    pathname.startsWith("/reports") ||
    pathname === "/settings/team" ||
    pathname.startsWith("/settings/team/") ||
    pathname === "/settings/brand" ||
    pathname.startsWith("/settings/brand/")
  );
}

export async function customerHasEntitlingSubscription(
  stripe: StripeCustomerSubscriptionReader,
  customerId: string,
): Promise<boolean> {
  for (const status of ENTITLING_SUBSCRIPTION_STATUSES) {
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status,
      limit: 1,
    });
    if (listed.data.length > 0) return true;
  }
  return false;
}

export async function findCustomerIdByEmail(
  stripe: StripeCustomerSubscriptionReader,
  email: string,
): Promise<string | undefined> {
  const trimmed = email.trim();
  if (!trimmed) return undefined;
  const listed = await stripe.customers.list({ email: trimmed, limit: 1 });
  return listed.data[0]?.id;
}

export async function emailHasEntitlingSubscription(
  stripe: StripeCustomerSubscriptionReader,
  email: string,
): Promise<boolean> {
  const customerId = await findCustomerIdByEmail(stripe, email);
  if (!customerId) return false;
  return customerHasEntitlingSubscription(stripe, customerId);
}

/**
 * Whether the signed-in identity may use the firm product.
 * Invited staff inherit the firm's billing (they are not the Stripe customer).
 */
export function decideFirmBillingEntitlement(input: {
  stripeConfigured: boolean;
  hasEntitlingSubscription: boolean;
  ownsFirm: boolean;
  isFirmMember: boolean;
}): FirmBillingEntitlement {
  if (!input.stripeConfigured) {
    return { entitled: true, reason: "stripe_unconfigured" };
  }
  if (input.hasEntitlingSubscription) {
    return { entitled: true, reason: "active_subscription" };
  }
  if (!input.ownsFirm && input.isFirmMember) {
    return { entitled: true, reason: "firm_member" };
  }
  return { entitled: false, reason: "no_active_subscription" };
}

export type PostLoginBillingResume = "billing_start" | "billing_required" | "workspace";

/**
 * After sign-in from firm signup / pricing, unpaid firm owners go to the
 * practice workspace until they have seen an insight, then Checkout.
 * Pending checkout still wins over the owner Spark board.
 * Owner-door sign-in without a pending firm band must not steal Spark.
 * `insightSeen` omitted keeps the previous Checkout resume (callers that
 * have not been updated). Pass the live flag to defer.
 */
export function decidePostLoginBillingResume(input: {
  hasPendingFirmCheckout: boolean;
  ownsFirm: boolean;
  resumeFirmBilling: boolean;
  insightSeen?: boolean;
}): PostLoginBillingResume | null {
  const insightSeen = input.insightSeen !== false;
  if (!insightSeen) {
    if (input.hasPendingFirmCheckout || (input.resumeFirmBilling && input.ownsFirm)) {
      return "workspace";
    }
    return null;
  }
  if (input.hasPendingFirmCheckout) return "billing_start";
  if (input.resumeFirmBilling && input.ownsFirm) return "billing_required";
  return null;
}

export function decideFirmBillingPathGate(input: {
  pathname: string;
  isAccountantFirmUser: boolean;
  isMilonItMember: boolean;
  entitled: boolean;
  /**
   * When false, dashboard and client workspace stay open so the accountant
   * can reach an insight before Checkout. Omitted still requires billing.
   */
  insightSeen?: boolean;
}): FirmBillingPathDecision {
  if (isBillingExemptPath(input.pathname)) return "allow";
  if (isOwnerSparkPath(input.pathname)) return "allow";
  if (isOpsPath(input.pathname)) return "allow";
  if (!isFirmProductPath(input.pathname)) return "allow";
  if (input.isMilonItMember) return "allow";
  if (!input.isAccountantFirmUser) return "allow";
  if (input.entitled) return "allow";
  if (input.insightSeen === false && isPreInsightWorkspacePath(input.pathname)) return "allow";
  return "require_billing";
}
