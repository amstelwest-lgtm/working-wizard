/**
 * Where a successful sign-in goes. The landing modal and /auth share this.
 *
 * Owners and dual-role accounts (a business seat) land on /app. A practice
 * account with no business seat lands on /dashboard — the same path /auth
 * chooses, including a pre-card firm with no client files. An empty role
 * read is not a new owner: practice signup metadata still opens /dashboard,
 * and a read that has not finished stays pending instead of pinning /app.
 *
 * Supabase stays behind the dynamic imports in resolveSignedInDestination.
 */
import {
  decidePostLoginPath,
  forcePortal,
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

export type SignInDestination = "/dashboard" | "/app" | "pending";

/** Owner door unless this account is practice-only (no client seat). */
export function destinationAfterLandingSignIn(d: LandingSignInRoles): SignInDestination {
  return destinationAfterSignIn(d, "landing");
}

/**
 * Shared with /auth (`door: "accountant"`) and the landing modal
 * (`door: "landing"`). `pending` means the profile is not loaded and nothing
 * in the session says this is a practice account — do not open /app yet.
 */
export function destinationAfterSignIn(
  d: LandingSignInRoles,
  door: SignInDoor,
): SignInDestination {
  const profileLoaded = d.profileLoaded !== false;
  const practiceEvidence = d.hasPracticeRole || d.hasFirm || d.practiceSignup;

  if (!profileLoaded) {
    if (!d.hasClientRole && practiceEvidence) return "/dashboard";
    if (door === "accountant" && !d.hasClientRole) return "/dashboard";
    if (!practiceEvidence && !d.hasClientRole) return "pending";
  }

  if (door === "accountant") {
    return decidePostLoginPath({ ...d, intent: "accountant", force: "accountant" });
  }

  const ownerDoor =
    d.hasClientRole || (!d.hasPracticeRole && !d.hasFirm && !d.practiceSignup);
  if (ownerDoor) {
    return decidePostLoginPath({ ...d, intent: "owner", force: "owner" });
  }
  return decidePostLoginPath({ ...d, intent: "accountant", force: "accountant" });
}

export function landingSignInForce(path: "/dashboard" | "/app"): "owner" | "accountant" {
  return path === "/dashboard" ? "accountant" : "owner";
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
  let meta = knownMeta ?? null;
  if (!meta) {
    const { data } = await supabase.auth.getUser();
    meta = (data.user?.user_metadata as Record<string, unknown> | undefined) ?? null;
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
  if (portal.hasPracticeRole) {
    return {
      hasPracticeRole: true,
      hasClientRole: portal.hasClientRole,
      hasFirm: false,
      practiceSignup,
      profileLoaded: true,
    };
  }
  try {
    const { listUserFirms } = await import("@/lib/firm-brand");
    const firms = await listUserFirms(userId);
    return {
      hasPracticeRole: false,
      hasClientRole: portal.hasClientRole,
      hasFirm: firms.length > 0,
      practiceSignup,
      profileLoaded: true,
    };
  } catch {
    return {
      hasPracticeRole: false,
      hasClientRole: portal.hasClientRole,
      hasFirm: false,
      practiceSignup,
      profileLoaded: false,
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
): Promise<"/dashboard" | "/app"> {
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
  if (path !== "/dashboard" && path !== "/app") {
    path = opts.door === "accountant" ? "/dashboard" : "/app";
  }
  forcePortal(landingSignInForce(path));
  return path;
}

export async function resolveLandingSignInDestination(
  userId: string,
  load?: () => Promise<LandingSignInRoles>,
  knownMeta?: Record<string, unknown> | null,
): Promise<"/dashboard" | "/app"> {
  return resolveSignedInDestination(userId, { door: "landing", load, knownMeta });
}
