import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type ReviewScope = "financials" | "cash_forecast";

export type ClientReviewSignoff = {
  id: string;
  client_id: string;
  scope: ReviewScope;
  signed_off_by_id: string;
  signed_off_by_name: string;
  signed_off_by_title: string | null;
  firm_name: string | null;
  note: string | null;
  signed_off_at: string;
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

async function assertAccountant(userId: string, sb: ReturnType<typeof authedSupabase>) {
  const { data, error } = await (sb as unknown as LooseSb)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["accountant", "firm_admin"])
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("Only accountants can perform this action");
  }
}

// Sign-off is a formal endorsement, not a routine read — never rely on RLS alone to scope
// it to clients this accountant actually serves. Explicitly re-check server-side using the
// same `has_client_access` function the database policies are built on (ownership, direct
// membership, or firm membership), so an accountant/firm-admin role alone is never enough
// to sign off (or erase a sign-off for) a client outside their book.
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

// ── Sign off a scope (financials or cash_forecast) ───────────────────────────

export const signoffReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      scope: z.enum(["financials", "cash_forecast"]),
      accountantTitle: z.string().max(60).optional().nullable(),
      firmName: z.string().max(120).optional().nullable(),
      note: z.string().max(1000).optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertAccountant(userData.user.id, sb);
    await assertClientAccess(userData.user.id, data.clientId, sb);

    // Trusted display name from auth user metadata; never accept name from client.
    const meta = (userData.user.user_metadata ?? {}) as Record<string, unknown>;
    const trustedName =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      (userData.user.email ? userData.user.email.split("@")[0] : null);
    if (!trustedName) throw new Error("Cannot determine signer name from account");

    const { data: row, error } = await (sb as unknown as LooseSb)
      .from("client_review_signoffs")
      .upsert(
        {
          client_id: data.clientId,
          scope: data.scope,
          signed_off_by_id: userData.user.id,
          signed_off_by_name: trustedName,
          signed_off_by_title: data.accountantTitle ?? null,
          firm_name: data.firmName ?? null,
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
      scope: z.enum(["financials", "cash_forecast"]),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertAccountant(userData.user.id, sb);
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const { error } = await (sb as unknown as LooseSb)
      .from("client_review_signoffs")
      .delete()
      .eq("client_id", data.clientId)
      .eq("scope", data.scope);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
