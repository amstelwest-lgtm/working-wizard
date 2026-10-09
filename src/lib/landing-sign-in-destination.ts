/**
 * Where a successful password sign-in from the landing modal goes.
 *
 * The landing modal is the owner door: owners and dual-role accounts land on
 * /app. A practice account with no business seat still opens /dashboard — that
 * is the decided landing, including when the click happened on a marketing page.
 * Supabase stays behind the dynamic imports in resolveLandingSignInDestination.
 */
import {
  decidePostLoginPath,
  forcePortal,
  isPracticeSignupMeta,
  type PortalRouteDecision,
} from "@/lib/user-roles";

export type LandingSignInRoles = Omit<PortalRouteDecision, "force" | "intent">;

/** Owner door unless this account is practice-only (no client seat). */
export function destinationAfterLandingSignIn(d: LandingSignInRoles): "/dashboard" | "/app" {
  const ownerDoor = d.hasClientRole || (!d.hasPracticeRole && !d.hasFirm && !d.practiceSignup);
  if (ownerDoor) {
    return decidePostLoginPath({ ...d, intent: "owner", force: "owner" });
  }
  return decidePostLoginPath({ ...d, intent: "owner", force: "accountant" });
}

export function landingSignInForce(path: "/dashboard" | "/app"): "owner" | "accountant" {
  return path === "/dashboard" ? "accountant" : "owner";
}

async function loadLandingSignInRoles(userId: string): Promise<LandingSignInRoles> {
  const { resolvePortalRoles } = await import("@/lib/user-roles");
  const portal = await resolvePortalRoles(userId);
  const { listUserFirms } = await import("@/lib/firm-brand");
  const firms = portal.hasPracticeRole ? [] : await listUserFirms(userId);
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.auth.getUser();
  return {
    hasPracticeRole: portal.hasPracticeRole,
    hasClientRole: portal.hasClientRole,
    hasFirm: firms.length > 0,
    practiceSignup: isPracticeSignupMeta(
      data.user?.user_metadata as Record<string, unknown> | undefined,
    ),
  };
}

/**
 * Pin the door, then return the path. `load` is for tests that stub roles
 * instead of calling Supabase.
 */
export async function resolveLandingSignInDestination(
  userId: string,
  load?: () => Promise<LandingSignInRoles>,
): Promise<"/dashboard" | "/app"> {
  const roles = load ? await load() : await loadLandingSignInRoles(userId);
  const path = destinationAfterLandingSignIn(roles);
  forcePortal(landingSignInForce(path));
  return path;
}
