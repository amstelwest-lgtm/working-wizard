/**
 * App role resolution for portal routing.
 *
 * `user_roles` allows multiple rows per user (UNIQUE on user_id+role). Using
 * `.maybeSingle()` silently fails when both firm_admin and client_owner exist,
 * which bounced dual-role founders out of the accountant portal.
 *
 * Dual-role users (practice + client) may use both doors. The door they signed
 * in through is stored as portal intent; a one-shot `force` flag makes that
 * login land on the matching side even when the other role would otherwise win.
 *
 * Pure business-client accounts (client_owner / client_member, no practice role
 * and no firm) must never enter the practice portal — even via `/auth`.
 */

import { supabase } from "@/integrations/supabase/client";
import { firmsCacheKey, once } from "@/lib/bootstrap-cache";
import { listUserFirms } from "@/lib/firm-brand";

export type AppRole = "accountant" | "firm_admin" | "client_owner" | "client_member";
export type PortalIntent = "accountant" | "owner";

export type PortalRoles = {
  roles: AppRole[];
  hasPracticeRole: boolean;
  hasClientRole: boolean;
  /** Prefer practice when both exist — dual-role founders can still open /app intentionally. */
  primaryRole: AppRole | null;
};

const PRACTICE: AppRole[] = ["firm_admin", "accountant"];
const CLIENT: AppRole[] = ["client_owner", "client_member"];
export const PORTAL_INTENT_KEY = "milon_portal_intent";
export const PORTAL_FORCE_KEY = "milon_force_portal";
/** Which board Settings should return to. Survives the shared /settings page. */
export const SETTINGS_RETURN_KEY = "milon_settings_return";
export type SettingsReturn = "/app" | "/dashboard";
export type SettingsView = "owner" | "practice";

export async function listAppRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) {
    console.warn("[user-roles] list failed", error.message);
    return [];
  }
  return (data ?? [])
    .map((r) => r.role as AppRole)
    .filter((r): r is AppRole => Boolean(r));
}

export function summarizeRoles(roles: AppRole[]): PortalRoles {
  const hasPracticeRole = roles.some((r) => PRACTICE.includes(r));
  const hasClientRole = roles.some((r) => CLIENT.includes(r));
  let primaryRole: AppRole | null = null;
  if (hasPracticeRole) {
    primaryRole = roles.includes("firm_admin") ? "firm_admin" : "accountant";
  } else if (roles.includes("client_owner")) {
    primaryRole = "client_owner";
  } else if (roles.includes("client_member")) {
    primaryRole = "client_member";
  }
  return { roles, hasPracticeRole, hasClientRole, primaryRole };
}

export async function resolvePortalRoles(userId: string): Promise<PortalRoles> {
  return once(`roles:${userId}`, async () => summarizeRoles(await listAppRoles(userId)));
}

function readStorage(storage: Storage | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* private browsing / quota */
  }
}

function removeStorage(storage: Storage | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function webStorage(): { local?: Storage; session?: Storage } {
  if (typeof window === "undefined") return {};
  try {
    return { local: window.localStorage, session: window.sessionStorage };
  } catch {
    return {};
  }
}

function parseIntent(raw: string | null): PortalIntent | null {
  return raw === "accountant" || raw === "owner" ? raw : null;
}

export function getPortalIntent(): PortalIntent | null {
  const { local, session } = webStorage();
  return parseIntent(readStorage(session, PORTAL_INTENT_KEY) ?? readStorage(local, PORTAL_INTENT_KEY));
}

export function setPortalIntent(intent: PortalIntent): void {
  const { local, session } = webStorage();
  writeStorage(session, PORTAL_INTENT_KEY, intent);
  writeStorage(local, PORTAL_INTENT_KEY, intent);
}

export function forcePortal(intent: PortalIntent): void {
  const { session } = webStorage();
  writeStorage(session, PORTAL_FORCE_KEY, intent);
  setPortalIntent(intent);
}

export function peekForcePortal(): PortalIntent | null {
  const { session } = webStorage();
  return parseIntent(readStorage(session, PORTAL_FORCE_KEY));
}

export function clearForcePortal(): void {
  const { session } = webStorage();
  removeStorage(session, PORTAL_FORCE_KEY);
}

/**
 * The practice board paints as soon as the gate has opened this user.
 * A second full-page skeleton after the shell was the blank gap on /practice.
 */
const accountantPortalOpen = new Set<string>();
const stayResolved = new Map<string, boolean>();

export function clearPortalRouting(): void {
  const { local, session } = webStorage();
  removeStorage(session, PORTAL_INTENT_KEY);
  removeStorage(session, PORTAL_FORCE_KEY);
  removeStorage(session, SETTINGS_RETURN_KEY);
  removeStorage(local, PORTAL_INTENT_KEY);
  accountantPortalOpen.clear();
  stayResolved.clear();
}

export function setSettingsReturn(to: SettingsReturn): void {
  const { session } = webStorage();
  writeStorage(session, SETTINGS_RETURN_KEY, to);
}

export function peekSettingsReturn(): SettingsReturn | null {
  const { session } = webStorage();
  const raw = readStorage(session, SETTINGS_RETURN_KEY);
  return raw === "/app" || raw === "/dashboard" ? raw : null;
}

/** Open Settings from the founder board — keep the user on the owner side. */
export function openOwnerSettings(): void {
  setSettingsReturn("/app");
  setPortalIntent("owner");
}

/** Open Settings from the practice portal. */
export function openPracticeSettings(): void {
  setSettingsReturn("/dashboard");
  setPortalIntent("accountant");
}

/**
 * Which Settings chrome to show. Dual-role accounts (practice + client) must
 * follow the door they came from — primaryRole is always firm_admin and would
 * otherwise dump an /app visitor onto Team / Brand / /dashboard.
 */
export function decideSettingsView(
  d: PortalRouteDecision & { returnTo?: SettingsReturn | null },
): SettingsView {
  if (d.returnTo === "/app") return "owner";
  if (d.returnTo === "/dashboard") {
    return canEnterAccountantPortal(d) ? "practice" : "owner";
  }
  if (d.force === "owner") return "owner";
  if (d.intent === "owner" && (d.hasClientRole || !canEnterAccountantPortal(d))) return "owner";
  if (
    (d.force === "accountant" || d.intent === "accountant") &&
    canEnterAccountantPortal(d)
  ) {
    return "practice";
  }
  if (d.hasClientRole && !d.hasPracticeRole) return "owner";
  if (d.hasPracticeRole && !d.hasClientRole) return "practice";
  if (d.hasClientRole) return "owner";
  return canEnterAccountantPortal(d) ? "practice" : "owner";
}

export function settingsBackPath(view: SettingsView): SettingsReturn {
  return view === "practice" ? "/dashboard" : "/app";
}

/**
 * True only for a just-signed-in accountant-door session (one-shot force).
 * Leftover localStorage intent must not count — that trapped SME invitees
 * on /dashboard after they accepted an owner invite in the same browser.
 */
export function isAccountantDoor(): boolean {
  return peekForcePortal() === "accountant";
}

export type PortalRouteDecision = {
  hasPracticeRole: boolean;
  hasClientRole: boolean;
  hasFirm: boolean;
  intent: PortalIntent | null;
  force: PortalIntent | null;
  /**
   * True when auth metadata says this account was created as a practice
   * (`signup_type=accountant` or `firm_name`). Business-client accounts that
   * were auto-granted firm_admin by ensure_practice_firm must stay false.
   */
  practiceSignup: boolean;
};

export function isPracticeSignupMeta(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  if (!meta) return false;
  if (meta.signup_type === "accountant") return true;
  if (typeof meta.firm_name === "string" && meta.firm_name.trim().length > 0) return true;
  return false;
}

async function readPracticeSignup(): Promise<boolean> {
  // Local session. getUser() is a network round trip to the Auth server and
  // takes the auth lock while the rest of the cold load is in flight.
  const { data } = await supabase.auth.getSession();
  return isPracticeSignupMeta(
    data.session?.user?.user_metadata as Record<string, unknown> | undefined,
  );
}

/** Pure business-client account: no practice role and no firm. */
export function isSmeOnly(d: Pick<PortalRouteDecision, "hasPracticeRole" | "hasClientRole" | "hasFirm">): boolean {
  return d.hasClientRole && !d.hasPracticeRole && !d.hasFirm;
}

/**
 * firm_admin written onto a business owner without a firm row and without
 * practice-signup metadata. ensure_practice_firm used to do this. A firm row
 * is a real membership — this is not that.
 */
export function isAutoGrantedFirmRole(
  d: Pick<PortalRouteDecision, "hasPracticeRole" | "hasClientRole" | "hasFirm" | "practiceSignup">,
): boolean {
  return d.hasPracticeRole && d.hasClientRole && !d.hasFirm && !d.practiceSignup;
}

/**
 * A firm row, a practice role, or practice-signup metadata. The auto-grant
 * above is the only firm_admin that does not count. A firm row always counts.
 */
export function hasRealFirmMembership(
  d: Pick<PortalRouteDecision, "hasPracticeRole" | "hasClientRole" | "hasFirm" | "practiceSignup">,
): boolean {
  if (d.hasFirm) return true;
  if (isAutoGrantedFirmRole(d)) return false;
  return d.hasPracticeRole || d.practiceSignup;
}

/**
 * May this session sit on /dashboard (practice portal)?
 * Dual-role accounts (practice + client on the same email) may — the door they
 * used decides which board they land on. Pure business-client credentials
 * cannot, even via `/auth`, and even with leftover signup metadata.
 */
export function canEnterAccountantPortal(d: PortalRouteDecision): boolean {
  // A real practice role or firm is an accountant profile, even if the same
  // email also has a business workspace (signup_type may still be "customer").
  if (d.hasPracticeRole) return true;
  if (d.hasFirm) return true;
  if (d.practiceSignup) return true;

  // Business-client only: never the practice portal.
  if (d.hasClientRole) return false;

  if (d.force === "accountant") return true;
  if (d.intent === "accountant") return true;
  return false;
}

/**
 * Where a generic (landing) sign-in should land.
 * A one-shot `force` from a specific door wins — except:
 * - a pure owner (client seat, no firm membership) cannot enter the practice portal
 * - an explicit owner door keeps a dual-role account on /app
 * The accountant door, and any real firm membership, open /dashboard.
 * firm_admin with no firm row and no practice-signup metadata is the old
 * auto-grant, not a practice. A firm row is never treated as that auto-grant.
 */
export function decidePostLoginPath(d: PortalRouteDecision): "/dashboard" | "/app" {
  // The owner door was chosen. Dual-role accounts follow that choice.
  if (d.force === "owner") return "/app";
  if (isSmeOnly(d) || !canEnterAccountantPortal(d)) return "/app";
  // Owner intent, when this sign-in is not the accountant door.
  if (d.intent === "owner" && d.hasClientRole && d.force !== "accountant") return "/app";
  // Role only, no firm row: the historical ensure_practice_firm grant.
  if (isAutoGrantedFirmRole(d)) return "/app";
  // Accountant / Practice entry, or any real firm membership.
  if (d.force === "accountant" || d.intent === "accountant") return "/dashboard";
  if (hasRealFirmMembership(d)) return "/dashboard";
  if (d.hasClientRole) return "/app";
  if (d.practiceSignup) return "/dashboard";
  return "/app";
}

/**
 * Keep the user on /dashboard unless they are a business-client account.
 */
export function decideAccountantStay(d: PortalRouteDecision): boolean {
  return canEnterAccountantPortal(d);
}

/**
 * Send a just-signed-in accountant-door user from /app back to /dashboard.
 * Direct later visits to /app (no force flag) still work for dual-role users.
 * Business-client credentials never bounce into the practice portal.
 * Owner-door / invite redeem must stay on /app even when the same email still
 * only has a practice role (client_owner row may land a beat later).
 */
export function decideOwnerAppBounce(d: PortalRouteDecision & { actingAsClient: boolean }): boolean {
  if (d.actingAsClient) return false;
  if (d.force === "owner") return false;
  if (!canEnterAccountantPortal(d)) return false;
  // Auto-grant and pure owners stay on the business board.
  if (isAutoGrantedFirmRole(d) || isSmeOnly(d)) return false;
  // A firm seat, including one that also has a client workspace, belongs on
  // My practice. The owner door (an invite redeem) stays on /app.
  if (hasRealFirmMembership(d)) return true;
  return false;
}

/**
 * Role the founder board should act as. Dual-role emails (practice + client)
 * have primaryRole=firm_admin — that must not win on the owner door, or an
 * accountant redeeming a client invite is treated as the practice profile.
 */
export function ownerBoardRole(opts: {
  roles: AppRole[];
  force: PortalIntent | null;
  intent: PortalIntent | null;
}): AppRole | null {
  const ownerDoor = opts.force === "owner" || opts.intent === "owner";
  if (ownerDoor) {
    if (opts.roles.includes("client_owner")) return "client_owner";
    if (opts.roles.includes("client_member")) return "client_member";
  }
  return summarizeRoles(opts.roles).primaryRole;
}

/**
 * True when this user owns or belongs to a firm. A failed read on a practice
 * role prefers /dashboard: an unseen firm row is not proof of the auto-grant.
 */
async function firmRowForRouting(userId: string, hasPracticeRole: boolean): Promise<boolean> {
  try {
    const firms = await once(firmsCacheKey(userId), () => listUserFirms(userId));
    return firms.length > 0;
  } catch {
    return hasPracticeRole;
  }
}

/**
 * Where should this user land after a generic (landing) sign-in?
 * Ops unlock still wins at the call site.
 */
export async function resolvePostLoginPath(userId: string): Promise<"/dashboard" | "/app"> {
  const force = peekForcePortal();
  const intent = getPortalIntent();
  const [portal, practiceSignup] = await Promise.all([
    resolvePortalRoles(userId),
    readPracticeSignup(),
  ]);
  // A practice role is not enough. A firm row is the real membership, and
  // skipping the read made every firm_admin look like the auto-grant.
  const hasFirm = await firmRowForRouting(userId, portal.hasPracticeRole);
  return decidePostLoginPath({
    hasPracticeRole: portal.hasPracticeRole,
    hasClientRole: portal.hasClientRole,
    hasFirm,
    intent,
    force,
    practiceSignup,
  });
}

/** Send a just-signed-in accountant-door user off /app. */
export async function shouldBounceFromOwnerApp(
  userId: string,
  actingAsClient: boolean,
): Promise<boolean> {
  if (actingAsClient) return false;
  const force = peekForcePortal();
  const [portal, practiceSignup] = await Promise.all([
    resolvePortalRoles(userId),
    readPracticeSignup(),
  ]);
  const hasFirm = await firmRowForRouting(userId, portal.hasPracticeRole);
  return decideOwnerAppBounce({
    hasPracticeRole: portal.hasPracticeRole,
    hasClientRole: portal.hasClientRole,
    hasFirm,
    intent: getPortalIntent(),
    force,
    practiceSignup,
    actingAsClient,
  });
}

export async function isMilonItMember(userId: string): Promise<boolean> {
  return once(`it:${userId}`, async () => {
    try {
      const { data } = await supabase.rpc(
        "is_milon_it_member" as never,
        {
          _user_id: userId,
        } as never,
      );
      return Boolean(data);
    } catch {
      return false;
    }
  });
}

/**
 * IT-only accounts (on the team list, no practice role or firm) should land
 * on the Milōn IT section of Lighthouse rather than the firm dashboard.
 */
export async function shouldOpenItInbox(userId: string): Promise<boolean> {
  const [isIt, portal, firms] = await Promise.all([
    isMilonItMember(userId),
    resolvePortalRoles(userId),
    once(firmsCacheKey(userId), () => listUserFirms(userId)).catch(() => []),
  ]);
  if (!isIt) return false;
  if (portal.hasPracticeRole) return false;
  return firms.length === 0;
}

export function markAccountantPortalOpen(userId: string): void {
  accountantPortalOpen.add(userId);
}

export function isAccountantPortalOpen(userId: string): boolean {
  return accountantPortalOpen.has(userId);
}

/** True or false once the stay check has settled. Undefined while it is in flight. */
export function peekAccountantStay(userId: string): boolean | undefined {
  return stayResolved.get(userId);
}

/**
 * A firm seat (practice role, firm row, or practice signup) already decides
 * the portal. `is_milon_it_member` is only the override for an IT account
 * with no firm. Waiting on that RPC held a dual-role firm + client_owner
 * (theo) on the blank gate for the whole call.
 */
export function firmSeatSkipsItWait(stayFromRows: boolean): boolean {
  return stayFromRows;
}

/**
 * Accountant portal may keep practice accounts — never business-client credentials.
 * The gate and the board share one result. Dropping it in `finally` made the
 * board start a second IT check, getUser(), and firm read after the shell opened.
 */
export function shouldStayOnAccountantPortal(userId: string): Promise<boolean> {
  const pending = once(`stay:${userId}`, () => resolveAccountantStay(userId));
  return pending.then((stay) => {
    stayResolved.set(userId, stay);
    if (stay) markAccountantPortalOpen(userId);
    return stay;
  });
}

async function resolveAccountantStay(userId: string): Promise<boolean> {
  const force = peekForcePortal();
  const itPromise = isMilonItMember(userId);
  const [portal, practiceSignup, firmCount] = await Promise.all([
    resolvePortalRoles(userId),
    readPracticeSignup(),
    once(firmsCacheKey(userId), () => listUserFirms(userId))
      .then((firms) => firms.length)
      .catch(() => null),
  ]);
  // A failed firm read is not proof the practice role is the old auto-grant.
  const hasFirm = firmCount === null ? portal.hasPracticeRole : firmCount > 0;
  const stay = decideAccountantStay({
    hasPracticeRole: portal.hasPracticeRole,
    hasClientRole: portal.hasClientRole,
    hasFirm,
    intent: getPortalIntent(),
    force,
    practiceSignup,
  });
  if (firmSeatSkipsItWait(stay)) return true;
  return itPromise;
}
