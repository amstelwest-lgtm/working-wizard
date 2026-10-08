/**
 * Signup funnel timing.
 *
 * Checkout is the existing Solo (or stashed band) Stripe session. It opens
 * after the accountant has seen an insight — figures on a client — not before
 * the workspace. No new price and no new product.
 *
 * The flag is stored per firm (`milon_insight_seen:<firmId>`). Another firm's
 * flag on this browser does not count. The old unscoped key is never read;
 * the first read and sign-out remove it so it cannot leak.
 *
 * Markers `solo-first` and `checkout-after-insight` are locked by
 * scripts/funnel-timing-test.mts.
 */

export const FUNNEL_SOLO_FIRST = "solo-first";
export const FUNNEL_CHECKOUT_AFTER_INSIGHT = "checkout-after-insight";

/** Legacy unscoped key. Never read. Removed on read and on sign-out. */
export const INSIGHT_SEEN_KEY = "milon_insight_seen";

export function insightSeenStorageKey(firmId: string): string {
  return `${INSIGHT_SEEN_KEY}:${firmId}`;
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Drop the unscoped flag so another firm on this browser cannot inherit it. */
export function clearLegacyInsightSeen(): void {
  const ls = browserStorage();
  if (!ls) return;
  try {
    ls.removeItem(INSIGHT_SEEN_KEY);
  } catch {
    /* private mode */
  }
}

function usableFirmId(firmId: string | null | undefined): string | null {
  const id = firmId?.trim() ?? "";
  return id.length > 0 ? id : null;
}

/** Path without a query or hash, so `/dashboard?addClient=1` is still the board. */
export function routePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return path.length > 0 ? path : pathname;
}

/** Dashboard and the client workspace are the aha path. Other firm routes still bill. */
export function isPreInsightWorkspacePath(pathname: string): boolean {
  const path = routePathname(pathname);
  return (
    path === "/dashboard" ||
    path.startsWith("/dashboard/") ||
    path === "/clients" ||
    path.startsWith("/clients/")
  );
}

/**
 * Whether this firm has shown figures. No firm id — before a firm exists, or
 * a different firm — is not seen. Does not read the legacy global key.
 */
export function readInsightSeen(firmId: string | null | undefined): boolean {
  clearLegacyInsightSeen();
  const id = usableFirmId(firmId);
  const ls = browserStorage();
  if (!id || !ls) return false;
  try {
    return ls.getItem(insightSeenStorageKey(id)) === "1";
  } catch {
    return false;
  }
}

/** Record that this firm has shown figures. No firm id is a no-op. */
export function markInsightSeen(firmId: string | null | undefined): void {
  clearLegacyInsightSeen();
  const id = usableFirmId(firmId);
  const ls = browserStorage();
  if (!id || !ls) return;
  try {
    ls.setItem(insightSeenStorageKey(id), "1");
  } catch {
    /* private mode */
  }
}
