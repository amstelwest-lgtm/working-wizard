/**
 * Where /auth sends someone after a password sign-in or Create firm signup.
 *
 * Viewing Create firm stashes `?plan=&interval=` in sessionStorage. Plain
 * Sign in must ignore that leftover for Checkout. An account that already has
 * a firm or a live subscription must never be sent to Stripe Checkout from
 * this page. Create firm opens the workspace and never Checkout: the new
 * firm has not shown figures. Sign-in opens Checkout only after that firm's
 * insight, including an explicit `/billing/start` resume.
 */
import {
  isBillingStartPath,
  pendingCheckoutFromNext,
  type PendingCheckout,
} from "@/lib/pending-checkout";

export type AccountantAuthFlow = "signin" | "signup";

export type AccountantAuthLanding =
  | { kind: "billing"; pending: PendingCheckout }
  /** Practice workspace. The stashed band stays for Checkout after an insight. */
  | { kind: "workspace" }
  | { kind: "app" };

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
 * Where this auth attempt goes.
 * Create firm (no firm yet) always opens the workspace. A stored insight
 * flag cannot open Checkout on that signup. Sign-in opens Checkout after
 * this firm's insight (`insightSeen`). Before that, a stashed band opens
 * the workspace and keeps the plan. An explicit `/billing/start` next still
 * opens Checkout once an insight exists.
 * An account that already has a firm or a live subscription is never sent
 * to Stripe from this page.
 */
export function decideAccountantAuthLanding(input: {
  flow: AccountantAuthFlow;
  /** Firm membership that existed before this signup created one. */
  hadFirmBefore: boolean;
  /** Active/trialing subscription, or staff on a billed firm. */
  hasLiveEntitlement: boolean;
  pending: PendingCheckout | null;
  next: string | undefined;
  /** Figures already seen. Omitted means not yet — Checkout waits. */
  insightSeen?: boolean;
}): AccountantAuthLanding {
  const explicit = isBillingStartPath(input.next) ? pendingCheckoutFromNext(input.next) : null;
  if (input.hadFirmBefore || input.hasLiveEntitlement) return { kind: "app" };
  // The firm created on this submit has no insight of its own.
  if (input.flow === "signup") return { kind: "workspace" };
  const insightSeen = input.insightSeen === true;
  if (explicit && insightSeen) return { kind: "billing", pending: explicit };
  if (explicit || input.pending) return { kind: "workspace" };
  return { kind: "app" };
}
