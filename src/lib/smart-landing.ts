/**
 * Where "Open Milōn" should land.
 *
 * A signed-in firm with no card goes to the first client file when one
 * exists (that page stays open before a card). With no client yet, they
 * go to the add-client step, which is where the first upload starts.
 * A card on file, or any other signed-in case, opens the practice dashboard.
 *
 * The session lives in this tab, so the browser asks the server once the
 * user is known. The choice itself is this function.
 */

export const SMART_LANDING_PATH = "/open";

/** Empty practice: add the first client. The next step on that page is the upload. */
export const PRECARD_ONBOARDING_HREF = "/dashboard?addClient=1";

const CLIENT_ID = /^[A-Za-z0-9_-]{1,80}$/;

export type SmartLandingKind = "auth" | "client" | "onboarding" | "dashboard";

export type SmartLanding = {
  kind: SmartLandingKind;
  href: string;
  clientId?: string;
};

export function safeFirmClientId(id: string | null | undefined): string | null {
  const trimmed = (id ?? "").trim();
  if (!CLIENT_ID.test(trimmed)) return null;
  return trimmed;
}

export function decideSmartLanding(input: {
  signedIn: boolean;
  /** Entitling subscription, inherited firm billing, or Stripe not configured. */
  entitled: boolean;
  firstClientId?: string | null;
}): SmartLanding {
  if (!input.signedIn) {
    return { kind: "auth", href: `/auth?next=${SMART_LANDING_PATH}` };
  }
  if (!input.entitled) {
    const clientId = safeFirmClientId(input.firstClientId);
    if (clientId) {
      return { kind: "client", clientId, href: `/clients/${clientId}` };
    }
    return { kind: "onboarding", href: PRECARD_ONBOARDING_HREF };
  }
  return { kind: "dashboard", href: "/dashboard" };
}

export function isSafeSmartLandingHref(href: string): boolean {
  if (href === "/dashboard" || href === PRECARD_ONBOARDING_HREF) return true;
  if (href === `/auth?next=${SMART_LANDING_PATH}`) return true;
  return /^\/clients\/[A-Za-z0-9_-]{1,80}$/.test(href);
}

/** Sign-in `next` that should come back to the smart landing, not the paywall. */
export function isSmartLandingNext(next: string | null | undefined): boolean {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return false;
  const path = next.split(/[?#]/, 1)[0] ?? "";
  return path === SMART_LANDING_PATH;
}

/** Label on the billing wall so a walled firm dashboard can return to the open client. */
export function firmWallBackLabel(clientName: string | null | undefined): string | null {
  const name = (clientName ?? "").trim();
  if (!name) return null;
  return `Back to ${name}`;
}
