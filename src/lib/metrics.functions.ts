/**
 * Founder-only read/refresh of Phase 2 derived metrics.
 * No UI here — Phase 3 dashboard will call these. Not a customer feature.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ANALYTICS_PHASE2_SQL,
  BLOCKED_METRICS,
  COMMITMENT_LADDER,
  HYPOTHESES,
  LOOP_INTERPRETATION,
  METRICS,
  SITUATION_MIN_CHARS,
  STALL_RULES,
} from "@/lib/metrics/definitions";
import {
  adminLoose,
  assertPlatformOwner,
  missingRelation,
  type AuthCtx,
  type LooseAdmin,
} from "@/lib/owner-ops.guard";

type AnalyticsAdmin = LooseAdmin & {
  schema: (name: string) => { from: (table: string) => any };
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function analyticsAdmin(): AnalyticsAdmin {
  return adminLoose() as AnalyticsAdmin;
}

async function selectView<T>(table: string): Promise<T[]> {
  const admin = analyticsAdmin();
  const { data, error } = await admin.schema("analytics").from(table).select("*");
  if (error) {
    if (missingRelation(error.message) || /schema "analytics"/i.test(error.message)) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []) as T[];
}

export const getMetricsCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context as AuthCtx);
    return {
      hypotheses: HYPOTHESES,
      metrics: METRICS,
      blockedMetrics: BLOCKED_METRICS,
      commitmentLadder: COMMITMENT_LADDER,
      stallRules: STALL_RULES,
      loopInterpretation: LOOP_INTERPRETATION,
      sql: ANALYTICS_PHASE2_SQL,
    };
  });

export const refreshAnalyticsDerived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = analyticsAdmin();
    const { data, error } = await admin.rpc("analytics_refresh_derived");
    if (error) {
      if (missingRelation(error.message) || /42883|does not exist/i.test(error.message)) {
        return {
          ok: false as const,
          hint: `Run ${ANALYTICS_PHASE2_SQL.join(" then ")} in the Supabase SQL editor.`,
        };
      }
      throw new Error(error.message);
    }
    return { ok: true as const, result: data };
  });

export const getAnalyticsDerived = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const [activation, loop, adoption, expansion, retention, commitment, queue] = await Promise.all([
      selectView("v_practice_activation"),
      selectView("v_accountability_loop"),
      selectView("v_assignment_adoption"),
      selectView("v_entity_expansion"),
      selectView("v_month2_retention"),
      selectView("v_practice_commitment_current"),
      selectView("founder_action_queue"),
    ]);

    const openQueue = queue
      .filter((row: { status?: string }) => row.status === "open")
      .sort((a: { severity?: string }, b: { severity?: string }) => {
        const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
        return (rank[a.severity ?? "low"] ?? 9) - (rank[b.severity ?? "low"] ?? 9);
      });

    return {
      activation,
      loop,
      adoption,
      expansion,
      retention,
      commitment,
      queue: openQueue,
      catalog: {
        hypotheses: HYPOTHESES,
        metrics: METRICS,
        loopInterpretation: LOOP_INTERPRETATION,
      },
      sql: ANALYTICS_PHASE2_SQL,
    };
  });

export const logCustomerSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        practiceId: z.string().uuid().nullable().optional(),
        source: z.string().min(1).max(40),
        situation: z.string().min(SITUATION_MIN_CHARS).max(4000),
        literalAsk: z.string().max(2000).optional(),
        underlyingJob: z.string().max(2000).optional(),
        frequencyStated: z.string().max(200).optional(),
        workaroundToday: z.string().max(2000).optional(),
        commitmentObserved: z.string().max(2000).optional(),
        hypothesisId: z.enum(["H1", "H2", "H3", "H4", "H5"]).optional(),
        isComplimentOnly: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = analyticsAdmin();
    const { data: id, error } = await admin.rpc("analytics_log_signal", {
      p_practice_id: data.practiceId ?? null,
      p_source: data.source,
      p_situation: data.situation,
      p_literal_ask: data.literalAsk ?? null,
      p_underlying_job: data.underlyingJob ?? null,
      p_frequency_stated: data.frequencyStated ?? null,
      p_workaround_today: data.workaroundToday ?? null,
      p_commitment_observed: data.commitmentObserved ?? null,
      p_hypothesis_id: data.hypothesisId ?? null,
      p_is_compliment_only: Boolean(data.isComplimentOnly),
    });
    if (error) throw new Error(error.message);
    return { id };
  });

export const updateFounderQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.number().int().positive(),
        status: z.enum(["open", "contacted", "answered", "dismissed"]),
        outcomeNotes: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = analyticsAdmin();
    const { error } = await admin.rpc("analytics_update_queue_item", {
      p_id: data.id,
      p_status: data.status,
      p_outcome_notes: data.outcomeNotes ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
