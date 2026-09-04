/**
 * Founder-only read/refresh of the validated-learning instrument.
 * Platform owner only — not Milōn IT. Not a customer feature.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ANALYTICS_SQL_TO_RUN,
  BLOCKED_METRICS,
  COMMITMENT_LADDER,
  EXPERIMENT_DECISIONS,
  HYPOTHESES,
  LOOP_INTERPRETATION,
  METRICS,
  PIVOT_TYPES,
  PREDICTION_MIN_CHARS,
  SITUATION_MIN_CHARS,
  STALL_RULES,
} from "@/lib/metrics/definitions";
import {
  buildDigestText,
  buildInstrument,
  digestSubject,
  type ActivationRow,
  type AdoptionRow,
  type ExpansionRow,
  type LoopRow,
  type QueueRow,
  type RetentionRow,
} from "@/lib/metrics/digest";
import { sendFounderDigest } from "@/lib/metrics/digest-mail";
import {
  adminLoose,
  assertPlatformOwner,
  missingRelation,
  ownerEmailAllowlist,
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

function asRows<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

function founderBundleMissing(message: string): boolean {
  return (
    missingRelation(message) ||
    /invalid schema/i.test(message) ||
    /42883|does not exist/i.test(message) ||
    /analytics_founder_bundle/i.test(message)
  );
}

const SQL7_HINT =
  "Paste SQL 7 only (`supabase/migrations/20260904130000_analytics_founder_bundle.sql`). SQL 3–6 already created the tables; the API cannot read the analytics schema directly.";

async function fetchFounderBag(): Promise<Record<string, unknown>> {
  const admin = analyticsAdmin();
  const { data, error } = await admin.rpc("analytics_founder_bundle");
  if (error) {
    if (founderBundleMissing(error.message)) {
      throw new Error(SQL7_HINT);
    }
    throw new Error(error.message);
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
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
      sql: ANALYTICS_SQL_TO_RUN,
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
          hint: `Run ${ANALYTICS_SQL_TO_RUN.join(" then ")} in the Supabase SQL editor.`,
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
    const bundle = await loadDerivedBundle();
    return {
      activation: bundle.activation,
      loop: bundle.loop,
      adoption: bundle.adoption,
      expansion: bundle.expansion,
      retention: bundle.retention,
      commitment: bundle.commitment,
      queue: bundle.queue,
      catalog: bundle.catalog,
      sql: bundle.sql,
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

type SignalRow = {
  id: number;
  captured_at: string;
  practice_id?: string | null;
  source: string;
  situation: string;
  literal_ask?: string | null;
  underlying_job?: string | null;
  hypothesis_id?: string | null;
  is_compliment_only?: boolean;
};

type ExperimentRow = {
  id: number;
  created_at: string;
  name: string;
  hypothesis_id: string;
  prediction: string;
  success_metric: string;
  success_threshold: number;
  result?: string | null;
  decision?: string | null;
  pivot_type?: string | null;
  decided_at?: string | null;
};

async function loadDerivedBundle() {
  const bag = await fetchFounderBag();
  const activation = asRows<ActivationRow>(bag.activation);
  const loop = asRows<LoopRow>(bag.loop);
  const adoption = asRows<AdoptionRow>(bag.adoption);
  const expansion = asRows<ExpansionRow>(bag.expansion);
  const retention = asRows<RetentionRow>(bag.retention);
  const commitment = asRows(bag.commitment);
  const queue = asRows<QueueRow>(bag.queue);
  const signals = asRows<SignalRow>(bag.signals);
  const experiments = asRows<ExperimentRow>(bag.experiments);
  const founderEmails = asRows<{ email: string }>(bag.founder_emails);

  const openQueue = queue
    .filter((row) => (row.status ?? "open") === "open")
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      return (rank[a.severity ?? "low"] ?? 9) - (rank[b.severity ?? "low"] ?? 9);
    });

  const realSignals = signals
    .filter((s) => !s.is_compliment_only)
    .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at))
    .slice(0, 40);

  const instrument = buildInstrument({
    activation,
    loop,
    adoption,
    expansion,
    retention,
    queue: openQueue,
  });

  return {
    activation,
    loop,
    adoption,
    expansion,
    retention,
    commitment,
    queue: openQueue,
    signals: realSignals,
    experiments: experiments.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    founderEmails,
    instrument,
    catalog: {
      hypotheses: HYPOTHESES,
      metrics: METRICS,
      loopInterpretation: LOOP_INTERPRETATION,
    },
    sql: ANALYTICS_SQL_TO_RUN,
  };
}

export const getFounderInstrument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context as AuthCtx);
    return loadDerivedBundle();
  });

export const createExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(3).max(200),
        hypothesisId: z.enum(["H1", "H2", "H3", "H4", "H5"]),
        prediction: z.string().min(PREDICTION_MIN_CHARS).max(4000),
        successMetric: z.string().min(2).max(80),
        successThreshold: z.number(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = analyticsAdmin();
    const { data: id, error } = await admin.rpc("analytics_create_experiment", {
      p_name: data.name,
      p_hypothesis_id: data.hypothesisId,
      p_prediction: data.prediction,
      p_success_metric: data.successMetric,
      p_success_threshold: data.successThreshold,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

export const decideExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.number().int().positive(),
        decision: z.enum(EXPERIMENT_DECISIONS),
        result: z.string().min(3).max(4000),
        pivotType: z.enum(PIVOT_TYPES).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformOwner(context as AuthCtx);
    if (data.decision === "pivot" && !data.pivotType) {
      throw new Error("A pivot needs a pivot type.");
    }
    const admin = analyticsAdmin();
    const { error } = await admin.rpc("analytics_decide_experiment", {
      p_id: data.id,
      p_decision: data.decision,
      p_result: data.result,
      p_pivot_type: data.pivotType ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

async function digestRecipients(extra: { email: string }[] = []): Promise<string[]> {
  const env = ownerEmailAllowlist();
  return [
    ...new Set([...env, ...extra.map((r) => r.email.trim().toLowerCase()).filter(Boolean)]),
  ];
}

export async function composeDigestPreview() {
  const bundle = await loadDerivedBundle();
  const body = buildDigestText({
    activation: bundle.activation,
    loop: bundle.loop,
    adoption: bundle.adoption,
    expansion: bundle.expansion,
    retention: bundle.retention,
    queue: bundle.queue,
  });
  return {
    subject: digestSubject(bundle.instrument.worstLine),
    body,
    worstLine: bundle.instrument.worstLine,
    recipients: await digestRecipients(bundle.founderEmails),
  };
}

export async function deliverDigest(triggeredBy: string) {
  const preview = await composeDigestPreview();
  const sent = await sendFounderDigest({
    recipients: preview.recipients,
    subject: preview.subject,
    body: preview.body,
  });
  const admin = analyticsAdmin();
  for (const to of preview.recipients) {
    try {
      await admin.rpc("analytics_log_digest", {
        p_recipient: to,
        p_subject: preview.subject,
        p_body: preview.body,
        p_triggered_by: triggeredBy,
        p_worst_line: preview.worstLine,
      });
    } catch {
      /* log is bookkeeping — sending already happened */
    }
  }
  return { ...preview, sent };
}

export const previewMetricsDigest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context as AuthCtx);
    return composeDigestPreview();
  });

export const sendMetricsDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const owner = await assertPlatformOwner(context as AuthCtx);
    return deliverDigest(`founder:${owner.email}`);
  });
