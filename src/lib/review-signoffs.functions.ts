import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type ReviewScope = "financials" | "cash_forecast" | "budget";

export type ClientReviewSignoff = {
  id: string;
  client_id: string;
  scope: ReviewScope;
  signed_off_by_id: string;
  signed_off_by_name: string;
  signed_off_by_initials: string | null;
  signed_off_by_title: string | null;
  firm_name: string | null;
  note: string | null;
  signed_off_at: string;
};

export type ClientReviewSignoffHistory = ClientReviewSignoff & {
  action: "sign" | "retract";
  created_at: string;
};

function authedSupabase() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env vars");
  const req = getRequest();
  const token = req?.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  return createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

// Table created in 20260806120000_client_review_signoffs.sql is not yet present
// in the auto-generated Database type; cast through `any` here until the type
// file is regenerated post-migration (same pattern as intervention.functions.ts).
type LooseSb = { from: (t: string) => any };

/** Initials from a signup display name, e.g. "Jane Q Public" → "JQP". */
export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) {
    const only = parts[0];
    return (only.slice(0, 2) || only.slice(0, 1)).toUpperCase();
  }
  return parts
    .map((p) => p[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

async function assertClientAccess(
  userId: string,
  clientId: string,
  sb: ReturnType<typeof authedSupabase>,
) {
  const { data, error } = await sb.rpc("has_client_access" as never, {
    _user_id: userId,
    _client_id: clientId,
  } as never);
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("You do not have access to this client");
  }
}

/**
 * Practice-portal users with client access may sign off. Pure client owners /
 * members are blocked (unless they also hold accountant / firm_admin).
 * Users with no role row are allowed — firm signups sometimes lack a role after
 * RLS hardening blocked client-side inserts into user_roles.
 */
async function assertCanSignOff(userId: string, sb: ReturnType<typeof authedSupabase>) {
  const { data, error } = await (sb as unknown as LooseSb)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  const isPracticeRole =
    roles.includes("accountant") || roles.includes("firm_admin") || roles.length === 0;
  const isClientOnly =
    (roles.includes("client_owner") || roles.includes("client_member")) &&
    !roles.includes("accountant") &&
    !roles.includes("firm_admin");
  if (isClientOnly || !isPracticeRole) {
    throw new Error("Only practice portal users can sign off reviews");
  }
}

// ── List sign-offs for a client (both scopes) ────────────────────────────────

export const listClientReviewSignoffs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const { data: rows, error } = await (sb as unknown as LooseSb)
      .from("client_review_signoffs")
      .select("*")
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { signoffs: (rows ?? []) as ClientReviewSignoff[] };
  });

// ── Append-only sign-off history (G16) ───────────────────────────────────────

export const listClientReviewSignoffHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      scope: z.enum(["financials", "cash_forecast", "budget"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    let q = (sb as unknown as LooseSb)
      .from("client_review_signoff_history")
      .select("*")
      .eq("client_id", data.clientId)
      .order("signed_off_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.scope) q = q.eq("scope", data.scope);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { history: (rows ?? []) as ClientReviewSignoffHistory[] };
  });

// ── Sign off a scope (financials or cash_forecast) ───────────────────────────

export const signoffReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      scope: z.enum(["financials", "cash_forecast", "budget"]),
      accountantTitle: z.string().max(60).optional().nullable(),
      firmName: z.string().max(120).optional().nullable(),
      note: z.string().max(1000).optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertCanSignOff(userData.user.id, sb);
    await assertClientAccess(userData.user.id, data.clientId, sb);

    // Trusted display name from auth user metadata (signup personal info).
    const meta = (userData.user.user_metadata ?? {}) as Record<string, unknown>;
    const trustedName =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      (userData.user.email ? userData.user.email.split("@")[0] : null);
    if (!trustedName) throw new Error("Cannot determine signer name from account");

    const initials = initialsFromName(trustedName);
    const firmFromMeta =
      typeof meta.firm_name === "string" && meta.firm_name.trim()
        ? meta.firm_name.trim()
        : null;

    const { data: row, error } = await (sb as unknown as LooseSb)
      .from("client_review_signoffs")
      .upsert(
        {
          client_id: data.clientId,
          scope: data.scope,
          signed_off_by_id: userData.user.id,
          signed_off_by_name: trustedName,
          signed_off_by_initials: initials || null,
          signed_off_by_title: data.accountantTitle ?? null,
          firm_name: data.firmName?.trim() || firmFromMeta,
          note: data.note ?? null,
          signed_off_at: new Date().toISOString(),
        },
        { onConflict: "client_id,scope" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as ClientReviewSignoff;
  });

// ── Remove a sign-off ────────────────────────────────────────────────────────

export const removeReviewSignoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      scope: z.enum(["financials", "cash_forecast", "budget"]),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertCanSignOff(userData.user.id, sb);
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const { error } = await (sb as unknown as LooseSb)
      .from("client_review_signoffs")
      .delete()
      .eq("client_id", data.clientId)
      .eq("scope", data.scope);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
