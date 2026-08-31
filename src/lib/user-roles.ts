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
 * SME-only accounts (client_owner / client_member, no firm) must never enter
 * the practice portal — even if they typed their password on `/auth`.
 */

import { supabase } from "@/integrations/supabase/client";
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
  return summarizeRoles(await listAppRoles(userId));
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

export function clearPortalRouting(): void {
  const { local, session } = webStorage();
  removeStorage(session, PORTAL_INTENT_KEY);
  removeStorage(session, PORTAL_FORCE_KEY);
  removeStorage(local, PORTAL_INTENT_KEY);
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
};

/**
 * Where a generic (landing) sign-in should land.
 * A one-shot `force` from a specific door wins — except SME-only accounts
 * cannot enter the practice portal by using the accountant door. Karoo-style
 * client credentials must land on /app even if they signed in at /auth.
 */
export function decidePostLoginPath(d: PortalRouteDecision): "/dashboard" | "/app" {
  if (d.force === "owner") return "/app";
  if (isSmeOnly(d)) return "/app";
  if (d.force === "accountant") return "/dashboard";
  if (d.intent === "accountant") return "/dashboard";

  if (d.hasPracticeRole && d.hasClientRole) {
    if (d.intent === "owner") return "/app";
    return "/app";
  }
  if (d.hasPracticeRole) return "/dashboard";
  if (d.hasClientRole) return "/app";
  if (d.hasFirm) return "/dashboard";
  return "/app";
}

/** Pure business-client account: no practice role and no firm. */
export function isSmeOnly(d: Pick<PortalRouteDecision, "hasPracticeRole" | "hasClientRole" | "hasFirm">): boolean {
  return d.hasClientRole && !d.hasPracticeRole && !d.hasFirm;
}

/**
 * Keep the user on /dashboard unless they are clearly a client-only user.
 * Stale accountant *intent* must not trap an SME invitee here; the one-shot
 * accountant *force* flag still covers the provisioning race for users who
 * are not already SME-only.
 */
export function decideAccountantStay(d: PortalRouteDecision): boolean {
  if (isSmeOnly(d)) return false;
  if (d.force === "accountant") return true;
  if (d.hasPracticeRole) return true;
  if (d.hasFirm) return true;
  if (d.intent === "accountant" && !d.hasClientRole) return true;
  return false;
}

/**
 * Send a just-signed-in accountant-door user from /app back to /dashboard.
 * Direct later visits to /app (no force flag) still work for dual-role users.
 * SME-only credentials never bounce into the practice portal.
 */
export function decideOwnerAppBounce(d: PortalRouteDecision & { actingAsClient: boolean }): boolean {
  if (d.actingAsClient) return false;
  if (isSmeOnly(d)) return false;
  if (d.force === "accountant") return true;
  if (d.hasPracticeRole && !d.hasClientRole) return true;
  return false;
}

/**
 * Where should this user land after a generic (landing) sign-in?
 * Ops unlock still wins at the call site.
 */
export async function resolvePostLoginPath(userId: string): Promise<"/dashboard" | "/app"> {
  const force = peekForcePortal();
  const intent = getPortalIntent();
  const portal = await resolvePortalRoles(userId);
  // Need firm membership whenever practice role is missing — SME-only vs
  // unprovisioned accountant (firm exists, roles lag) vs no-role firm owner.
  const firms = portal.hasPracticeRole ? [] : await listUserFirms(userId);
  return decidePostLoginPath({
    hasPracticeRole: portal.hasPracticeRole,
    hasClientRole: portal.hasClientRole,
    hasFirm: firms.length > 0,
    intent,
    force,
  });
}

/** Send a just-signed-in accountant-door user off /app. */
export async function shouldBounceFromOwnerApp(
  userId: string,
  actingAsClient: boolean,
): Promise<boolean> {
  if (actingAsClient) return false;
  const force = peekForcePortal();
  const portal = await resolvePortalRoles(userId);
  const firms = portal.hasPracticeRole || !portal.hasClientRole ? [] : await listUserFirms(userId);
  return decideOwnerAppBounce({
    hasPracticeRole: portal.hasPracticeRole,
    hasClientRole: portal.hasClientRole,
    hasFirm: firms.length > 0,
    intent: getPortalIntent(),
    force,
    actingAsClient,
  });
}

/** Accountant portal may keep users who hold a practice role OR a firm — never SME-only. */
export async function shouldStayOnAccountantPortal(userId: string): Promise<boolean> {
  const force = peekForcePortal();
  const portal = await resolvePortalRoles(userId);
  const firms = portal.hasPracticeRole ? [] : await listUserFirms(userId);
  return decideAccountantStay({
    hasPracticeRole: portal.hasPracticeRole,
    hasClientRole: portal.hasClientRole,
    hasFirm: firms.length > 0,
    intent: getPortalIntent(),
    force,
  });
}
