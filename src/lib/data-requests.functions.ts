/**
 * Active data requests — server functions (P0.6).
 *
 * `syncDataRequests` gathers the facts the pure detector needs, runs it, and
 * upserts through the `data_requests_sync` RPC (opens missing system asks,
 * auto-closes ones whose rule stopped firing, never touches human asks).
 * The Next Step card calls it before `getNextStep` so a blocking request is
 * never a stale count. Everything degrades to "no requests" on a database
 * that predates the P0.6 migration.
 *
 * Email goes through the same Resend transport as practice-access mail; the
 * link only ever points at the owner board (GET never mutates).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdvisorySnapshot, type LooseSb } from "@/lib/advisory-state.functions";
import { inviteSiteUrl } from "@/lib/client-invite-email";
import {
  DATA_REQUEST_KIND_LABELS,
  DATA_REQUEST_KINDS,
  DATA_REQUEST_SEVERITIES,
  OPEN_DATA_REQUEST_STATUSES,
  dataRequestEmail,
  detectDataGaps,
  isMissingDataRequestRelation,
  parseDataRequestRow,
  sortDataRequests,
  suppressRecentlyResolved,
  type DataGapFacts,
  type DataRequest,
} from "@/lib/data-requests";
import { sendAccessEmail } from "@/lib/practice-access-email";

async function assertClientAccess(sb: LooseSb, userId: string, clientId: string) {
  const { data, error } = await sb.rpc("has_client_access", {
    _user_id: userId,
    _client_id: clientId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this client");
}

async function loadRequests(
  sb: LooseSb,
  clientId: string,
  opts: { openOnly: boolean },
): Promise<{ rows: DataRequest[]; migrated: boolean }> {
  let q = sb.from("data_requests").select("*").eq("client_id", clientId);
  if (opts.openOnly) q = q.in("status", OPEN_DATA_REQUEST_STATUSES as readonly string[]);
  const { data, error } = await q.order("requested_at", { ascending: false });
  if (error) {
    if (isMissingDataRequestRelation(error)) return { rows: [], migrated: false };
    throw new Error(error.message);
  }
  return {
    rows: sortDataRequests(((data ?? []) as Record<string, unknown>[]).map(parseDataRequestRow)),
    migrated: true,
  };
}

// ── list ─────────────────────────────────────────────────────────────────────

export const listDataRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), includeClosed: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ requests: DataRequest[]; migrated: boolean }> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const { rows, migrated } = await loadRequests(sb, data.clientId, {
      openOnly: !data.includeClosed,
    });
    return { requests: rows, migrated };
  });

// ── sync (detector) ──────────────────────────────────────────────────────────

export type SyncDataRequestsResult = {
  migrated: boolean;
  opened: number;
  closed: number;
  open: number;
  facts: DataGapFacts;
};

export async function gatherDataGapFacts(
  sb: LooseSb,
  userId: string,
  clientId: string,
  now: string,
): Promise<DataGapFacts> {
  const snapshot = await loadAdvisorySnapshot(sb, userId, { clientId, eventLimit: 0 });

  const [clientRes, snapRes, artRes] = await Promise.all([
    sb
      .from("clients")
      .select("financials_updated_at, last_forecast_at, cashflow")
      .eq("id", clientId)
      .maybeSingle(),
    sb
      .from("client_financial_snapshots")
      .select("period_date, ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("client_artifacts").select("kind, meta").eq("client_id", clientId).limit(200),
  ]);
  if (clientRes.error) throw new Error(clientRes.error.message);
  const client = (clientRes.data ?? {}) as {
    financials_updated_at?: string | null;
    last_forecast_at?: string | null;
    cashflow?: { openingBalance?: string | number | null } | null;
  };
  const snap = (snapRes.error ? null : snapRes.data) as {
    period_date?: string | null;
    ratios?: Record<string, number> | null;
  } | null;

  const artifactTags = new Set<string>();
  if (!artRes.error) {
    for (const a of (artRes.data ?? []) as Array<{
      kind: string;
      meta: Record<string, unknown> | null;
    }>) {
      artifactTags.add(a.kind);
      const tag = a.meta?.kind ?? a.meta?.document_type;
      if (typeof tag === "string") artifactTags.add(tag);
    }
  }

  const dates = [snap?.period_date ?? null, client.financials_updated_at ?? null]
    .filter((d): d is string => typeof d === "string" && Number.isFinite(Date.parse(d)))
    .sort();
  const figuresAsOf = dates.length ? dates[dates.length - 1] : null;

  return {
    state: snapshot.state,
    figuresAsOf,
    ratios: snap?.ratios && typeof snap.ratios === "object" ? snap.ratios : null,
    hasForecast: client.last_forecast_at != null,
    forecastOpeningBalance: client.cashflow?.openingBalance ?? null,
    hasAgedDebtors: artifactTags.has("aged_debtors"),
    hasAgedCreditors: artifactTags.has("aged_creditors"),
    now,
  };
}

export const syncDataRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        /** Test hook; production callers leave it unset. */
        now: z.string().datetime().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SyncDataRequestsResult> => {
    const sb = context.supabase as unknown as LooseSb;
    const now = data.now ?? new Date().toISOString();
    const facts = await gatherDataGapFacts(sb, context.userId, data.clientId, now);

    const existing = await loadRequests(sb, data.clientId, { openOnly: false });
    if (!existing.migrated) return { migrated: false, opened: 0, closed: 0, open: 0, facts };

    // A manually fulfilled ageing request counts as "on file" for the detector.
    for (const r of existing.rows) {
      if (r.status !== "fulfilled") continue;
      if (r.kind === "aged_debtors") facts.hasAgedDebtors = true;
      if (r.kind === "aged_creditors") facts.hasAgedCreditors = true;
    }

    const wanted = suppressRecentlyResolved(detectDataGaps(facts), existing.rows, now);
    const { data: res, error } = await sb.rpc("data_requests_sync", {
      p_client_id: data.clientId,
      p_wanted: wanted,
    });
    if (error) {
      if (isMissingDataRequestRelation(error))
        return { migrated: false, opened: 0, closed: 0, open: 0, facts };
      throw new Error(error.message);
    }
    const row = (Array.isArray(res) ? res[0] : res) as
      | { opened?: number; closed?: number; open_total?: number }
      | null
      | undefined;
    return {
      migrated: true,
      opened: row?.opened ?? 0,
      closed: row?.closed ?? 0,
      open: row?.open_total ?? 0,
      facts,
    };
  });

// ── manual ask (accountant or owner) ─────────────────────────────────────────

export const createDataRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        kind: z.enum(DATA_REQUEST_KINDS),
        title: z.string().min(1).max(160).optional(),
        reason: z.string().max(1000).optional(),
        severity: z.enum(DATA_REQUEST_SEVERITIES).optional(),
        dueAt: z.string().datetime().optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; request: DataRequest } | { ok: false; reason: "not_migrated" }> => {
      const sb = context.supabase as unknown as LooseSb;
      await assertClientAccess(sb, context.userId, data.clientId);

      const clientRes = await sb
        .from("clients")
        .select("owner_user_id")
        .eq("id", data.clientId)
        .maybeSingle();
      if (clientRes.error) throw new Error(clientRes.error.message);
      const isOwner = clientRes.data?.owner_user_id === context.userId;

      const { data: row, error } = await sb
        .from("data_requests")
        .insert({
          client_id: data.clientId,
          kind: data.kind,
          title: data.title?.trim() || DATA_REQUEST_KIND_LABELS[data.kind].label,
          reason: data.reason?.trim() || null,
          severity: data.severity ?? "important",
          source: isOwner ? "owner" : "accountant",
          requested_by: context.userId,
          due_at: data.dueAt ?? null,
        })
        .select("*")
        .single();
      if (error) {
        if (isMissingDataRequestRelation(error)) return { ok: false, reason: "not_migrated" };
        throw new Error(error.message);
      }
      return { ok: true, request: parseDataRequestRow(row as Record<string, unknown>) };
    },
  );

// ── resolve (fulfil by hand / waive) ─────────────────────────────────────────

export const resolveDataRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        requestId: z.string().uuid(),
        resolution: z.enum(["fulfilled", "waived"]),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; request: DataRequest }> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const patch =
      data.resolution === "fulfilled"
        ? {
            status: "fulfilled",
            fulfilled_at: new Date().toISOString(),
            fulfilled_by: context.userId,
            fulfilled_with: { manual: true, note: data.note?.trim() || null },
          }
        : {
            status: "waived",
            fulfilled_at: new Date().toISOString(),
            fulfilled_by: context.userId,
            waived_reason: data.note?.trim() || null,
          };
    const { data: row, error } = await sb
      .from("data_requests")
      .update(patch)
      .eq("id", data.requestId)
      .eq("client_id", data.clientId)
      .in("status", OPEN_DATA_REQUEST_STATUSES as readonly string[])
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Request not found or already closed");
    return { ok: true, request: parseDataRequestRow(row as Record<string, unknown>) };
  });

// ── email the owner ──────────────────────────────────────────────────────────

export type SendDataRequestEmailResult =
  | { ok: true; to: string; count: number }
  | {
      ok: false;
      reason: "no_open_requests" | "no_recipient" | "not_configured" | "self";
      detail?: string;
    };

export const sendDataRequestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        /** Restrict to specific requests; default = every open one. */
        requestIds: z.array(z.string().uuid()).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SendDataRequestEmailResult> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);

    const clientRes = await sb
      .from("clients")
      .select("name, owner_user_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (clientRes.error) throw new Error(clientRes.error.message);
    const client = clientRes.data as { name: string; owner_user_id: string | null } | null;
    if (!client) throw new Error("Client not found");
    if (!client.owner_user_id) return { ok: false, reason: "no_recipient" };
    // The owner emailing themselves is a no-op; the request is already on their board.
    if (client.owner_user_id === context.userId) return { ok: false, reason: "self" };

    const { rows } = await loadRequests(sb, data.clientId, { openOnly: true });
    const chosen = data.requestIds ? rows.filter((r) => data.requestIds!.includes(r.id)) : rows;
    if (chosen.length === 0) return { ok: false, reason: "no_open_requests" };

    const [ownerRes, meRes] = await Promise.all([
      sb.from("profiles").select("email, full_name").eq("id", client.owner_user_id).maybeSingle(),
      sb.from("profiles").select("full_name").eq("id", context.userId).maybeSingle(),
    ]);
    const owner = ownerRes.data as { email: string | null; full_name: string | null } | null;
    if (!owner?.email || !owner.email.includes("@")) return { ok: false, reason: "no_recipient" };

    const href = `${inviteSiteUrl()}/app?tab=today`;
    const mail = dataRequestEmail({
      clientName: client.name,
      recipientName: owner.full_name,
      requesterName: (meRes.data as { full_name?: string | null } | null)?.full_name ?? null,
      requests: chosen,
      href,
    });
    const sent = await sendAccessEmail({
      to: owner.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `data-request:${data.clientId}:${chosen
        .map((r) => r.id)
        .sort()
        .join(",")}:${new Date().toISOString().slice(0, 13)}`,
    });
    if (!sent.ok) {
      return {
        ok: false,
        reason: /not configured/i.test(sent.error) ? "not_configured" : "no_recipient",
        detail: sent.error,
      };
    }

    const nowIso = new Date().toISOString();
    const { error: upErr } = await sb
      .from("data_requests")
      .update({ status: "sent", sent_at: nowIso, sent_to: owner.email, last_reminded_at: nowIso })
      .in(
        "id",
        chosen.map((r) => r.id),
      )
      .eq("client_id", data.clientId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true, to: owner.email, count: chosen.length };
  });
