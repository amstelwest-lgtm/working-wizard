/**
 * Outcome measurement — server functions (P2.1).
 *
 * `measureOutcomes` is idempotent: it only inserts a measurement for a
 * (recommendation, newest snapshot) pair that has none. The Next Step card
 * fires it after syncing data requests, so the moment new figures land the
 * previous cycle's recommendations get their answer. Manual capture uses the
 * existing `recordRecommendationOutcome`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LooseSb } from "@/lib/advisory-state.functions";
import {
  deliveryByMetric,
  isAutoMeasurable,
  measureOutcomes as measureOutcomesPure,
  outcomeStories,
  type MetricDelivery,
  type OutcomeStory,
  type SnapshotLike,
} from "@/lib/outcomes";
import {
  isMissingRecommendationRelation,
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

export async function loadOutcomeInputs(
  sb: LooseSb,
  clientId: string,
): Promise<{
  recommendations: Recommendation[];
  snapshots: SnapshotLike[];
  outcomes: RecommendationOutcome[];
  migrated: boolean;
}> {
  const [recsRes, snapsRes, outRes] = await Promise.all([
    sb
      .from("proposed_next_steps")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ["approved", "edited"])
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("client_financial_snapshots")
      .select("id, period_label, period_date, ratios, financials")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(24),
    sb
      .from("recommendation_outcomes")
      .select("*")
      .eq("client_id", clientId)
      .order("measured_at", { ascending: false })
      .limit(500),
  ]);
  if (recsRes.error) {
    if (isMissingRecommendationRelation(recsRes.error))
      return { recommendations: [], snapshots: [], outcomes: [], migrated: false };
    throw new Error(recsRes.error.message);
  }
  if (outRes.error && isMissingRecommendationRelation(outRes.error)) {
    return { recommendations: [], snapshots: [], outcomes: [], migrated: false };
  }
  return {
    recommendations: ((recsRes.data ?? []) as Record<string, unknown>[]).map(
      parseRecommendationRow,
    ),
    snapshots: (snapsRes.error ? [] : (snapsRes.data ?? [])) as SnapshotLike[],
    outcomes: (outRes.error ? [] : (outRes.data ?? [])) as RecommendationOutcome[],
    migrated: true,
  };
}

export type MeasureOutcomesResult = {
  migrated: boolean;
  inserted: number;
  /** Recommendations whose metric needs a human answer. */
  manualPending: number;
};

export const measureOutcomes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid(), now: z.string().datetime().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MeasureOutcomesResult> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const now = data.now ?? new Date().toISOString();
    const inputs = await loadOutcomeInputs(sb, data.clientId);
    if (!inputs.migrated) return { migrated: false, inserted: 0, manualPending: 0 };

    const drafts = measureOutcomesPure({ ...inputs, existing: inputs.outcomes, now });
    let inserted = 0;
    if (drafts.length > 0) {
      const { error } = await sb.from("recommendation_outcomes").insert(
        drafts.map((d) => ({
          client_id: data.clientId,
          recommendation_id: d.recommendation_id,
          metric: d.metric,
          expected_amount: d.expected_amount,
          actual_amount: d.actual_amount,
          method: d.method,
          baseline_snapshot_id: d.baseline_snapshot_id,
          measured_snapshot_id: d.measured_snapshot_id,
          period_label: d.period_label,
          measured_at: d.measured_at,
          notes: d.notes,
          created_by: context.userId,
        })),
      );
      if (error) throw new Error(error.message);
      inserted = drafts.length;
    }

    const measuredIds = new Set(
      inputs.outcomes.filter((o) => o.actual_amount !== null).map((o) => o.recommendation_id),
    );
    for (const d of drafts) measuredIds.add(d.recommendation_id);
    const manualPending = inputs.recommendations.filter(
      (r) => !measuredIds.has(r.id) && !isAutoMeasurable(r.expected_impact_metric),
    ).length;
    return { migrated: true, inserted, manualPending };
  });

export type OutcomesOverview = {
  migrated: boolean;
  stories: OutcomeStory[];
  delivery: MetricDelivery[];
  recommendations: Recommendation[];
  outcomes: RecommendationOutcome[];
};

export const getOutcomesOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<OutcomesOverview> => {
    const sb = context.supabase as unknown as LooseSb;
    await assertClientAccess(sb, context.userId, data.clientId);
    const inputs = await loadOutcomeInputs(sb, data.clientId);
    if (!inputs.migrated)
      return { migrated: false, stories: [], delivery: [], recommendations: [], outcomes: [] };
    return {
      migrated: true,
      stories: outcomeStories(inputs.recommendations, inputs.outcomes),
      delivery: deliveryByMetric(inputs.recommendations, inputs.outcomes),
      recommendations: inputs.recommendations,
      outcomes: inputs.outcomes,
    };
  });
