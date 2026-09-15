/**
 * Paid-plan checkout intent that must survive signup / sign-in / Google.
 * Spark is free and never stored here.
 */

import { isStripePaidPlan, type StripePaidPlan, type StripePlanMarket } from "@/lib/stripe-plans";

export const PENDING_CHECKOUT_KEY = "milon_pending_checkout";

export type PendingCheckout = {
  plan: StripePaidPlan;
  market: StripePlanMarket;
};

export function parseStripePlanMarket(value: unknown): StripePlanMarket | null {
  return value === "za" || value === "us" ? value : null;
}

export function parsePendingCheckout(input: {
  plan?: unknown;
  market?: unknown;
  checkout?: unknown;
}): PendingCheckout | null {
  const rawPlan = input.plan ?? input.checkout;
  if (typeof rawPlan !== "string" || !isStripePaidPlan(rawPlan)) return null;
  const market = parseStripePlanMarket(input.market) ?? "us";
  return { plan: rawPlan, market };
}

export function parsePendingCheckoutFromSearch(search: string): PendingCheckout | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return parsePendingCheckout({
    plan: q.get("plan"),
    checkout: q.get("checkout"),
    market: q.get("market") ?? q.get("mkt"),
  });
}

export function billingStartPath(pending: PendingCheckout): string {
  const q = new URLSearchParams({ plan: pending.plan, market: pending.market });
  return `/billing/start?${q.toString()}`;
}

/**
 * Confirmation / magic-link redirect. `/billing/start` is not on the Supabase
 * Auth allowlist (see docs/AUTH_CUSTOM_DOMAIN.md); `/auth/callback` is, and
 * already resumes Checkout from `?checkout=&market=`.
 */
export function checkoutCallbackPath(pending: PendingCheckout): string {
  const q = new URLSearchParams({ checkout: pending.plan, market: pending.market });
  return `/auth/callback?${q.toString()}`;
}

export function checkoutEmailRedirectTo(origin: string, pending: PendingCheckout): string {
  return `${origin.replace(/\/$/, "")}${checkoutCallbackPath(pending)}`;
}

export function isBillingStartPath(next: string | undefined): boolean {
  if (!next) return false;
  try {
    const u = new URL(next, "https://milon.invalid");
    return u.pathname === "/billing/start";
  } catch {
    return next === "/billing/start" || next.startsWith("/billing/start?");
  }
}

export function pendingCheckoutFromNext(next: string | undefined): PendingCheckout | null {
  if (!next || !isBillingStartPath(next)) return null;
  try {
    return parsePendingCheckoutFromSearch(new URL(next, "https://milon.invalid").search);
  } catch {
    const qIndex = next.indexOf("?");
    return qIndex >= 0 ? parsePendingCheckoutFromSearch(next.slice(qIndex)) : null;
  }
}

export function registerLabelForPlan(plan: StripePaidPlan): string {
  return plan === "orbit" ? "Orbit" : "Constellation";
}

export function paidPlanFromRegisterLabel(label: string): StripePaidPlan | null {
  const v = label.trim().toLowerCase();
  if (v === "orbit" || v.startsWith("orbit")) return "orbit";
  if (v === "constellation" || v.startsWith("constellation")) return "constellation";
  return null;
}

export function stashPendingCheckout(pending: PendingCheckout): void {
  try {
    sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(pending));
  } catch {
    /* private mode / SSR */
  }
}

export function peekPendingCheckout(): PendingCheckout | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { plan?: unknown; market?: unknown };
    return parsePendingCheckout(parsed);
  } catch {
    return null;
  }
}

export function consumePendingCheckout(): PendingCheckout | null {
  const pending = peekPendingCheckout();
  try {
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {
    /* ignore */
  }
  return pending;
}

export function clearPendingCheckout(): void {
  try {
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {
    /* ignore */
  }
}
