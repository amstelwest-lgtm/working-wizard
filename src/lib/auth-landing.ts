/**
 * Where /auth sends someone after a password sign-in or Create firm signup.
 *
 * Viewing Create firm stashes `?plan=&interval=` in sessionStorage. Plain
 * Sign in must ignore that leftover. An account that already has a firm or a
 * live subscription must never be sent to Stripe Checkout or the Customer
 * Portal from this page. Only a Create firm signup (or the explicit
 * already-registered resume, which puts billing on `next`) may start Checkout,
 * and only when the account does not already have a firm or subscription.
 */
import {
  isBillingStartPath,
  pendingCheckoutFromNext,
  type PendingCheckout,
} from "@/lib/pending-checkout";

export type AccountantAuthFlow = "signin" | "signup";

export type AccountantAuthLanding = { kind: "billing"; pending: PendingCheckout } | { kind: "app" };

export function safeAccountantRedirect(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (next.includes("://")) return null;
  try {
    const url = new URL(next, "https://milon.invalid");
    if (url.origin !== "https://milon.invalid") return null;
    if (url.pathname === "/billing" || url.pathname.startsWith("/billing/")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * True when this auth attempt should open Stripe Checkout.
 * Sign-in ignores a stashed plan unless `next` is explicitly `/billing/start`
 * (the Create firm "sign in to finish billing" handoff).
 */
export function decideAccountantAuthLanding(input: {
  flow: AccountantAuthFlow;
  /** Firm membership that existed before this signup created one. */
  hadFirmBefore: boolean;
  /** Active/trialing subscription, or staff on a billed firm. */
  hasLiveEntitlement: boolean;
  pending: PendingCheckout | null;
  next: string | undefined;
}): AccountantAuthLanding {
  const explicit = isBillingStartPath(input.next) ? pendingCheckoutFromNext(input.next) : null;
  if (input.hadFirmBefore || input.hasLiveEntitlement) return { kind: "app" };
  if (input.flow === "signup") {
    const pending = explicit ?? input.pending;
    if (pending) return { kind: "billing", pending };
    return { kind: "app" };
  }
  if (explicit) return { kind: "billing", pending: explicit };
  return { kind: "app" };
}
