/**
 * One analyst job: lease, idempotency, the shared loop, then retry or dead-letter.
 * Background runs do not touch the pre-card allowance.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  agentTurnMessages,
  decisionFromClaude,
  runAgentLoop,
} from "../_shared/agent-core/loop.ts";
import { callClaudeRound } from "../_shared/agent-core/claude.ts";
import { ANALYST_SYSTEM, analystToolSchemas } from "../_shared/agent-prompts/analyst.ts";
import { CLAUDE_MODEL } from "../_shared/claude-model.ts";
import { moneyMarketFromClient, sanitizeAgentError, type StoredFigures } from "../../../src/lib/agent-bus.ts";
import { RUNNER_COST_CEILING_USD, runnerNextCallExceedsCeiling } from "../../../src/lib/agent-draft.ts";
import {
  ANALYST_MAX_ITERATIONS,
  ANALYST_TOOLS,
  ANALYST_TOOL_LABELS,
  analystFailurePlan,
  analystRunCostUsd,
  analystRunOutcome,
  analystRunSummary,
  collectStoredReads,
  evidenceKeyList,
  evidenceKeysNote,
} from "../../../src/lib/agent-analyst.ts";
import { executeAnalystTool } from "./execute.ts";
import { handoffFinding, handoffResultNote } from "../../../src/lib/owner-handoff.ts";
import { agentDisplayNameFromKey } from "../../../src/lib/milon-team-names.ts";

export type AnalystJob = {
  msgId: number | null;
  clientId: string;
  trigger: string;
  inputs: string;
  attempt: number;
  correlationId: string | null;
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

async function archive(db: SupabaseClient, msgId: number | null) {
  if (msgId == null) return;
  const { error } = await db.rpc("agent_queue_archive", { p_queue: "agent_analyst", p_msg_id: msgId });
  if (error) console.warn("agent_queue_archive", error.message);
}

async function requeue(
  db: SupabaseClient,
  job: AnalystJob,
  delaySeconds: number,
  attempt: number,
) {
  const { error } = await db.rpc("agent_queue_send", {
    p_queue: "agent_analyst",
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
  await archive(db, job.msgId);
}

export async function runAnalystJob(db: SupabaseClient, job: AnalystJob): Promise<Record<string, unknown>> {
  const correlationId = job.correlationId ?? crypto.randomUUID();
  const { data, error } = await db.rpc("begin_agent_run", {
    p_agent: "analyst",
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
    await archive(db, job.msgId);
    return { status: existing.status, runId: existing.run_id, duplicate: true };
  }

  const { data: leased, error: leaseError } = await db.rpc("acquire_agent_lease", {
    p_agent: "analyst",
    p_client_id: job.clientId,
    p_run_id: existing.run_id,
    p_holder: `analyst:${job.msgId ?? "direct"}`,
  });
  if (leaseError) throw new Error(leaseError.message);
  if (leased !== true) {
    // The message stays invisible until its visibility timeout. Do not enqueue
    // a second copy, and do not move a live run back to queued.
    if (existing.status === "running") {
      return { status: "running", runId: existing.run_id, lease: false };
    }
    await requeue(db, { ...job, correlationId }, 60, job.attempt);
    await db
      .from("agent_runs")
      .update({ status: "queued" })
      .eq("id", existing.run_id);
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
    p_agent: "analyst",
    p_client_id: job.clientId,
    p_run_id: existing.run_id,
  });

  const { data: client } = await db
    .from("clients")
    .select("firm_id, market")
    .eq("id", job.clientId)
    .maybeSingle();
  const firmId = (client?.firm_id as string | null) ?? null;
  const pool: StoredFigures[] = [];
  const recordedKeys = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let lastInputTokens = 0;
  let lastOutputTokens = 0;
  let lastCacheWriteTokens = 0;
  let lastCacheReadTokens = 0;

  try {
    const result = await runAgentLoop({
      objective:
        "Review the books on file for this client and record findings that cite those stored figures.",
      audience: "accountant",
      maxIterations: ANALYST_MAX_ITERATIONS,
      allowedTools: ANALYST_TOOLS,
      toolLabels: ANALYST_TOOL_LABELS,
      rethrowReasonerErrors: true,
      reason: async (ctx) => {
        const spent = analystRunCostUsd(inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, CLAUDE_MODEL);
        const lastCall = analystRunCostUsd(
          lastInputTokens,
          lastOutputTokens,
          lastCacheWriteTokens,
          lastCacheReadTokens,
          CLAUDE_MODEL,
        );
        // Same predictor as the Financial Manager and Advisor. $0.06 is the ceiling.
        // A call that would pass it does not start, so a run stops near $0.055.
        if (runnerNextCallExceedsCeiling({ spentUsd: spent, lastCallUsd: lastCall, ceilingUsd: RUNNER_COST_CEILING_USD })) {
          return {
            kind: "stop",
            reason: "insufficient_information",
            summary: "Stopped before another model call so the run stays within its cost ceiling.",
          };
        }
        await db.rpc("heartbeat_agent_lease", {
          p_agent: "analyst",
          p_client_id: job.clientId,
          p_run_id: existing.run_id,
        });
        const round = await callClaudeRound(
          ANALYST_SYSTEM,
          agentTurnMessages(ctx),
          analystToolSchemas(),
          { toolChoice: { type: "any" }, maxTokens: 700, cachePrompt: true },
        );
        lastInputTokens = round.inputTokens;
        lastOutputTokens = round.outputTokens;
        lastCacheWriteTokens = round.cacheCreationTokens;
        lastCacheReadTokens = round.cacheReadTokens;
        inputTokens += round.inputTokens;
        outputTokens += round.outputTokens;
        cacheWriteTokens += round.cacheCreationTokens;
        cacheReadTokens += round.cacheReadTokens;
        return decisionFromClaude({ text: round.text, toolUses: round.toolUses });
      },
      execute: async (name, args) => {
        const payload = await executeAnalystTool(name, args, {
          clientId: job.clientId,
          runId: existing.run_id,
          correlationId,
          firmId,
          db,
          pool,
          recordedKeys,
          market: client?.market,
        });
        if (name !== "record_finding") {
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

    const outcome = analystRunOutcome({
      stopReason: result.status,
      steps: result.trace.map((step) => ({ tool: step.tool, status: step.status })),
      maxIterations: ANALYST_MAX_ITERATIONS,
    });
    const partial = outcome.status === "partial";
    await db
      .from("agent_runs")
      .update({
        status: outcome.status,
        stop_reason: outcome.stopReason,
        summary: analystRunSummary({ stopReason: outcome.stopReason, summary: result.summary }).slice(0, 2000),
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
      p_agent: "analyst",
      p_client_id: job.clientId,
      p_run_id: existing.run_id,
    });
    await recordHandoffFinish(db, {
      runId: existing.run_id,
      clientId: job.clientId,
      summary: result.summary,
      pool,
      market: client?.market,
    });
    await archive(db, job.msgId);
    return { status: partial ? "partial" : "succeeded", runId: existing.run_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analyst run failed";
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
        p_agent: "analyst",
        p_client_id: job.clientId,
        p_run_id: existing.run_id,
      });
      await requeue(db, { ...job, correlationId }, plan.delaySeconds, job.attempt + 1);
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
      p_agent: "analyst",
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
      });
      if (dlqError) console.warn("agent_queue_dead_letter", dlqError.message);
    } else {
      await archive(db, job.msgId);
    }
    return { status: "dead", runId: existing.run_id };
  }
}

async function recordHandoffFinish(
  db: SupabaseClient,
  input: { runId: string; clientId: string; summary: string; pool: StoredFigures[]; market?: unknown },
) {
  const { data: run, error } = await db
    .from("agent_runs")
    .select("action_item_id")
    .eq("id", input.runId)
    .maybeSingle();
  if (error || !run?.action_item_id) return;
  const actionItemId = run.action_item_id as string;
  const displayName = agentDisplayNameFromKey("analyst");
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
  const { count, error: countError } = await db
    .from("agent_findings")
    .select("id", { count: "exact", head: true })
    .eq("run_id", input.runId);
  if (countError) {
    console.warn("handoff findings", countError.message);
    return;
  }
  if ((count ?? 0) > 0) return;
  const { error: findingError } = await db.from("agent_findings").insert({
    agent: "analyst",
    client_id: input.clientId,
    run_id: input.runId,
    kind: "handoff",
    severity: "info",
    title: finding.title,
    detail: finding.detail,
    evidence: finding.evidence,
    last_seen: new Date().toISOString(),
  });
  if (findingError) console.warn("handoff finding", findingError.message);
}
