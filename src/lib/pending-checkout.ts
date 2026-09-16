/**
 * Firm-band checkout intent that must survive signup / sign-in / Google.
 * Owner Spark is free and never stored here.
 */

import {
  isFirmCheckoutBand,
  isFirmInterval,
  type FirmCheckoutBand,
  type FirmInterval,
  type StripePlanMarket,
} from "@/lib/stripe-plans";

export const PENDING_CHECKOUT_KEY = "milon_pending_checkout";

export type PendingCheckout = {
  plan: FirmCheckoutBand;
  interval: FirmInterval;
  market: StripePlanMarket;
  promo?: string;
};

export function parseStripePlanMarket(value: unknown): StripePlanMarket | null {
  return value === "za" || value === "us" ? value : null;
}

export function parseFirmInterval(value: unknown): FirmInterval {
  return typeof value === "string" && isFirmInterval(value) ? value : "month";
}

export function parsePendingCheckout(input: {
  plan?: unknown;
  market?: unknown;
  checkout?: unknown;
  interval?: unknown;
  promo?: unknown;
}): PendingCheckout | null {
  const rawPlan = input.plan ?? input.checkout;
  if (typeof rawPlan !== "string" || !isFirmCheckoutBand(rawPlan)) return null;
  const market = parseStripePlanMarket(input.market) ?? "us";
  const interval = parseFirmInterval(input.interval);
  const promo =
    typeof input.promo === "string" && input.promo.trim() ? input.promo.trim() : undefined;
  return { plan: rawPlan, interval, market, ...(promo ? { promo } : {}) };
}

export function parsePendingCheckoutFromSearch(search: string): PendingCheckout | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return parsePendingCheckout({
    plan: q.get("plan"),
    checkout: q.get("checkout"),
    market: q.get("market") ?? q.get("mkt"),
    interval: q.get("interval"),
    promo: q.get("promo"),
  });
}

export function billingStartSearch(pending: PendingCheckout): {
  plan: FirmCheckoutBand;
  interval: FirmInterval;
  market: StripePlanMarket;
  promo?: string;
} {
  return {
    plan: pending.plan,
    interval: pending.interval,
    market: pending.market,
    ...(pending.promo ? { promo: pending.promo } : {}),
  };
}

export function billingStartPath(pending: PendingCheckout): string {
  const q = new URLSearchParams({
    plan: pending.plan,
    interval: pending.interval,
    market: pending.market,
  });
  if (pending.promo) q.set("promo", pending.promo);
  return `/billing/start?${q.toString()}`;
}

/**
 * Confirmation / magic-link redirect. `/billing/start` is not on the Supabase
 * Auth allowlist (see docs/AUTH_CUSTOM_DOMAIN.md); `/auth/callback` is, and
 * already resumes Checkout from `?checkout=&interval=&market=`.
 */
export function checkoutCallbackPath(pending: PendingCheckout): string {
  const q = new URLSearchParams({
    checkout: pending.plan,
    interval: pending.interval,
    market: pending.market,
  });
  if (pending.promo) q.set("promo", pending.promo);
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

export function registerLabelForPlan(plan: FirmCheckoutBand): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function paidPlanFromRegisterLabel(label: string): FirmCheckoutBand | null {
  const v = label.trim().toLowerCase();
  if (v.startsWith("spark")) return null;
  if (isFirmCheckoutBand(v)) return v;
  const first = v.split(/[\s—-]/)[0];
  return first && isFirmCheckoutBand(first) ? first : null;
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
    const parsed = JSON.parse(raw) as {
      plan?: unknown;
      market?: unknown;
      interval?: unknown;
      promo?: unknown;
    };
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
