/**
 * Accountant portfolio — server function (P2.3).
 *
 * Gathers per-client facts for every client the caller can see in a firm,
 * in a handful of batched queries (never one round-trip per client), then
 * ranks them with the pure module. Every query tolerates a database that
 * predates the advisory migrations by treating the relation as empty.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LooseSb } from "@/lib/advisory-state.functions";
import type { AdvisoryState } from "@/lib/advisory-state";
import { ADVISORY_STATES } from "@/lib/advisory-state";
import { outcomeVerdict, type RecommendationOutcome } from "@/lib/recommendations";
import {
  rankPortfolio,
  summarisePortfolio,
  type PortfolioClientFacts,
  type PortfolioRow,
  type PortfolioSummary,
} from "@/lib/portfolio";

type CountMap = Map<string, number>;

async function groupCount(
  sb: LooseSb,
  table: string,
  ids: string[],
  select: string,
  refine?: (q: unknown) => unknown,
): Promise<Array<Record<string, unknown>>> {
  let q = sb.from(table).select(select).in("client_id", ids).limit(5000);
  if (refine) q = refine(q);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as Array<Record<string, unknown>>;
}

function tally(
  rows: Array<Record<string, unknown>>,
  pred: (r: Record<string, unknown>) => boolean = () => true,
): CountMap {
  const m: CountMap = new Map();
  for (const r of rows) {
    if (!pred(r)) continue;
    const id = String(r.client_id);
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

export type PortfolioResult = {
  rows: PortfolioRow[];
  summary: PortfolioSummary;
  generatedAt: string;
};

export const getFirmPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ firmId: z.string().uuid(), now: z.string().datetime().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PortfolioResult> => {
    const sb = context.supabase as unknown as LooseSb;
    const now = data.now ?? new Date().toISOString();
    const today = now.slice(0, 10);

    // RLS scopes this to clients the caller may see; firm membership is
    // checked by the same policies the dashboard relies on.
    const { data: clientsRaw, error } = await sb
      .from("clients")
      .select(
        "id, name, firm_id, advisory_state, advisory_cycle_id, next_review_at, financials_updated_at, last_login_at",
      )
      .eq("firm_id", data.firmId)
      .order("name")
      .limit(500);
    if (error) throw new Error(error.message);
    const clients = (clientsRaw ?? []) as Array<{
      id: string;
      name: string;
      advisory_state: string | null;
      advisory_cycle_id: string | null;
      next_review_at: string | null;
      financials_updated_at: string | null;
      last_login_at: string | null;
    }>;
    if (clients.length === 0) {
      return { rows: [], summary: summarisePortfolio([]), generatedAt: now };
    }
    const ids = clients.map((c) => c.id);
    const cycleIds = clients.map((c) => c.advisory_cycle_id).filter((x): x is string => Boolean(x));

    const [cycles, snaps, requests, actions, recs, packs, outcomes] = await Promise.all([
      cycleIds.length
        ? sb
            .from("advisory_cycles")
            .select("id, client_id, updated_at")
            .in("id", cycleIds)
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
      sb
        .from("client_financial_snapshots")
        .select("client_id, period_date")
        .in("client_id", ids)
        .order("period_date", { ascending: false })
        .limit(5000),
      groupCount(sb, "data_requests", ids, "client_id, severity, status", (q) =>
        (q as { in: (c: string, v: string[]) => unknown }).in("status", ["open", "sent"]),
      ),
      groupCount(sb, "action_items", ids, "client_id, status, due_date", (q) =>
        (q as { neq: (c: string, v: string) => unknown }).neq("status", "done"),
      ),
      groupCount(sb, "proposed_next_steps", ids, "client_id, status", (q) =>
        (q as { eq: (c: string, v: string) => unknown }).eq("status", "proposed"),
      ),
      groupCount(sb, "advisory_packs", ids, "client_id, status, version, edit_stats", (q) =>
        (q as { neq: (c: string, v: string) => unknown }).neq("status", "superseded"),
      ),
      groupCount(
        sb,
        "recommendation_outcomes",
        ids,
        "client_id, recommendation_id, metric, expected_amount, actual_amount, measured_at",
      ),
    ]);

    const cycleUpdated = new Map<string, string>();
    for (const c of ((cycles as { data: unknown }).data ?? []) as Array<{
      id: string;
      updated_at: string;
    }>) {
      cycleUpdated.set(c.id, c.updated_at);
    }
    const latestSnap = new Map<string, string>();
    for (const s of ((snaps as { data: unknown }).data ?? []) as Array<{
      client_id: string;
      period_date: string;
    }>) {
      if (!latestSnap.has(s.client_id)) latestSnap.set(s.client_id, s.period_date);
    }
    const openReq = tally(requests);
    const blockingReq = tally(requests, (r) => r.severity === "critical");
    const openAct = tally(actions);
    const overdueAct = tally(actions, (r) => typeof r.due_date === "string" && r.due_date < today);
    const blockedAct = tally(actions, (r) => r.status === "blocked");
    const proposed = tally(recs);

    // Latest live pack per client (highest version).
    const packByClient = new Map<
      string,
      { status: string; version: number; edit_rate: number | null }
    >();
    for (const p of packs) {
      const id = String(p.client_id);
      const v = Number(p.version ?? 0);
      const cur = packByClient.get(id);
      if (!cur || v > cur.version) {
        const es = p.edit_stats as { edit_rate?: number } | null;
        packByClient.set(id, {
          status: String(p.status),
          version: v,
          edit_rate: es?.edit_rate ?? null,
        });
      }
    }

    // Latest outcome per recommendation → missed / measured counts per client.
    const latestOutcome = new Map<string, RecommendationOutcome>();
    for (const o of outcomes as unknown as RecommendationOutcome[]) {
      const cur = latestOutcome.get(o.recommendation_id);
      if (!cur || o.measured_at > cur.measured_at) latestOutcome.set(o.recommendation_id, o);
    }
    const missed: CountMap = new Map();
    const measured: CountMap = new Map();
    for (const o of latestOutcome.values()) {
      const v = outcomeVerdict(o);
      if (v === "unmeasured") continue;
      measured.set(o.client_id, (measured.get(o.client_id) ?? 0) + 1);
      if (v === "missed" || v === "worsened")
        missed.set(o.client_id, (missed.get(o.client_id) ?? 0) + 1);
    }

    const okStatus = ["draft", "in_review", "changes_requested", "approved", "rejected"];
    const facts: PortfolioClientFacts[] = clients.map((c) => {
      const pack = packByClient.get(c.id);
      const state = (ADVISORY_STATES as readonly string[]).includes(c.advisory_state ?? "")
        ? (c.advisory_state as AdvisoryState)
        : null;
      return {
        clientId: c.id,
        name: c.name,
        state,
        stateSince: c.advisory_cycle_id ? (cycleUpdated.get(c.advisory_cycle_id) ?? null) : null,
        nextReviewAt: c.next_review_at,
        figuresAsOf: latestSnap.get(c.id) ?? c.financials_updated_at ?? null,
        openDataRequests: openReq.get(c.id) ?? 0,
        blockingDataRequests: blockingReq.get(c.id) ?? 0,
        overdueActions: overdueAct.get(c.id) ?? 0,
        blockedActions: blockedAct.get(c.id) ?? 0,
        openActions: openAct.get(c.id) ?? 0,
        proposedRecommendations: proposed.get(c.id) ?? 0,
        packStatus:
          pack && okStatus.includes(pack.status)
            ? (pack.status as PortfolioClientFacts["packStatus"])
            : null,
        packVersion: pack?.version ?? null,
        packEditRate: pack?.edit_rate ?? null,
        outcomesMissed: missed.get(c.id) ?? 0,
        outcomesMeasured: measured.get(c.id) ?? 0,
        lastLoginAt: c.last_login_at,
      };
    });

    const rows = rankPortfolio(facts, now);
    return { rows, summary: summarisePortfolio(rows), generatedAt: now };
  });
