/**
 * Recommendation + outcome server functions (P0.2).
 *
 * Recommendations live in `proposed_next_steps` (extended by the P0.2
 * migration). Reads/writes go through the caller's Supabase client so RLS
 * (`has_client_access`) applies; the approved → action path uses the
 * `advisory_create_action_from_recommendation` RPC so plan lookup, sequencing
 * and the FK are set in one transaction and the `action.created` advisory
 * event fires from the DB trigger.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DATA_DEPTHS,
  IMPACT_METRICS,
  OUTCOME_METHODS,
  RECOMMENDATION_PRIORITIES,
  RECOMMENDATION_SOURCES,
  checkRootCauseClaims,
  isMissingRecommendationRelation,
  parseRecommendationRow,
  sortRecommendations,
  type Recommendation,
  type RecommendationOutcome,
} from "@/lib/recommendations";

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseSb = {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

async function assertClientAccess(sb: LooseSb, userId: string, clientId: string) {
  const { data, error } = await sb.rpc("has_client_access", {
    _user_id: userId,
    _client_id: clientId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this client");
}

const EvidenceSchema = z.object({
  kind: z.enum(["ratio", "pillar", "forecast", "fact", "transaction"]),
  key: z.string().min(1).max(120),
  label: z.string().max(200).optional(),
  value: z.union([z.number(), z.string().max(200), z.null()]).optional(),
  snapshot_id: z.string().uuid().nullable().optional(),
});

const ImpactSchema = z.object({
  metric: z.enum(IMPACT_METRICS),
  amount: z.number().finite(),
  horizonDays: z.number().int().positive().max(730).optional(),
  note: z.string().max(500).optional(),
});

// ── list ─────────────────────────────────────────────────────────────────────

export const listRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        cycleId: z.string().uuid().optional(),
        includeClosed: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ recommendations: Recommendation[]; migrated: boolean }> => {
      const sb = context.supabase as unknown as LooseSb;
      await assertClientAccess(sb, context.userId, data.clientId);

      let q = sb.from("proposed_next_steps").select("*").eq("client_id", data.clientId);
      if (data.cycleId) q = q.eq("cycle_id", data.cycleId);
      if (!data.includeClosed) q = q.not("status", "in", "(rejected,superseded)");
      const { data: rows, error } = await q.order("created_at", { ascending: false });
      if (error) {
        if (data.cycleId && isMissingRecommendationRelation(error)) {
          // Pre-migration: no cycle_id column. Fall back to all open rows.
          const plain = await sb
            .from("proposed_next_steps")
            .select("*")
            .eq("client_id", data.clientId)
            .order("created_at", { ascending: false });
          if (plain.error) throw new Error(plain.error.message);
          return {
            recommendations: sortRecommendations(
              ((plain.data ?? []) as Record<string, unknown>[]).map(parseRecommendationRow),
            ),
            migrated: false,
          };
        }
        throw new Error(error.message);
      }
      const recs = ((rows ?? []) as Record<string, unknown>[]).map(parseRecommendationRow);
      const migrated =
        recs.length === 0 || Object.prototype.hasOwnProperty.call(rows?.[0] ?? {}, "priority");
      return { recommendations: sortRecommendations(recs), migrated };
    },
  );

// ── create ───────────────────────────────────────────────────────────────────

export const createRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        title: z.string().min(3).max(200),
        problem: z.string().max(1000).optional(),
        rationale: z.string().max(4000).optional(),
        evidence: z.array(EvidenceSchema).max(20).optional(),
        priority: z.enum(RECOMMENDATION_PRIORITIES).optional(),
        confidence: z.number().min(0).max(1).optional(),
        dataDepth: z.enum(DATA_DEPTHS).optional(),
        expectedImpact: ImpactSchema.optional(),
        source: z.enum(RECOMMENDATION_SOURCES).optional(),
        assumptions: z.array(z.string().max(300)).max(20).optional(),
        cycleId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ recommendation: Recommendation }> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);

    const dataDepth = data.dataDepth ?? "statement";
    const claims = checkRootCauseClaims({
      data_depth: dataDepth,
      title: data.title,
      problem: data.problem ?? null,
      rationale: data.rationale ?? null,
    });
    if (!claims.ok) {
      throw new Error(
        `This recommendation is built from statement totals but names ${claims.violations.join(", ")}. ` +
          "Either soften the copy or attach transaction-level evidence.",
      );
    }
    if (
      dataDepth === "transaction" &&
      !(data.evidence ?? []).some((e) => e.kind === "transaction")
    ) {
      throw new Error(
        "Transaction-depth recommendations need at least one transaction evidence reference.",
      );
    }

    const { data: row, error } = await sb
      .from("proposed_next_steps")
      .insert({
        client_id: data.clientId,
        title: data.title,
        rationale: data.rationale ?? null,
        problem: data.problem ?? null,
        evidence: data.evidence ?? [],
        priority: data.priority ?? "medium",
        confidence: data.confidence ?? null,
        data_depth: dataDepth,
        expected_impact_metric: data.expectedImpact?.metric ?? null,
        expected_impact_amount: data.expectedImpact?.amount ?? null,
        expected_impact_horizon_days: data.expectedImpact?.horizonDays ?? null,
        expected_impact_note: data.expectedImpact?.note ?? null,
        source: data.source ?? "ai",
        assumptions: data.assumptions ?? [],
        cycle_id: data.cycleId ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { recommendation: parseRecommendationRow(row as Record<string, unknown>) };
  });

// ── decide ───────────────────────────────────────────────────────────────────

export const decideRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        recommendationId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ recommendation: Recommendation }> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);

    const { data: current, error: readErr } = await sb
      .from("proposed_next_steps")
      .select("id, status")
      .eq("id", data.recommendationId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Recommendation not found");
    if (current.status === "superseded") throw new Error("This recommendation has been superseded");

    const patch: Record<string, unknown> = {
      status: data.decision === "approve" ? "approved" : "rejected",
      decided_at: new Date().toISOString(),
      decided_by: context.userId,
    };
    if (data.note !== undefined) patch.note = data.note;

    let res = await sb
      .from("proposed_next_steps")
      .update(patch)
      .eq("id", data.recommendationId)
      .eq("client_id", data.clientId)
      .select("*")
      .single();
    if (res.error && isMissingRecommendationRelation(res.error)) {
      // Pre-migration: decided_* columns absent.
      delete patch.decided_at;
      delete patch.decided_by;
      res = await sb
        .from("proposed_next_steps")
        .update(patch)
        .eq("id", data.recommendationId)
        .eq("client_id", data.clientId)
        .select("*")
        .single();
    }
    if (res.error) throw new Error(res.error.message);
    return { recommendation: parseRecommendationRow(res.data as Record<string, unknown>) };
  });

// ── supersede ────────────────────────────────────────────────────────────────

export const supersedeRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        recommendationId: z.string().uuid(),
        supersededBy: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ recommendation: Recommendation }> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const { data: row, error } = await sb
      .from("proposed_next_steps")
      .update({ status: "superseded", superseded_by: data.supersededBy ?? null })
      .eq("id", data.recommendationId)
      .eq("client_id", data.clientId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { recommendation: parseRecommendationRow(row as Record<string, unknown>) };
  });

// ── approved recommendation → action_item ────────────────────────────────────

export type CreateActionResult =
  | { ok: true; actionItemId: string }
  | { ok: false; reason: "not_migrated" };

export const createActionFromRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        recommendationId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        ownerId: z.string().uuid().optional(),
        /** Approve a still-proposed recommendation in the same call (owner-only path). */
        approve: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CreateActionResult> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);

    const { data: actionId, error } = await sb.rpc("advisory_create_action_from_recommendation", {
      p_recommendation_id: data.recommendationId,
      p_title: data.title ?? null,
      p_due_date: data.dueDate ?? null,
      p_owner_id: data.ownerId ?? null,
      p_approve: data.approve ?? false,
    });
    if (error) {
      if (isMissingRecommendationRelation(error)) return { ok: false, reason: "not_migrated" };
      throw new Error(error.message);
    }
    return { ok: true, actionItemId: String(actionId) };
  });

// ── outcomes ─────────────────────────────────────────────────────────────────

export const recordRecommendationOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        recommendationId: z.string().uuid(),
        metric: z.enum(IMPACT_METRICS),
        actualAmount: z.number().finite().nullable(),
        expectedAmount: z.number().finite().optional(),
        method: z.enum(OUTCOME_METHODS).optional(),
        baselineSnapshotId: z.string().uuid().optional(),
        measuredSnapshotId: z.string().uuid().optional(),
        periodLabel: z.string().max(60).optional(),
        measuredAt: z.string().datetime().optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ outcome: RecommendationOutcome }> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);

    const { data: row, error } = await sb
      .from("recommendation_outcomes")
      .insert({
        client_id: data.clientId,
        recommendation_id: data.recommendationId,
        metric: data.metric,
        actual_amount: data.actualAmount,
        expected_amount: data.expectedAmount ?? null,
        method: data.method ?? "manual",
        baseline_snapshot_id: data.baselineSnapshotId ?? null,
        measured_snapshot_id: data.measuredSnapshotId ?? null,
        period_label: data.periodLabel ?? null,
        measured_at: data.measuredAt ?? new Date().toISOString(),
        notes: data.notes ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingRecommendationRelation(error)) {
        throw new Error(
          "Outcome tracking is not enabled yet: run 20260918130000_recommendations_outcomes.sql.",
        );
      }
      throw new Error(error.message);
    }
    return { outcome: row as RecommendationOutcome };
  });

export const listRecommendationOutcomes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        recommendationId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ outcomes: RecommendationOutcome[] }> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    let q = sb.from("recommendation_outcomes").select("*").eq("client_id", data.clientId);
    if (data.recommendationId) q = q.eq("recommendation_id", data.recommendationId);
    const { data: rows, error } = await q
      .order("measured_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (error) {
      if (isMissingRecommendationRelation(error)) return { outcomes: [] };
      throw new Error(error.message);
    }
    return { outcomes: (rows ?? []) as RecommendationOutcome[] };
  });
