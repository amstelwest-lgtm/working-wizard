/**
 * One background job for the Financial Manager or the Advisor.
 * Same run statuses as the Analyst: queued, running, succeeded, partial, dead.
 * A finished partial, dead, cancelled, or skipped run is not repeated.
 * Background runs do not touch the pre-card allowance.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { agentTurnMessages, decisionFromClaude, runAgentLoop } from "./loop.ts";
import { callClaudeRound } from "./claude.ts";
import { CLAUDE_MODEL } from "../claude-model.ts";
import {
  agentCopyStatus,
  attachCitedEvidence,
  evidenceMetrics,
  moneyMarketFromClient,
  sanitizeAgentError,
  severityWithFloor,
  type FindingEvidence,
  type StoredFigures,
} from "../../../../src/lib/agent-bus.ts";
import {
  analystFailurePlan,
  analystRunCostUsd,
  handoffFinishSummary,
  collectStoredReads,
  evidenceKeyList,
  evidenceKeysNote,
} from "../../../../src/lib/agent-analyst.ts";
import {
  CUT_OFF_DRAFT_RESULT,
  recordDraftWasCutOff,
  runnerEarlyFinish,
  runnerNextCallExceedsCeiling,
  RUNNER_MAX_OUTPUT_TOKENS,
  withDraftFlags,
} from "../../../../src/lib/agent-draft.ts";
import {
  HANDOFF_COST_STOP,
  handoffDraftIsDuplicate,
  handoffDraftTitle,
  handoffFinding,
  handoffResultNote,
} from "../../../../src/lib/owner-handoff.ts";
import { agentDisplayNameFromKey } from "../../../../src/lib/milon-team-names.ts";

export type RunnerJob = {
  msgId: number | null;
  clientId: string;
  trigger: string;
  inputs: string;
  attempt: number;
  correlationId: string | null;
};

export type QueueAgent = "financial_manager" | "advisor";

type ToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type QueueJobConfig = {
  agent: QueueAgent;
  queue: "agent_fm" | "agent_advisor";
  objective: string;
  audience: "accountant";
  maxIterations: number;
  allowedTools: readonly string[];
  toolLabels: Record<string, string>;
  system: string;
  toolSchemas: () => ToolSchema[];
  writeTools: readonly string[];
  fallbackDraftKind: string;
  /** Do not start a call whose proxy cost would take the run over this. */
  costCeilingUsd: number;
  runOutcome: (input: {
    stopReason: string;
    steps: Array<{ tool: string | null; status: string }>;
    maxIterations: number;
  }) => { status: "succeeded" | "partial"; stopReason: string };
  execute: (name: string, args: Record<string, unknown>, ctx: {
    agent: QueueAgent;
    clientId: string;
    runId: string;
    correlationId: string;
    firmId: string | null;
    db: SupabaseClient;
    pool: StoredFigures[];
    recordedKeys: Set<string>;
    market?: unknown;
  }) => Promise<unknown>;
};

type RunRow = { run_id: string; status: string; idempotency_key: string; is_new: boolean };

function asRunRow(data: unknown): RunRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.run_id !== "string" || typeof rec.status !== "string") return null;
  return {
    run_id: rec.run_id,
    status: rec.status,
    idempotency_key: typeof rec.idempotency_key === "string" ? rec.idempotency_key : "",
    is_new: rec.is_new === true,
  };
}

async function archive(db: SupabaseClient, queue: string, msgId: number | null) {
  if (msgId == null) return;
  const { error } = await db.rpc("agent_queue_archive", { p_queue: queue, p_msg_id: msgId });
  if (error) console.warn("agent_queue_archive", error.message);
}

async function requeue(db: SupabaseClient, config: QueueJobConfig, job: RunnerJob, delaySeconds: number, attempt: number) {
  const { error } = await db.rpc("agent_queue_send", {
    p_queue: config.queue,
    p_payload: {
      client_id: job.clientId,
      trigger: job.trigger,
      inputs: job.inputs,
      attempt,
      correlation_id: job.correlationId,
    },
    p_delay: delaySeconds,
  });
  if (error) console.warn("agent_queue_send", error.message);
  await archive(db, config.queue, job.msgId);
}

async function rememberRun(
  db: SupabaseClient,
  config: QueueJobConfig,
  clientId: string,
  value: Record<string, unknown>,
) {
  const { error } = await db.from("agent_memory").upsert(
    {
      agent: config.agent,
      client_id: clientId,
      key: "last_run",
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agent,client_id,key" },
  );
  if (error) console.warn("agent_memory", error.message);
}

async function recordHandoffFinish(
  db: SupabaseClient,
  config: QueueJobConfig,
  input: { runId: string; clientId: string; summary: string; pool: StoredFigures[]; market?: unknown },
) {
  const { data: run, error } = await db
    .from("agent_runs")
    .select("action_item_id")
    .eq("id", input.runId)
    .maybeSingle();
  if (error || !run?.action_item_id) return;
  const actionItemId = run.action_item_id as string;
  const displayName = agentDisplayNameFromKey(config.agent);
  if (!displayName) return;
  const market = moneyMarketFromClient(input.market);
  const stored = input.pool.find((row) => Object.keys(row.figures).length > 0) ?? null;
  const { error: noteError } = await db.from("action_updates").insert({
    action_item_id: actionItemId,
    client_id: input.clientId,
    actor_type: "system",
    actor_label: displayName,
    note: handoffResultNote(displayName, input.summary, market, stored?.figures),
  });
  if (noteError) console.warn("handoff note", noteError.message);

  const finding = handoffFinding({
    summary: input.summary,
    figures: stored?.figures ?? null,
    periodLabel: stored?.periodLabel ?? null,
    snapshotId: stored?.snapshotId ?? null,
    market,
  });
  if (!finding) return;
  const cited = attachCitedEvidence({
    title: finding.title,
    detail: finding.detail,
    pool: input.pool,
    evidence: finding.evidence as FindingEvidence,
  });
  if (!cited.ok) return;
  const { count, error: countError } = await db
    .from("agent_findings")
    .select("id", { count: "exact", head: true })
    .eq("run_id", input.runId);
  if (countError) {
    console.warn("handoff findings", countError.message);
    return;
  }
  if ((count ?? 0) > 0) return;
  const { data: actionRow } = await db
    .from("action_items")
    .select("title")
    .eq("id", actionItemId)
    .maybeSingle();
  const actionTitle = typeof actionRow?.title === "string" ? actionRow.title : "";
  const labelled = actionTitle ? handoffDraftTitle(actionTitle) : finding.title;
  const { data: priorDrafts } = await db
    .from("agent_findings")
    .select("title")
    .eq("client_id", input.clientId)
    .limit(80);
  const existingTitles = (priorDrafts ?? []).flatMap((row) => {
    const title = (row as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? [title] : [];
  });
  if (actionTitle && handoffDraftIsDuplicate(actionTitle, existingTitles)) return;
  if (!actionTitle && existingTitles.some((title) => title.trim() === labelled.trim())) return;
  const metrics = evidenceMetrics(cited.evidence.figures, cited.evidence.period_label, market);
  const severity = severityWithFloor("info", metrics);
  const { error: findingError } = await db.from("agent_findings").insert({
    agent: config.agent,
    client_id: input.clientId,
    run_id: input.runId,
    kind: config.fallbackDraftKind,
    severity,
    title: labelled,
    detail: finding.detail,
    evidence: withDraftFlags({
      ...cited.evidence,
      metrics,
      status: agentCopyStatus(severity),
    }),
    last_seen: new Date().toISOString(),
  });
  if (findingError) console.warn("handoff finding", findingError.message);
}

export async function runQueueJob(
  db: SupabaseClient,
  job: RunnerJob,
  config: QueueJobConfig,
): Promise<Record<string, unknown>> {
  const correlationId = job.correlationId ?? crypto.randomUUID();
  const { data, error } = await db.rpc("begin_agent_run", {
    p_agent: config.agent,
    p_client_id: job.clientId,
    p_trigger: job.trigger,
    p_inputs: job.inputs,
    p_audience: "system",
    p_correlation_id: correlationId,
    p_attempt: job.attempt,
  });
  if (error) throw new Error(error.message);
  const existing = asRunRow(data);
  if (!existing) throw new Error("begin_agent_run returned no row");

  if (
    !existing.is_new &&
    (existing.status === "succeeded" ||
      existing.status === "partial" ||
      existing.status === "dead" ||
      existing.status === "cancelled" ||
      existing.status === "skipped")
  ) {
    await archive(db, config.queue, job.msgId);
    return { status: existing.status, runId: existing.run_id, duplicate: true };
  }

  const { data: leased, error: leaseError } = await db.rpc("acquire_agent_lease", {
    p_agent: config.agent,
    p_client_id: job.clientId,
    p_run_id: existing.run_id,
    p_holder: `${config.agent}:${job.msgId ?? "direct"}`,
  });
  if (leaseError) throw new Error(leaseError.message);
  if (leased !== true) {
    if (existing.status === "running") {
      return { status: "running", runId: existing.run_id, lease: false };
    }
    await requeue(db, config, { ...job, correlationId }, 60, job.attempt);
    await db.from("agent_runs").update({ status: "queued" }).eq("id", existing.run_id);
    return { status: "queued", runId: existing.run_id, lease: false };
  }

  const started = Date.now();
  await db
    .from("agent_runs")
    .update({
      status: "running",
      attempt: job.attempt,
      started_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", existing.run_id);
  await db.rpc("heartbeat_agent_lease", {
    p_agent: config.agent,
    p_client_id: job.clientId,
    p_run_id: existing.run_id,
  });

  const { data: client } = await db.from("clients").select("firm_id, market").eq("id", job.clientId).maybeSingle();
  const firmId = (client?.firm_id as string | null) ?? null;
  const { data: memory } = await db
    .from("agent_memory")
    .select("value")
    .eq("agent", config.agent)
    .eq("client_id", job.clientId)
    .eq("key", "last_run")
    .maybeSingle();
  const priorSummary =
    memory?.value && typeof memory.value === "object" && typeof (memory.value as { summary?: unknown }).summary === "string"
      ? (memory.value as { summary: string }).summary.slice(0, 400)
      : "";
  const pool: StoredFigures[] = [];
  const recordedKeys = new Set<string>();
  const writes = new Set<string>(config.writeTools);
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let lastInputTokens = 0;
  let lastOutputTokens = 0;
  let lastCacheWriteTokens = 0;
  let lastCacheReadTokens = 0;
  let roundStopReason = "";

  try {
    const result = await runAgentLoop({
      objective: priorSummary
        ? `${config.objective} Last run on file: ${priorSummary}`
        : config.objective,
      audience: config.audience,
      maxIterations: config.maxIterations,
      allowedTools: config.allowedTools,
      toolLabels: config.toolLabels,
      rethrowReasonerErrors: true,
      reason: async (ctx) => {
        const drafted = runnerEarlyFinish(recordedKeys.size);
        if (drafted) return { kind: "stop", reason: drafted.reason, summary: drafted.summary };
        const spent = analystRunCostUsd(inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, CLAUDE_MODEL);
        const lastCall = analystRunCostUsd(
          lastInputTokens,
          lastOutputTokens,
          lastCacheWriteTokens,
          lastCacheReadTokens,
          CLAUDE_MODEL,
        );
        if (runnerNextCallExceedsCeiling({ spentUsd: spent, lastCallUsd: lastCall, ceilingUsd: config.costCeilingUsd })) {
          return {
            kind: "stop",
            reason: "cost_ceiling",
            summary: HANDOFF_COST_STOP,
          };
        }
        await db.rpc("heartbeat_agent_lease", {
          p_agent: config.agent,
          p_client_id: job.clientId,
          p_run_id: existing.run_id,
        });
        const round = await callClaudeRound(config.system, agentTurnMessages(ctx), config.toolSchemas(), {
          toolChoice: { type: "auto" },
          maxTokens: RUNNER_MAX_OUTPUT_TOKENS,
          cachePrompt: true,
        });
        lastInputTokens = round.inputTokens;
        lastOutputTokens = round.outputTokens;
        lastCacheWriteTokens = round.cacheCreationTokens;
        lastCacheReadTokens = round.cacheReadTokens;
        inputTokens += round.inputTokens;
        outputTokens += round.outputTokens;
        cacheWriteTokens += round.cacheCreationTokens;
        cacheReadTokens += round.cacheReadTokens;
        roundStopReason = round.stopReason;
        return decisionFromClaude({ text: round.text, toolUses: round.toolUses });
      },
      execute: async (name, args) => {
        if (recordDraftWasCutOff({ stopReason: roundStopReason, name, args })) {
          return { error: CUT_OFF_DRAFT_RESULT };
        }
        const payload = await config.execute(name, args, {
          agent: config.agent,
          clientId: job.clientId,
          runId: existing.run_id,
          correlationId,
          firmId,
          db,
          pool,
          recordedKeys,
          market: client?.market,
        });
        if (!writes.has(name)) {
          const reads = collectStoredReads(payload, { snapshotId: null, periodLabel: null });
          for (const stored of reads) pool.push(stored);
          const note = evidenceKeysNote(reads);
          if (note && payload && typeof payload === "object" && !Array.isArray(payload)) {
            return {
              ...(payload as Record<string, unknown>),
              evidence_keys: evidenceKeyList(reads),
              evidence_keys_note: note,
            };
          }
        }
        return payload;
      },
    });

    const outcome = config.runOutcome({
      stopReason: result.status,
      steps: result.trace.map((step) => ({ tool: step.tool, status: step.status })),
      maxIterations: config.maxIterations,
    });
    const partial = outcome.status === "partial";
    const summary = handoffFinishSummary({
      stopReason: outcome.stopReason,
      summary: result.summary,
      steps: result.trace.map((step) => ({ tool: step.tool, status: step.status, args: step.args })),
      noun: config.writeTools.includes("record_draft") ? "draft" : "finding",
    }).slice(0, 2000);
    await db
      .from("agent_runs")
      .update({
        status: outcome.status,
        stop_reason: outcome.stopReason,
        summary,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_write_tokens: cacheWriteTokens,
        cache_read_tokens: cacheReadTokens,
        cost_usd: analystRunCostUsd(inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, CLAUDE_MODEL),
        latency_ms: Date.now() - started,
        trace: result.trace,
        finished_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", existing.run_id);
    await db.rpc("release_agent_lease", {
      p_agent: config.agent,
      p_client_id: job.clientId,
      p_run_id: existing.run_id,
    });
    await rememberRun(db, config, job.clientId, {
      run_id: existing.run_id,
      summary,
      status: outcome.status,
      finished_at: new Date().toISOString(),
    });
    await recordHandoffFinish(db, config, {
      runId: existing.run_id,
      clientId: job.clientId,
      summary,
      pool,
      market: client?.market,
    });
    await archive(db, config.queue, job.msgId);
    return { status: partial ? "partial" : "succeeded", runId: existing.run_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent run failed";
    const plan = analystFailurePlan(job.attempt, message);
    if (plan.action === "retry") {
      await db
        .from("agent_runs")
        .update({
          status: "queued",
          error: plan.error,
          attempt: job.attempt,
          finished_at: new Date().toISOString(),
        })
        .eq("id", existing.run_id);
      await db.rpc("release_agent_lease", {
        p_agent: config.agent,
        p_client_id: job.clientId,
        p_run_id: existing.run_id,
      });
      await requeue(db, config, { ...job, correlationId }, plan.delaySeconds, job.attempt + 1);
      return { status: "queued", runId: existing.run_id, retryInSeconds: plan.delaySeconds };
    }

    await db
      .from("agent_runs")
      .update({
        status: "dead",
        error: plan.error,
        attempt: job.attempt,
        finished_at: new Date().toISOString(),
        latency_ms: Date.now() - started,
      })
      .eq("id", existing.run_id);
    await db.rpc("release_agent_lease", {
      p_agent: config.agent,
      p_client_id: job.clientId,
      p_run_id: existing.run_id,
    });
    if (job.msgId != null && plan.action === "dead_letter") {
      const { error: dlqError } = await db.rpc("agent_queue_dead_letter", {
        p_msg_id: job.msgId,
        p_payload: {
          client_id: job.clientId,
          trigger: job.trigger,
          inputs: job.inputs,
          attempt: job.attempt,
          error: sanitizeAgentError(message),
        },
        p_queue: config.queue,
      });
      if (dlqError) console.warn("agent_queue_dead_letter", dlqError.message);
    } else {
      await archive(db, config.queue, job.msgId);
    }
    return { status: "dead", runId: existing.run_id };
  }
}
