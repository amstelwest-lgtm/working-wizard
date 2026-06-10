import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type InterventionSignoff = {
  id: string;
  client_id: string;
  submission_period: string;
  ratio_key: string;
  step_number: number;
  signed_off_by_id: string;
  signed_off_by_name: string;
  signed_off_by_title: string | null;
  firm_name: string | null;
  accountant_note: string | null;
  signed_off_at: string;
};

function currentPeriod(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

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

// Tables created in 20260524000000_intervention_signoffs.sql are not yet
// present in the auto-generated Database type; cast through `any` here until
// the type file is regenerated post-migration.
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

// ── List sign-offs for a client/ratio ────────────────────────────────────────

export const listInterventionSignoffs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      ratioKey: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const period = currentPeriod();
    const { data: rows, error } = await (sb as unknown as LooseSb)
      .from("intervention_signoffs")
      .select("*")
      .eq("client_id", data.clientId)
      .eq("submission_period", period)
      .eq("ratio_key", data.ratioKey);
    if (error) throw new Error(error.message);
    return { period, signoffs: (rows ?? []) as InterventionSignoff[] };
  });

// ── Sign off a step ──────────────────────────────────────────────────────────

export const signoffInterventionStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      ratioKey: z.string().min(1),
      stepNumber: z.number().int().positive(),
      // Identity is taken from the JWT server-side; the client only declares
      // the firm + optional title (self-attestation, no trusted source yet)
      // and an optional note.
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

    // Trusted display name from auth user metadata; never accept name from client.
    const meta = (userData.user.user_metadata ?? {}) as Record<string, unknown>;
    const trustedName =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      (userData.user.email ? userData.user.email.split("@")[0] : null);
    if (!trustedName) throw new Error("Cannot determine signer name from account");

    const period = currentPeriod();
    const { data: row, error } = await (sb as unknown as LooseSb)
      .from("intervention_signoffs")
      .upsert(
        {
          client_id: data.clientId,
          submission_period: period,
          ratio_key: data.ratioKey,
          step_number: data.stepNumber,
          signed_off_by_id: userData.user.id,
          signed_off_by_name: trustedName,
          signed_off_by_title: data.accountantTitle ?? null,
          firm_name: data.firmName ?? null,
          accountant_note: data.note ?? null,
          signed_off_at: new Date().toISOString(),
        },
        { onConflict: "client_id,submission_period,ratio_key,step_number" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as InterventionSignoff;
  });

// ── Remove a sign-off ────────────────────────────────────────────────────────

export const removeInterventionSignoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      ratioKey: z.string().min(1),
      stepNumber: z.number().int().positive(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertAccountant(userData.user.id, sb);

    const period = currentPeriod();
    const { error } = await (sb as unknown as LooseSb)
      .from("intervention_signoffs")
      .delete()
      .eq("client_id", data.clientId)
      .eq("submission_period", period)
      .eq("ratio_key", data.ratioKey)
      .eq("step_number", data.stepNumber)
      .eq("signed_off_by_id", userData.user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
