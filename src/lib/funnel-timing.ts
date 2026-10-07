/**
 * Signup funnel timing.
 *
 * Checkout is the existing Solo (or stashed band) Stripe session. It opens
 * after the accountant has seen an insight — figures on a client — not before
 * the workspace. No new price and no new product.
 *
 * Markers `solo-first` and `checkout-after-insight` are locked by
 * scripts/funnel-timing-test.mts.
 */

export const FUNNEL_SOLO_FIRST = "solo-first";
export const FUNNEL_CHECKOUT_AFTER_INSIGHT = "checkout-after-insight";

export const INSIGHT_SEEN_KEY = "milon_insight_seen";

/** Dashboard and the client workspace are the aha path. Other firm routes still bill. */
export function isPreInsightWorkspacePath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/clients" ||
    pathname.startsWith("/clients/")
  );
}

export function readInsightSeen(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(INSIGHT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markInsightSeen(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(INSIGHT_SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
}
