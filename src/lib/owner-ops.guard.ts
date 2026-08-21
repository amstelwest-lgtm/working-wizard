/**
 * Shared platform-owner guard for the Milōn Lighthouse console.
 *
 * The console is protected in layers:
 * 1. Obscurity — landing passphrase unlock (sessionStorage)
 * 2. Auth — must be a signed-in Supabase user
 * 3. Allowlist — email must be in MILON_OWNER_EMAILS
 * 4. Data — ops tables are deny-all RLS, reached only via service role here
 */

import {
  getSupabaseAdminEnvStatus,
  getSupabaseAdminOrNull,
} from "@/integrations/supabase/client.server";

export const DEFAULT_OWNER_EMAILS = "amstel.west@gmail.com";
export const DEFAULT_PASSPHRASE = "MilonOpsForge";

/** Session key set by the landing unlock; also read by /ops. */
export const OPS_UNLOCK_KEY = "milon_ops_unlock_v1";

/** Secret operator handles accepted at the landing sign-in box. */
export const OPS_USERNAMES = ["forge", "lighthouse", "keeper"];

export type AuthCtx = {
  userId: string;
  claims?: { email?: string; sub?: string };
};

/** Untyped view of the service-role client — ops tables are not in Database types. */
export type LooseAdmin = {
  from: (table: string) => any;
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: { email?: string } | null } }>;
      listUsers: (opts: {
        page: number;
        perPage: number;
      }) => Promise<{ data: { users: Array<{ created_at?: string }> } }>;
    };
  };
};

export function ownerEmailAllowlist(): string[] {
  const raw = process.env.MILON_OWNER_EMAILS || DEFAULT_OWNER_EMAILS;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function opsPassphrase(): string {
  return process.env.MILON_OPS_PASSPHRASE || DEFAULT_PASSPHRASE;
}

export function adminLoose(): LooseAdmin {
  const admin = getSupabaseAdminOrNull();
  if (!admin) {
    const status = getSupabaseAdminEnvStatus();
    throw new Error(status.hint);
  }
  return admin as unknown as LooseAdmin;
}

async function resolveOwnerEmail(ctx: AuthCtx): Promise<string> {
  const fromClaims = (ctx.claims?.email ?? "").trim().toLowerCase();
  if (fromClaims) return fromClaims;

  const admin = getSupabaseAdminOrNull();
  if (!admin) return "";
  const { data } = await (admin as unknown as LooseAdmin).auth.admin.getUserById(ctx.userId);
  return (data.user?.email ?? "").trim().toLowerCase();
}

export async function assertPlatformOwner(
  ctx: AuthCtx,
): Promise<{ userId: string; email: string }> {
  const email = await resolveOwnerEmail(ctx);
  if (!email || !ownerEmailAllowlist().includes(email)) {
    throw new Error("Forbidden — this console is locked to the platform owner.");
  }
  return { userId: ctx.userId, email };
}

export function missingRelation(msg: string): boolean {
  return /does not exist|relation/i.test(msg);
}

export function migrationHintFor(file: string): string {
  return `Run migration ${file} in the Supabase SQL editor to enable this section.`;
}

export function moneyZar(cents: number): string {
  return `R ${(cents / 100).toLocaleString("en-ZA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
