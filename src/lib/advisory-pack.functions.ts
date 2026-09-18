/**
 * Advisory pack — server functions (P1.1 / P1.2).
 *
 * `generateAdvisoryPack` gathers everything the pure builder needs (health,
 * ratios, forecast closings, recommendations, open data requests, action
 * counts) through the caller's RLS-scoped client, builds the content
 * deterministically, and hands it to the `advisory_pack_create` RPC, which
 * versions it, supersedes the previous open pack and writes the audit row.
 *
 * `reviewAdvisoryPack` is the single write path for the review trail: edit /
 * comment / approve / request_changes / reject / deliver / read. Edit stats
 * (AI draft vs current) are computed here and stored with the action.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LooseSb } from "@/lib/advisory-state.functions";
import {
  PACK_APP_ACTIONS,
  PACK_SECTION_KEYS,
  buildAdvisoryPack,
  computeEditStats,
  isMissingPackRelation,
  parsePackReviewRow,
  parsePackRow,
  type AdvisoryPack,
  type AdvisoryPackContent,
  type PackReview,
  type PackSection,
} from "@/lib/advisory-pack";
import {
  closingBalancesFromCashflow,
  effectiveCashRunwayWeeks,
  type SavedCashflowLike,
} from "@/lib/cash-runway";
import { parseDataRequestRow, type DataRequest } from "@/lib/data-requests";
import { computeOverallHealth } from "@/lib/health-score";
import { parseRecommendationRow, type Recommendation } from "@/lib/recommendations";

async function assertClientAccess(sb: LooseSb, userId: string, clientId: string) {
  const { data, error } = await sb.rpc("has_client_access", {
    _user_id: userId,
    _client_id: clientId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this client");
}

async function loadPackRows(
  sb: LooseSb,
  clientId: string,
  opts: { limit: number },
): Promise<{ rows: AdvisoryPack[]; migrated: boolean }> {
  const { data, error } = await sb
    .from("advisory_packs")
    .select("*")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(opts.limit);
  if (error) {
    if (isMissingPackRelation(error)) return { rows: [], migrated: false };
    throw new Error(error.message);
  }
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(parsePackRow), migrated: true };
}

async function loadReviews(sb: LooseSb, packId: string): Promise<PackReview[]> {
  const { data, error } = await sb
    .from("advisory_pack_reviews")
    .select("*")
    .eq("pack_id", packId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    if (isMissingPackRelation(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(parsePackReviewRow);
}

// ── read ─────────────────────────────────────────────────────────────────────

export type LatestPackResult = {
  migrated: boolean;
  pack: AdvisoryPack | null;
  reviews: PackReview[];
  /** Versions available (newest first), for the version switcher. */
  versions: Array<
    Pick<AdvisoryPack, "id" | "version" | "status" | "generated_at" | "period_label">
  >;
};

export const getLatestAdvisoryPack = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), packId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<LatestPackResult> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const { rows, migrated } = await loadPackRows(sb, data.clientId, { limit: 25 });
    if (!migrated || rows.length === 0) return { migrated, pack: null, reviews: [], versions: [] };
    const pack = (data.packId ? rows.find((r) => r.id === data.packId) : null) ?? rows[0];
    const reviews = await loadReviews(sb, pack.id);
    return {
      migrated,
      pack,
      reviews,
      versions: rows.map((r) => ({
        id: r.id,
        version: r.version,
        status: r.status,
        generated_at: r.generated_at,
        period_label: r.period_label,
      })),
    };
  });

// ── generate ─────────────────────────────────────────────────────────────────

export type GeneratePackResult =
  | { ok: true; pack: AdvisoryPack }
  | { ok: false; reason: "not_migrated" | "no_figures" };

export async function gatherPackInputs(
  sb: LooseSb,
  clientId: string,
  now: string,
): Promise<Parameters<typeof buildAdvisoryPack>[0] | null> {
  const [clientRes, snapsRes, recsRes, reqsRes, openRes, overdueRes] = await Promise.all([
    sb
      .from("clients")
      .select("name, firm_id, cashflow, cash_runway_weeks, financials_updated_at")
      .eq("id", clientId)
      .maybeSingle(),
    sb
      .from("client_financial_snapshots")
      .select("id, period_label, period_date, ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(2),
    sb
      .from("proposed_next_steps")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ["proposed", "approved", "edited"])
      .limit(50),
    sb
      .from("data_requests")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ["open", "sent"])
      .limit(50),
    sb
      .from("action_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .neq("status", "done"),
    sb
      .from("action_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .neq("status", "done")
      .lt("due_date", now.slice(0, 10)),
  ]);
  if (clientRes.error) throw new Error(clientRes.error.message);
  const client = clientRes.data as {
    name: string;
    firm_id: string | null;
    cashflow: SavedCashflowLike | null;
    cash_runway_weeks: number | null;
    financials_updated_at: string | null;
  } | null;
  if (!client) throw new Error("Client not found");

  const snaps = (snapsRes.error ? [] : (snapsRes.data ?? [])) as Array<{
    id: string;
    period_label: string | null;
    period_date: string | null;
    ratios: Record<string, number> | null;
  }>;
  if (snaps.length === 0) return null;
  const current = snaps[0];
  const prior = snaps[1] ?? null;

  let firmName: string | null = null;
  if (client.firm_id) {
    const { data: firm } = await sb
      .from("firms")
      .select("name")
      .eq("id", client.firm_id)
      .maybeSingle();
    firmName = (firm as { name?: string } | null)?.name ?? null;
  }

  const cashRunwayWeeks = effectiveCashRunwayWeeks(client.cash_runway_weeks, client.cashflow);
  const closings = closingBalancesFromCashflow(client.cashflow);
  const openingRaw = client.cashflow?.openingBalance;
  const opening =
    openingRaw !== undefined && openingRaw !== null && String(openingRaw).trim() !== ""
      ? Number(String(openingRaw).replace(/[,\s]/g, ""))
      : null;

  const recommendations: Recommendation[] = (recsRes.error ? [] : (recsRes.data ?? [])).map(
    (r: Record<string, unknown>) => parseRecommendationRow(r),
  );
  const dataRequests: DataRequest[] = (reqsRes.error ? [] : (reqsRes.data ?? [])).map(
    (r: Record<string, unknown>) => parseDataRequestRow(r),
  );

  const health = current.ratios
    ? computeOverallHealth({ ratios: current.ratios, cashRunwayWeeks })
    : null;

  return {
    clientName: client.name,
    firmName,
    hasFirm: client.firm_id !== null,
    periodLabel: current.period_label,
    priorPeriodLabel: prior?.period_label ?? null,
    figuresAsOf: current.period_date ?? client.financials_updated_at ?? null,
    health,
    ratios: current.ratios,
    priorRatios: prior?.ratios ?? null,
    openingBalance: opening !== null && Number.isFinite(opening) ? opening : null,
    closings,
    cashRunwayWeeks,
    recommendations,
    dataRequests,
    openActions: openRes.error ? 0 : (openRes.count ?? 0),
    overdueActions: overdueRes.error ? 0 : (overdueRes.count ?? 0),
    now,
  };
}

export const generateAdvisoryPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), now: z.string().datetime().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<GeneratePackResult> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const now = data.now ?? new Date().toISOString();

    const inputs = await gatherPackInputs(sb, data.clientId, now);
    if (!inputs) return { ok: false, reason: "no_figures" };
    const content = buildAdvisoryPack(inputs);

    const { data: snap } = await sb
      .from("client_financial_snapshots")
      .select("id")
      .eq("client_id", data.clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: packId, error } = await sb.rpc("advisory_pack_create", {
      p_client_id: data.clientId,
      p_content: content,
      p_period_label: content.periodLabel,
      p_figures_as_of: content.figuresAsOf ? content.figuresAsOf.slice(0, 10) : null,
      p_snapshot_id: (snap as { id?: string } | null)?.id ?? null,
      p_generator: "rules",
    });
    if (error) {
      if (isMissingPackRelation(error)) return { ok: false, reason: "not_migrated" };
      throw new Error(error.message);
    }
    const { data: row, error: readErr } = await sb
      .from("advisory_packs")
      .select("*")
      .eq("id", String(packId))
      .single();
    if (readErr) throw new Error(readErr.message);
    return { ok: true, pack: parsePackRow(row as Record<string, unknown>) };
  });

// ── review ───────────────────────────────────────────────────────────────────

const SectionPatch = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().max(4000).optional(),
  bullets: z.array(z.string().max(500)).max(20).optional(),
});

export type ReviewPackResult = { ok: true; pack: AdvisoryPack; reviews: PackReview[] };

function applySectionPatch(
  content: AdvisoryPackContent,
  key: string,
  patch: z.infer<typeof SectionPatch>,
): AdvisoryPackContent {
  return {
    ...content,
    sections: content.sections.map(
      (s): PackSection => (s.key === key ? { ...s, ...patch, key: s.key } : s),
    ),
  };
}

export const reviewAdvisoryPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        packId: z.string().uuid(),
        action: z.enum(PACK_APP_ACTIONS),
        section: z.enum(PACK_SECTION_KEYS).optional(),
        patch: SectionPatch.optional(),
        note: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ReviewPackResult> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);

    const { data: before, error: readErr } = await sb
      .from("advisory_packs")
      .select("*")
      .eq("id", data.packId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!before) throw new Error("Pack not found");
    const pack = parsePackRow(before as Record<string, unknown>);

    let editStats = pack.edit_stats;
    let after: Record<string, unknown> | null = null;
    if (data.action === "edit") {
      if (!data.section || !data.patch) throw new Error("edit needs a section and a patch");
      const target = pack.content.sections.find((s) => s.key === data.section);
      if (target?.locked) throw new Error("This section is fixed and cannot be edited");
      const next = applySectionPatch(pack.content, data.section, data.patch);
      editStats = computeEditStats(pack.ai_draft, next);
      after = { ...data.patch };
    } else if (
      data.action === "approve" ||
      data.action === "reject" ||
      data.action === "request_changes"
    ) {
      editStats = computeEditStats(pack.ai_draft, pack.content);
    }

    const { error } = await sb.rpc("advisory_pack_review", {
      p_pack_id: data.packId,
      p_action: data.action,
      p_section: data.section ?? null,
      p_after: after,
      p_note: data.note ?? null,
      p_edit_stats: editStats,
    });
    if (error) throw new Error(error.message);

    const [{ data: row, error: e2 }, reviews] = await Promise.all([
      sb.from("advisory_packs").select("*").eq("id", data.packId).single(),
      loadReviews(sb, data.packId),
    ]);
    if (e2) throw new Error(e2.message);
    return { ok: true, pack: parsePackRow(row as Record<string, unknown>), reviews };
  });
