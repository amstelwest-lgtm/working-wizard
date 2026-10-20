/**
 * Where a successful sign-in goes. The landing modal and /auth share this.
 *
 * The landing door sends a pure owner to /app. A real firm membership
 * (a firm row, a practice signup, or a practice role that is not the
 * auto-grant) opens /practice, including when the same email also has a
 * client seat. firm_admin with no firm row and no practice-signup metadata
 * is the old auto-grant and stays on /app. An empty role read is not a new
 * owner: practice signup metadata still opens /practice, and a read that
 * has not finished stays pending instead of pinning /app.
 *
 * Supabase stays behind the dynamic imports in resolveSignedInDestination.
 */
import {
  decidePostLoginPath,
  forcePortal,
  isAutoGrantedFirmRole,
  isPracticeSignupMeta,
  summarizeRoles,
  type AppRole,
  type PortalRouteDecision,
} from "@/lib/user-roles";

export type LandingSignInRoles = Omit<PortalRouteDecision, "force" | "intent"> & {
  /**
   * False when the role/firm read has not finished or failed. Omitted means
   * the caller already has a finished snapshot.
   */
  profileLoaded?: boolean;
};

export type SignInDoor = "landing" | "accountant";

export type SignInDestination = "/practice" | "/app" | "pending";

/** Owner door unless this account is practice-only (no client seat). */
export function destinationAfterLandingSignIn(d: LandingSignInRoles): SignInDestination {
  return destinationAfterSignIn(d, "landing");
}

/**
 * Shared with /auth (`door: "accountant"`) and the landing modal
 * (`door: "landing"`). `pending` means the profile is not loaded and nothing
 * in the session says this is a practice account — do not open either board
 * yet. /auth sends a real firm member to /practice. A pure owner, and an
 * auto-granted firm_admin with no firm row, still land on /app.
 */
export function destinationAfterSignIn(
  d: LandingSignInRoles,
  door: SignInDoor,
): SignInDestination {
  const profileLoaded = d.profileLoaded !== false;
  const practiceEvidence = d.hasPracticeRole || d.hasFirm || d.practiceSignup;
  const autoGrant = isAutoGrantedFirmRole({
    hasPracticeRole: d.hasPracticeRole,
    hasClientRole: d.hasClientRole,
    hasFirm: d.hasFirm,
    practiceSignup: d.practiceSignup,
  });
  // A firm account opens My practice, including when the same email also
  // has one client seat. That seat must not open the owner board.
  const firmAccount = (d.hasFirm || d.practiceSignup || d.hasPracticeRole) && !autoGrant;

  if (!profileLoaded) {
    if (!d.hasClientRole && practiceEvidence) return "/practice";
    if (!practiceEvidence && !d.hasClientRole) return "pending";
  }

  if (firmAccount && (profileLoaded || practiceEvidence)) return "/practice";

  if (door === "accountant") {
    const decided = decidePostLoginPath({ ...d, intent: "accountant", force: "accountant" });
    return decided === "/dashboard" ? "/practice" : decided;
  }

  const ownerDoor =
    d.hasClientRole || (!d.hasPracticeRole && !d.hasFirm && !d.practiceSignup);
  if (ownerDoor) {
    return decidePostLoginPath({ ...d, intent: "owner", force: "owner" });
  }
  const decided = decidePostLoginPath({ ...d, intent: "accountant", force: "accountant" });
  return decided === "/dashboard" ? "/practice" : decided;
}

export function landingSignInForce(path: "/practice" | "/dashboard" | "/app"): "owner" | "accountant" {
  return path === "/app" ? "owner" : "accountant";
}

export async function loadSignInRoleSnapshot(
  userId: string,
  knownMeta?: Record<string, unknown> | null,
): Promise<LandingSignInRoles> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  // Routing only. Session metadata is not an authorization check.
  // getUser() held the GoTrue lock across GET /auth/v1/user and left the
  // sign-in button on "Signing in…". An empty metadata object is still
  // "known" — customer signup has no firm_name and must not refetch.
  let meta: Record<string, unknown> | null;
  if (knownMeta === undefined) {
    const { data } = await supabase.auth.getSession();
    meta = (data.session?.user?.user_metadata as Record<string, unknown> | undefined) ?? null;
  } else {
    meta = knownMeta;
  }
  const practiceSignup = isPracticeSignupMeta(meta ?? undefined);
  if (roleError) {
    return {
      hasPracticeRole: false,
      hasClientRole: false,
      hasFirm: false,
      practiceSignup,
      profileLoaded: false,
    };
  }
  const portal = summarizeRoles(
    (roleRows ?? [])
      .map((row) => row.role as AppRole)
      .filter((role): role is AppRole => Boolean(role)),
  );
  try {
    const { listUserFirms } = await import("@/lib/firm-brand");
    const firms = await listUserFirms(userId);
    return {
      hasPracticeRole: portal.hasPracticeRole,
      hasClientRole: portal.hasClientRole,
      hasFirm: firms.length > 0,
      practiceSignup,
      profileLoaded: true,
    };
  } catch {
    return {
      hasPracticeRole: portal.hasPracticeRole,
      hasClientRole: portal.hasClientRole,
      // A practice role whose firm read failed is not the auto-grant.
      hasFirm: portal.hasPracticeRole,
      practiceSignup,
      profileLoaded: portal.hasPracticeRole,
    };
  }
}

function withKnownMeta(
  snapshot: LandingSignInRoles,
  knownMeta?: Record<string, unknown> | null,
): LandingSignInRoles {
  return {
    ...snapshot,
    practiceSignup: snapshot.practiceSignup || isPracticeSignupMeta(knownMeta ?? undefined),
  };
}

/**
 * Pin the door, then return the path. `load` is for tests that stub roles
 * instead of calling Supabase. A profile that is not loaded yet is read
 * once more before a landing sign-in is treated as a new owner.
 */
export async function resolveSignedInDestination(
  userId: string,
  opts: {
    door: SignInDoor;
    knownMeta?: Record<string, unknown> | null;
    load?: () => Promise<LandingSignInRoles>;
  },
): Promise<"/practice" | "/app"> {
  const read = async () =>
    withKnownMeta(
      opts.load ? await opts.load() : await loadSignInRoleSnapshot(userId, opts.knownMeta),
      opts.knownMeta,
    );
  let snapshot = await read();
  let path = destinationAfterSignIn(snapshot, opts.door);
  if (path === "pending") {
    snapshot = await read();
    if (snapshot.profileLoaded === false) {
      snapshot = { ...snapshot, profileLoaded: true };
    }
    path = destinationAfterSignIn(snapshot, opts.door);
  }
  if (path !== "/practice" && path !== "/app") {
    path = opts.door === "accountant" ? "/practice" : "/app";
  }
  forcePortal(landingSignInForce(path));
  return path;
}

export async function resolveLandingSignInDestination(
  userId: string,
  load?: () => Promise<LandingSignInRoles>,
  knownMeta?: Record<string, unknown> | null,
): Promise<"/practice" | "/app"> {
  return resolveSignedInDestination(userId, { door: "landing", load, knownMeta });
}
