/**
 * One analyst job: lease, idempotency, the shared loop, then retry or dead-letter.
 * Background runs do not touch the pre-card allowance.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decisionFromClaude,
  formatAgentPrompt,
  runAgentLoop,
} from "../_shared/agent-core/loop.ts";
import { callClaudeRound } from "../_shared/agent-core/claude.ts";
import { ANALYST_SYSTEM, analystToolSchemas } from "../_shared/agent-prompts/analyst.ts";
import { sanitizeAgentError, type StoredFigures } from "../../../src/lib/agent-bus.ts";
import {
  ANALYST_MAX_ITERATIONS,
  ANALYST_TOOLS,
  ANALYST_TOOL_LABELS,
  analystFailurePlan,
  analystRunCostUsd,
  analystRunOutcome,
  collectStoredReads,
} from "../../../src/lib/agent-analyst.ts";
import { executeAnalystTool } from "./execute.ts";

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
    .select("firm_id")
    .eq("id", job.clientId)
    .maybeSingle();
  const firmId = (client?.firm_id as string | null) ?? null;
  const pool: StoredFigures[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

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
        await db.rpc("heartbeat_agent_lease", {
          p_agent: "analyst",
          p_client_id: job.clientId,
          p_run_id: existing.run_id,
        });
        const round = await callClaudeRound(
          ANALYST_SYSTEM,
          [{ role: "user", content: formatAgentPrompt(ctx) }],
          analystToolSchemas(),
          { toolChoice: { type: "any" }, maxTokens: 700, cachePrompt: true },
        );
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
        });
        if (name !== "record_finding") {
          for (const stored of collectStoredReads(payload, { snapshotId: null, periodLabel: null })) {
            pool.push(stored);
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
        summary: result.summary.slice(0, 2000),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_write_tokens: cacheWriteTokens,
        cache_read_tokens: cacheReadTokens,
        cost_usd: analystRunCostUsd(inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
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
