import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export const REVIEW_SCOPES = [
  "financials",
  "profitability",
  "cash_forecast",
  "budget",
  "action_plan",
  "advisory",
] as const;

export type ReviewScope = (typeof REVIEW_SCOPES)[number];

const ScopeSchema = z.enum(REVIEW_SCOPES);

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
  signature_data: string | null;
  signed_off_at: string;
};

export function indexReviewSignoffs(
  rows: ClientReviewSignoff[],
): Partial<Record<ReviewScope, ClientReviewSignoff>> {
  const m: Partial<Record<ReviewScope, ClientReviewSignoff>> = {};
  for (const r of rows) m[r.scope] = r;
  return m;
}

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
 * Sign-off is Partner-only at the database. Also block client-only logins
 * so an owner who also has a leftover accountant role cannot skip the
 * effective-classification check.
 */
async function assertCanSignOff(
  userId: string,
  clientId: string,
  sb: ReturnType<typeof authedSupabase>,
) {
  const { data, error } = await (sb as unknown as LooseSb)
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  const isClientOnly =
    (roles.includes("client_owner") || roles.includes("client_member")) &&
    !roles.includes("accountant") &&
    !roles.includes("firm_admin");
  if (isClientOnly) {
    throw new Error("Only practice portal users can sign off reviews");
  }
  const { data: allowed, error: capErr } = await sb.rpc("can_sign_off_deliverable" as never, {
    _user_id: userId,
    _client_id: clientId,
  } as never);
  if (capErr) throw new Error(capErr.message);
  if (!allowed) {
    throw new Error("Only a partner can sign off client deliverables.");
  }
}

export type DeliverableStatus = "draft" | "ready_for_review" | "signed_off";

export type DeliverableWorkflow = {
  status: DeliverableStatus;
  changeComment: string | null;
  canSubmit: boolean;
  canReview: boolean;
  canSignOff: boolean;
};

async function practiceCaps(userId: string, clientId: string, sb: ReturnType<typeof authedSupabase>) {
  const { data: cls } = await sb.rpc("effective_practice_classification" as never, {
    _user_id: userId,
    _client_id: clientId,
  } as never);
  const classification = typeof cls === "string" ? cls : "";
  const check = async (cap: string) => {
    const { data } = await sb.rpc("practice_can" as never, {
      _class: classification,
      _cap: cap,
    } as never);
    return Boolean(data);
  };
  return {
    canSubmit: await check("submit"),
    canReview: await check("review"),
    canSignOff: await check("sign_off"),
  };
}

async function loadDeliverableState(
  sb: LooseSb,
  clientId: string,
  scope: ReviewScope,
): Promise<{ status: DeliverableStatus; change_comment: string | null } | null> {
  const { data, error } = await sb
    .from("client_deliverable_states")
    .select("status, change_comment")
    .eq("client_id", clientId)
    .eq("scope", scope)
    .maybeSingle();
  if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message);
  if (!data) return null;
  return {
    status: (data.status as DeliverableStatus) ?? "draft",
    change_comment: (data.change_comment as string | null) ?? null,
  };
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
      scope: ScopeSchema.optional(),
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
      scope: ScopeSchema,
      accountantTitle: z.string().max(60).optional().nullable(),
      firmName: z.string().max(120).optional().nullable(),
      note: z.string().max(1000).optional().nullable(),
      signatureData: z.string().max(200_000).optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);
    await assertCanSignOff(userData.user.id, data.clientId, sb);

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
    const signatureData =
      typeof data.signatureData === "string" && data.signatureData.startsWith("data:image/")
        ? data.signatureData
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
          signature_data: signatureData,
          signed_off_at: new Date().toISOString(),
        },
        { onConflict: "client_id,scope" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { data: prior } = await (sb as unknown as LooseSb)
      .from("client_deliverable_states")
      .select("status")
      .eq("client_id", data.clientId)
      .eq("scope", data.scope)
      .maybeSingle();
    if (!prior) {
      const { error: seedErr } = await (sb as unknown as LooseSb)
        .from("client_deliverable_states")
        .upsert(
          {
            client_id: data.clientId,
            scope: data.scope,
            status: "ready_for_review",
            submitted_by: userData.user.id,
            submitted_at: new Date().toISOString(),
          },
          { onConflict: "client_id,scope" },
        );
      if (seedErr && !/does not exist|schema cache/i.test(seedErr.message)) {
        throw new Error(seedErr.message);
      }
    } else if (prior.status === "draft") {
      const { error: readyErr } = await (sb as unknown as LooseSb)
        .from("client_deliverable_states")
        .update({
          status: "ready_for_review",
          submitted_by: userData.user.id,
          submitted_at: new Date().toISOString(),
        })
        .eq("client_id", data.clientId)
        .eq("scope", data.scope);
      if (readyErr && !/does not exist|schema cache/i.test(readyErr.message)) {
        throw new Error(readyErr.message);
      }
    }
    const { error: stateErr } = await (sb as unknown as LooseSb)
      .from("client_deliverable_states")
      .update({
        status: "signed_off",
        content_snapshot: {
          signed_off_by_name: trustedName,
          signed_off_at: (row as ClientReviewSignoff).signed_off_at,
          scope: data.scope,
          note: data.note ?? null,
        },
        signed_off_by: userData.user.id,
        signed_off_at: new Date().toISOString(),
        change_comment: null,
      })
      .eq("client_id", data.clientId)
      .eq("scope", data.scope);
    if (stateErr && !/does not exist|schema cache/i.test(stateErr.message)) {
      throw new Error(stateErr.message);
    }
    try {
      await sb.rpc("write_audit_log" as never, {
        _action: "deliverable_signed_off",
        _client_id: data.clientId,
        _details: { scope: data.scope },
        _actor_id: userData.user.id,
      } as never);
    } catch {
      /* audit is best-effort when the amendment migration is not applied */
    }
    return row as ClientReviewSignoff;
  });

// ── Remove a sign-off ────────────────────────────────────────────────────────

export const removeReviewSignoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      clientId: z.string().uuid(),
      scope: ScopeSchema,
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);
    await assertCanSignOff(userData.user.id, data.clientId, sb);

    const { error } = await (sb as unknown as LooseSb)
      .from("client_review_signoffs")
      .delete()
      .eq("client_id", data.clientId)
      .eq("scope", data.scope);
    if (error) throw new Error(error.message);
    await (sb as unknown as LooseSb)
      .from("client_deliverable_states")
      .update({ status: "draft", signed_off_by: null, signed_off_at: null })
      .eq("client_id", data.clientId)
      .eq("scope", data.scope);
    return { ok: true };
  });

export const getDeliverableWorkflow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), scope: ScopeSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<DeliverableWorkflow> => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);
    const state = await loadDeliverableState(sb as unknown as LooseSb, data.clientId, data.scope);
    let caps = { canSubmit: true, canReview: true, canSignOff: true };
    try {
      caps = await practiceCaps(userData.user.id, data.clientId, sb);
    } catch {
      /* amendment RPCs may be missing until the SQL is applied */
    }
    return {
      status: state?.status ?? "draft",
      changeComment: state?.change_comment ?? null,
      ...caps,
    };
  });

export const submitDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), scope: ScopeSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);
    const caps = await practiceCaps(userData.user.id, data.clientId, sb);
    if (!caps.canSubmit) throw new Error("This professional level cannot submit for review.");
    const now = new Date().toISOString();
    const { error } = await (sb as unknown as LooseSb)
      .from("client_deliverable_states")
      .upsert(
        {
          client_id: data.clientId,
          scope: data.scope,
          status: "ready_for_review",
          submitted_by: userData.user.id,
          submitted_at: now,
          change_comment: null,
        },
        { onConflict: "client_id,scope" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const, status: "ready_for_review" as const };
  });

export const requestDeliverableChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        scope: ScopeSchema,
        comment: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);
    const caps = await practiceCaps(userData.user.id, data.clientId, sb);
    if (!caps.canReview) throw new Error("This professional level cannot request changes.");
    const { error } = await (sb as unknown as LooseSb)
      .from("client_deliverable_states")
      .upsert(
        {
          client_id: data.clientId,
          scope: data.scope,
          status: "draft",
          change_comment: data.comment ?? null,
          signed_off_by: null,
          signed_off_at: null,
        },
        { onConflict: "client_id,scope" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const, status: "draft" as const };
  });
