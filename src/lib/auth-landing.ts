/**
 * Where /auth sends someone after a password sign-in or Create firm signup.
 *
 * Viewing Create firm stashes `?plan=&interval=` in sessionStorage. Plain
 * Sign in must ignore that leftover for Checkout. An account that already has
 * a firm or a live subscription must never be sent to Stripe Checkout from
 * this page. Create firm opens the workspace. Checkout waits until an insight
 * has been seen, including an explicit `/billing/start` resume.
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
 * Checkout opens after an insight (`insightSeen`). Before that, Create firm
 * and a stashed band open the workspace and keep the plan. An explicit
 * `/billing/start` next still opens Checkout once an insight exists.
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
  const insightSeen = input.insightSeen === true;
  if (input.flow === "signup") {
    if (explicit && insightSeen) return { kind: "billing", pending: explicit };
    return { kind: "workspace" };
  }
  if (explicit && insightSeen) return { kind: "billing", pending: explicit };
  if (explicit || input.pending) return { kind: "workspace" };
  return { kind: "app" };
}
