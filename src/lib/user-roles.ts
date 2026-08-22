/**
 * App role resolution for portal routing.
 *
 * `user_roles` allows multiple rows per user (UNIQUE on user_id+role). Using
 * `.maybeSingle()` silently fails when both firm_admin and client_owner exist,
 * which bounced dual-role founders out of the accountant portal.
 */

import { supabase } from "@/integrations/supabase/client";
import { listUserFirms } from "@/lib/firm-brand";

export type AppRole = "accountant" | "firm_admin" | "client_owner" | "client_member";

export type PortalRoles = {
  roles: AppRole[];
  hasPracticeRole: boolean;
  hasClientRole: boolean;
  /** Prefer practice when both exist — dual-role founders can still open /app intentionally. */
  primaryRole: AppRole | null;
};

const PRACTICE: AppRole[] = ["firm_admin", "accountant"];
const CLIENT: AppRole[] = ["client_owner", "client_member"];

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

/**
 * Where should this user land after a generic (landing) sign-in?
 * Ops unlock still wins at the call site.
 */
export async function resolvePostLoginPath(userId: string): Promise<"/dashboard" | "/app"> {
  const portal = await resolvePortalRoles(userId);
  if (portal.hasPracticeRole && !portal.hasClientRole) return "/dashboard";
  if (portal.hasPracticeRole && portal.hasClientRole) {
    // Dual-role: honour last portal intent when set, else founder board.
    try {
      const intent = sessionStorage.getItem("milon_portal_intent");
      if (intent === "accountant") return "/dashboard";
      if (intent === "owner") return "/app";
    } catch {
      /* ignore */
    }
    return "/app";
  }
  if (portal.hasClientRole) return "/app";

  // No role rows — firm ownership still means accountant portal.
  const firms = await listUserFirms(userId);
  if (firms.length > 0) return "/dashboard";
  return "/app";
}

/** Accountant portal may keep users who hold a practice role OR a firm. */
export async function shouldStayOnAccountantPortal(userId: string): Promise<boolean> {
  const portal = await resolvePortalRoles(userId);
  if (portal.hasPracticeRole) return true;
  if (portal.hasClientRole && !portal.hasPracticeRole) {
    const firms = await listUserFirms(userId);
    return firms.length > 0;
  }
  if (!portal.hasClientRole && !portal.hasPracticeRole) {
    const firms = await listUserFirms(userId);
    return firms.length > 0;
  }
  return false;
}

export function setPortalIntent(intent: "accountant" | "owner"): void {
  try {
    sessionStorage.setItem("milon_portal_intent", intent);
  } catch {
    /* ignore */
  }
}
