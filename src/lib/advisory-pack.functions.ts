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
 * comment / approve / request_changes / reject / deliver / read / invalidate.
 * Edit stats (AI draft vs current) are computed here and stored with the action.
 * Approve is refused, and an existing sign-off is cleared, when the snapshot
 * baked into the pack no longer matches live Overview figures.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LooseSb } from "@/lib/advisory-state.functions";
import { assertStarterTrialAllowsNewWork } from "@/lib/firm-client-cap.server";
import {
  ADVISORY_PACK_STALE_NOTE,
  PACK_APP_ACTIONS,
  PACK_SECTION_KEYS,
  advisoryPackFiguresChanged,
  buildAdvisoryPack,
  computeEditStats,
  isMissingPackRelation,
  livePackMetrics,
  parsePackReviewRow,
  parsePackRow,
  type AdvisoryPack,
  type AdvisoryPackContent,
  type LivePackFigures,
  type LivePackMetrics,
  type PackReview,
  type PackSection,
} from "@/lib/advisory-pack";
import { parseOperatingProfile } from "@/lib/client-profile";
import { coerceMarketSelection } from "@/lib/market/parse";
import { ZA_MARKET, resolveMarket } from "@/lib/market/resolve";
import { resolvePriorSnapshot } from "@/lib/prior-period";
import { parseDataRequestRow, type DataRequest } from "@/lib/data-requests";
import { overviewRatios } from "@/lib/health-score";
import { outcomeStories } from "@/lib/outcomes";
import {
  parseRecommendationRow,
  type Recommendation,
  type RecommendationOutcome,
} from "@/lib/recommendations";

async function assertClientAccess(sb: LooseSb, userId: string, clientId: string) {
  const { data, error } = await sb.rpc("has_client_access", {
    _user_id: userId,
    _client_id: clientId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this client");
}

async function firmIdOfClient(sb: LooseSb, clientId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("clients")
    .select("firm_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const firmId = (data as { firm_id?: string | null } | null)?.firm_id;
  return firmId ?? null;
}

function actorEmail(context: unknown): string {
  const claims = (context as { claims?: { email?: string | null } | null } | null)?.claims;
  return claims?.email ?? "";
}

/**
 * Server gate in front of a new pack or brain deliverable.
 * brain-deliverable-draft applies the same check itself.
 */
export const assertFirmCanGenerateDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const firmId = await firmIdOfClient(sb, data.clientId);
    await assertStarterTrialAllowsNewWork({
      supabase: context.supabase,
      userId: context.userId,
      email: actorEmail(context),
      firmId,
    });
    return { ok: true as const };
  });

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

type ClientFigureRow = {
  name?: string;
  firm_id?: string | null;
  financials?: Record<string, unknown> | null;
  cashflow?: unknown;
  financials_updated_at?: string | null;
  market?: unknown;
  operating_profile?: unknown;
};

type SnapshotFigureRow = {
  id?: string;
  period_label?: string | null;
  period_date?: string | null;
  ratios?: Record<string, number> | null;
  financials?: Record<string, unknown> | null;
};

function hasStatementFigures(fin: Record<string, unknown> | null | undefined): boolean {
  if (!fin) return false;
  return ["revenue", "cogs", "ebit", "netIncome", "receivables", "payables"].some((key) => {
    const value = fin[key];
    return value != null && String(value).trim() !== "";
  });
}

/**
 * Live Overview metrics plus the snapshot rows a pack version is filed against.
 * Health and ratios are recomputed here — stored snapshot ratios can still
 * be the unadjusted annual pass (health 78) after Overview moved to 71.
 */
async function loadOverviewContext(
  sb: LooseSb,
  clientId: string,
  now: Date,
): Promise<{
  row: ClientFigureRow | null;
  snaps: SnapshotFigureRow[];
  prior: ReturnType<typeof resolvePriorSnapshot>;
  metrics: LivePackMetrics;
  fyStartMonth: number;
}> {
  const { data, error } = await sb
    .from("clients")
    .select("name, firm_id, financials, cashflow, financials_updated_at, market, operating_profile")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? null) as ClientFigureRow | null;
  const financials =
    row?.financials && typeof row.financials === "object" && !Array.isArray(row.financials)
      ? row.financials
      : null;
  let market = ZA_MARKET;
  try {
    market = resolveMarket(coerceMarketSelection(row?.market));
  } catch {
    market = ZA_MARKET;
  }
  const profile = parseOperatingProfile(row?.operating_profile);
  const fyStartMonth = profile?.fyStartMonth ?? market.fyStartMonthDefault;
  const { data: snapData } = await sb
    .from("client_financial_snapshots")
    .select("id, period_label, period_date, ratios, financials")
    .eq("client_id", clientId)
    .order("period_date", { ascending: false })
    .limit(24);
  const snaps = (snapData ?? []) as SnapshotFigureRow[];
  const prior = resolvePriorSnapshot(
    snaps.map((snap) => ({
      id: snap.id,
      period_label: snap.period_label ?? "",
      period_date: snap.period_date ?? "",
      financials: snap.financials ?? null,
      ratios: snap.ratios ?? null,
    })),
    now,
    {
      financials,
      periodEnd: typeof financials?.periodEnd === "string" ? financials.periodEnd : null,
    },
  );
  const metrics = livePackMetrics({
    financials,
    cashflow: row?.cashflow,
    financialsUpdatedAt: row?.financials_updated_at ?? null,
    priorFinancials: prior?.financials ?? null,
    market,
    fyStartMonth,
    timeZone: market.timezone,
    now,
  });
  return { row, snaps, prior, metrics, fyStartMonth };
}

export async function gatherPackInputs(
  sb: LooseSb,
  clientId: string,
  now: string,
): Promise<Parameters<typeof buildAdvisoryPack>[0] | null> {
  const nowDate = new Date(now);
  const [overview, recsRes, reqsRes, openRes, overdueRes, outcomesRes] = await Promise.all([
    loadOverviewContext(sb, clientId, Number.isFinite(nowDate.getTime()) ? nowDate : new Date()),
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
    sb
      .from("recommendation_outcomes")
      .select("*")
      .eq("client_id", clientId)
      .order("measured_at", { ascending: false })
      .limit(300),
  ]);
  const client = overview.row;
  if (!client) throw new Error("Client not found");
  if (overview.snaps.length === 0) return null;
  const current = overview.snaps[0];
  const prior = overview.prior;

  let firmName: string | null = null;
  if (client.firm_id) {
    const { data: firm } = await sb
      .from("firms")
      .select("name")
      .eq("id", client.firm_id)
      .maybeSingle();
    firmName = (firm as { name?: string } | null)?.name ?? null;
  }

  const recommendations: Recommendation[] = (recsRes.error ? [] : (recsRes.data ?? [])).map(
    (r: Record<string, unknown>) => parseRecommendationRow(r),
  );
  const dataRequests: DataRequest[] = (reqsRes.error ? [] : (reqsRes.data ?? [])).map(
    (r: Record<string, unknown>) => parseDataRequestRow(r),
  );
  const priorRatios =
    prior?.financials && hasStatementFigures(prior.financials)
      ? overviewRatios(prior.financials, { fyStartMonth: overview.fyStartMonth })
      : (prior?.ratios ?? null);

  return {
    clientName: client.name ?? "",
    firmName,
    hasFirm: client.firm_id !== null,
    periodLabel: current.period_label ?? null,
    priorPeriodLabel: prior?.period_label ?? null,
    figuresAsOf: current.period_date ?? client.financials_updated_at ?? null,
    health: overview.metrics.health.overall == null ? null : overview.metrics.health,
    ratios: overview.metrics.ratios,
    priorRatios,
    openingBalance: overview.metrics.openingBalance,
    closings: overview.metrics.closings,
    cashRunwayWeeks: overview.metrics.cashRunwayWeeks,
    runwayLabel: overview.metrics.runwayLabel,
    recommendations,
    dataRequests,
    openActions: openRes.error ? 0 : (openRes.count ?? 0),
    overdueActions: overdueRes.error ? 0 : (overdueRes.count ?? 0),
    outcomes: outcomeStories(
      recommendations,
      (outcomesRes.error ? [] : (outcomesRes.data ?? [])) as RecommendationOutcome[],
    ),
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
    const firmId = await firmIdOfClient(sb, data.clientId);
    await assertStarterTrialAllowsNewWork({
      supabase: context.supabase,
      userId: context.userId,
      email: actorEmail(context),
      firmId,
    });
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

/**
 * Same Overview health, cash, and runway the pack panel compares to the
 * snapshot stored on `content`.
 */
async function loadLivePackFigures(sb: LooseSb, clientId: string): Promise<LivePackFigures> {
  const overview = await loadOverviewContext(sb, clientId, new Date());
  return overview.metrics.figures;
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
        /** Overview figures the pack panel is showing. Drift on either side blocks sign-off. */
        liveFigures: z
          .object({
            runwayLabel: z.string().nullable(),
            cash: z.number().finite().nullable(),
            healthScore: z.number().finite().nullable(),
          })
          .optional(),
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

    if (data.action === "approve" || data.action === "invalidate") {
      const liveFigures = await loadLivePackFigures(sb, data.clientId);
      const figuresChanged =
        advisoryPackFiguresChanged(pack.content, liveFigures) ||
        (data.liveFigures ? advisoryPackFiguresChanged(pack.content, data.liveFigures) : false);
      if (data.action === "invalidate") {
        if (!figuresChanged || pack.status !== "approved") {
          const reviews = await loadReviews(sb, data.packId);
          return { ok: true, pack, reviews };
        }
      } else if (figuresChanged) {
        throw new Error(ADVISORY_PACK_STALE_NOTE);
      }
    }

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
