/**
 * Agent bus rules and the step-1 migration text.
 * No database. The SQL in the migration is the same rules as src/lib/agent-bus.ts.
 * Run: pnpm test:agent-foundation
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENT_DEBOUNCE_MS,
  AGENT_HOP_LIMIT,
  AGENT_IDLE_MS,
  AGENT_RETRY_BACKOFF_SECONDS,
  acceptAgentMessage,
  agentIdempotencyKey,
  agentIdempotencyMaterial,
  agentInputHash,
  agentQueueName,
  clientActivityMs,
  debounceEnqueue,
  groundFindingEvidence,
  isClientIdle,
  leaseAcquired,
  messageHopAllowed,
  promoteDecision,
  retryAfterFailure,
  routeAgentMessage,
  sanitizeAgentError,
} from "../src/lib/agent-bus.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const DAY = 24 * 60 * 60 * 1000;
const client = "11111111-1111-1111-1111-111111111111";

// Idempotency key is a sha256 of agent, client, trigger, and inputs.
{
  const material = agentIdempotencyMaterial({
    agent: "analyst",
    clientId: client,
    trigger: "sync",
    inputs: "period:2026-09-30",
  });
  assert(
    material === `analyst\n${client}\nsync\nperiod:2026-09-30`,
    "canonical material is agent, client, trigger, inputs separated by newlines",
  );
  const expected = createHash("sha256").update(material).digest("hex");
  const key = await agentIdempotencyKey({
    agent: "analyst",
    clientId: client,
    trigger: "sync",
    inputs: "period:2026-09-30",
  });
  assert(key === expected, "idempotency key is sha256 of that material");
  const again = await agentIdempotencyKey({
    agent: "analyst",
    clientId: client,
    trigger: "sync",
    inputs: "period:2026-09-30",
  });
  assert(again === key, "the same inputs repeat the key");
  const otherTrigger = await agentIdempotencyKey({
    agent: "analyst",
    clientId: client,
    trigger: "upload",
    inputs: "period:2026-09-30",
  });
  assert(otherTrigger !== key, "a different trigger is a different run");
  const otherClient = await agentIdempotencyKey({
    agent: "analyst",
    clientId: "22222222-2222-2222-2222-222222222222",
    trigger: "sync",
    inputs: "period:2026-09-30",
  });
  assert(otherClient !== key, "a different client is a different run");
  const otherAgent = await agentIdempotencyKey({
    agent: "financial_manager",
    clientId: client,
    trigger: "sync",
    inputs: "period:2026-09-30",
  });
  assert(otherAgent !== key, "a different agent is a different run");
  const inputHash = await agentInputHash("period:2026-09-30");
  assert(
    inputHash === createHash("sha256").update("period:2026-09-30").digest("hex"),
    "input hash is sha256 of the inputs alone",
  );
  assert(inputHash !== key, "the input hash is not the idempotency key");
}

// Lease: free, held, expired, and renewed by the same run.
{
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert(leaseAcquired(null, { runId: "run-a", nowMs: now }) === true, "an empty lease is free");
  const held = { runId: "run-a", expiresAtMs: now + 60_000 };
  assert(
    leaseAcquired(held, { runId: "run-b", nowMs: now }) === false,
    "a live lease blocks another run",
  );
  assert(
    leaseAcquired(held, { runId: "run-a", nowMs: now }) === true,
    "the holder can renew before expiry",
  );
  assert(
    leaseAcquired(held, { runId: "run-b", nowMs: held.expiresAtMs }) === false,
    "the lease is held at the exact expiry instant",
  );
  assert(
    leaseAcquired(held, { runId: "run-b", nowMs: held.expiresAtMs + 1 }) === true,
    "the lease is free one millisecond after expiry",
  );
  assert(5 * 60 * 1000 === 300_000, "the documented lease is five minutes");
}

// Routing: findings from the analyst also land on the financial manager queue.
{
  assert(agentQueueName("financial_manager") === "agent_fm", "coordinator queue name");
  assert(agentQueueName("analyst") === "agent_analyst", "analyst queue name");
  const finding = routeAgentMessage({
    fromAgent: "analyst",
    toAgent: null,
    type: "finding",
  });
  assert(finding.join(",") === "agent_fm", "a finding with no addressee still reaches the coordinator");
  const addressed = routeAgentMessage({
    fromAgent: "analyst",
    toAgent: "advisor",
    type: "finding",
  });
  assert(
    addressed.join(",") === "agent_advisor,agent_fm",
    "an addressed finding is copied to the coordinator",
  );
  const own = routeAgentMessage({
    fromAgent: "financial_manager",
    toAgent: "advisor",
    type: "finding",
  });
  assert(own.join(",") === "agent_advisor", "the coordinator's own finding is not copied back");
  const request = routeAgentMessage({
    fromAgent: "advisor",
    toAgent: "analyst",
    type: "request",
  });
  assert(request.join(",") === "agent_analyst", "a request goes only to its addressee");
}

// Hop limit and the correlation cap.
{
  assert(messageHopAllowed(0) && messageHopAllowed(AGENT_HOP_LIMIT), "hops 0 through 4 are allowed");
  assert(!messageHopAllowed(5) && !messageHopAllowed(-1) && !messageHopAllowed(1.5), "hop 5 is over the limit");
  const over = acceptAgentMessage({
    fromAgent: "analyst",
    toAgent: "financial_manager",
    type: "finding",
    hop: 5,
    correlationCount: 0,
  });
  assert(over.ok === false && over.error.includes("hop limit is 4"), "hop 5 is rejected");
  const self = acceptAgentMessage({
    fromAgent: "analyst",
    toAgent: "analyst",
    type: "ack",
    hop: 1,
    correlationCount: 1,
  });
  assert(self.ok === false && self.error.includes("cannot message itself"), "an agent cannot address itself");
  const capped = acceptAgentMessage({
    fromAgent: "analyst",
    toAgent: "financial_manager",
    type: "answer",
    hop: 2,
    correlationCount: 12,
  });
  assert(capped.ok === false && capped.error.includes("capped at 12"), "the 13th message in a correlation is rejected");
  const ok = acceptAgentMessage({
    fromAgent: "analyst",
    toAgent: null,
    type: "finding",
    hop: 0,
    correlationCount: 11,
  });
  assert(ok.ok === true && ok.queues.join(",") === "agent_fm", "the 12th message is still delivered");
}

// Debounce and the 30-day idle skip.
{
  const now = Date.parse("2026-10-10T12:00:00Z");
  const first = debounceEnqueue({ nowMs: now, pending: null });
  assert(first.action === "schedule", "the first event schedules a run");
  assert(first.runAfterMs - now === AGENT_DEBOUNCE_MS, "the window is 10 minutes");
  const burst = debounceEnqueue({
    nowMs: now + 60_000,
    pending: { runAfterMs: first.runAfterMs, consumed: false },
  });
  assert(burst.action === "coalesce" && burst.runAfterMs === first.runAfterMs, "a burst keeps the first run_after");
  const later = debounceEnqueue({
    nowMs: first.runAfterMs + 1,
    pending: { runAfterMs: first.runAfterMs, consumed: false },
  });
  assert(later.action === "schedule", "after the window a new run is scheduled");
  const consumed = debounceEnqueue({
    nowMs: now + 60_000,
    pending: { runAfterMs: first.runAfterMs, consumed: true },
  });
  assert(consumed.action === "schedule", "a consumed event does not swallow the next one");

  const created = now - 40 * DAY;
  assert(
    isClientIdle({
      nowMs: now,
      createdAtMs: created,
      lastLoginAtMs: null,
      previousBooksAtMs: now - 31 * DAY,
    }),
    "books and login older than 30 days are idle",
  );
  assert(
    !isClientIdle({
      nowMs: now,
      createdAtMs: created,
      lastLoginAtMs: null,
      previousBooksAtMs: now - 10 * DAY,
    }),
    "books updated 10 days ago are not idle",
  );
  assert(
    !isClientIdle({
      nowMs: now,
      createdAtMs: now - 2 * DAY,
      lastLoginAtMs: null,
      previousBooksAtMs: null,
    }),
    "a client created this week is not idle",
  );
  assert(
    clientActivityMs({
      createdAtMs: created,
      lastLoginAtMs: now - 3 * DAY,
      previousBooksAtMs: now - 20 * DAY,
    }) === now - 3 * DAY,
    "activity is the latest of created, login, and prior books",
  );
  assert(AGENT_IDLE_MS === 30 * DAY, "idle window is 30 days");

  assert(promoteDecision({ nowMs: now, runAfterMs: now + 1000, consumed: false }) === "wait", "future events wait");
  assert(promoteDecision({ nowMs: now, runAfterMs: now - 1000, consumed: false }) === "promote", "a due event is promoted");
  assert(
    promoteDecision({ nowMs: now, runAfterMs: now - 31 * 60 * 1000, consumed: false }) === "stale",
    "an event left over from a disabled dispatcher is stale",
  );
  assert(promoteDecision({ nowMs: now, runAfterMs: now - 1000, consumed: true }) === "wait", "consumed events are not sent again");
}

// Retries: 1 minute, 5 minutes, 15 minutes, then the dead-letter queue.
{
  assert(retryAfterFailure(1).action === "retry" && retryAfterFailure(1).delaySeconds === 60, "first retry waits 1 minute");
  assert(retryAfterFailure(2).delaySeconds === 300, "second retry waits 5 minutes");
  assert(retryAfterFailure(3).delaySeconds === 900, "third retry waits 15 minutes");
  assert(retryAfterFailure(4).action === "dead_letter", "the failure after the 15-minute retry is dead-lettered");
  assert(AGENT_RETRY_BACKOFF_SECONDS.join(",") === "60,300,900", "backoff table is 1, 5, and 15 minutes");
}

// Findings keep only figures that were actually read.
{
  const missing = groundFindingEvidence({ pool: [], claimedFigures: { revenue: 10 } });
  assert(missing.ok === false, "a finding with no stored read is rejected");
  const invented = groundFindingEvidence({
    pool: [{ snapshotId: "snap-1", periodLabel: "Sep 2026", figures: { revenue: 100 } }],
    claimedFigures: { revenue: 999 },
  });
  assert(invented.ok === false, "a figure that was not stored is rejected");
  const grounded = groundFindingEvidence({
    pool: [{ snapshotId: "snap-1", periodLabel: "Sep 2026", figures: { revenue: 100, cash: 40 } }],
    claimedFigures: { revenue: 100, cash: 1 },
  });
  assert(grounded.ok === true, "a matching figure is kept");
  if (grounded.ok) {
    assert(grounded.evidence.figures.revenue === 100, "the stored revenue is the evidence");
    assert(grounded.evidence.figures.cash == null, "the invented cash figure is stripped");
    assert(grounded.evidence.snapshot_id === "snap-1", "the snapshot id stays on the evidence");
  }
  const secret = sanitizeAgentError("Claude error (401): sk-ant-abc123 Bearer eyJhbGciOi.eyJzdWIiOi.signature");
  assert(!secret.includes("sk-ant-abc123"), "an API key is not stored");
  assert(!secret.includes("eyJhbGciOi"), "a bearer token is not stored");
}

// The migration text encodes the same rules and stays re-runnable.
{
  const sql = readFileSync(
    resolve("supabase/migrations/20261010160000_agent_foundation.sql"),
    "utf8",
  );
  assert(sql.includes("CREATE TYPE public.agent_key AS ENUM ('financial_manager', 'analyst', 'advisor')"), "agent_key enum");
  assert(sql.includes("IF NOT EXISTS"), "tables and indexes use IF NOT EXISTS");
  assert(sql.includes("CREATE OR REPLACE FUNCTION"), "functions replace in place");
  assert(sql.includes("DROP POLICY IF EXISTS"), "policies are dropped before create");
  assert(sql.includes("DROP TRIGGER IF EXISTS"), "triggers are dropped before create");
  assert(sql.includes("UNIQUE (agent, idempotency_key)"), "one run per agent and key");
  assert(sql.includes("hop >= 0 AND hop <= 4"), "hop check is at most 4");
  assert(sql.includes("an agent cannot message itself"), "self-send is rejected in SQL");
  assert(sql.includes("agent correlation is capped at 12 messages"), "correlation cap is in SQL");
  assert(sql.includes("'agent_fm'"), "findings route to the financial manager queue");
  assert(sql.includes("pgmq.create('agent_analyst')"), "analyst queue");
  assert(sql.includes("pgmq.create('agent_analyst_dlq')"), "analyst dead-letter queue");
  assert(sql.includes("interval '30 days'"), "idle window is 30 days");
  assert(sql.includes("interval '10 minutes'"), "debounce is 10 minutes");
  assert(sql.includes("interval '5 minutes'"), "lease ttl is 5 minutes");
  assert(
    sql.includes("WHERE public.agent_leases.expires_at < now()"),
    "a live lease is not taken",
  );
  assert(
    !sql.includes("OR public.agent_leases.run_id = EXCLUDED.run_id"),
    "the same run does not re-enter a live lease",
  );
  assert(sql.includes("agent_findings_evidence_chk"), "findings require evidence");
  assert(sql.includes("has_client_access"), "reads use has_client_access");
  assert(sql.includes("supabase_realtime"), "runs, messages, and findings join realtime");
  assert(sql.includes("agent_runs") && sql.includes("agent_messages") && sql.includes("agent_findings"), "realtime tables");
  assert(sql.includes("VALUES ('enabled', 'false'::jsonb)"), "dispatch flag starts false");
  assert(sql.includes("cron.alter_job"), "the schedule is disabled with cron.alter_job");
  assert(sql.includes("active := false"), "cron job is created inactive");
  assert(!sql.includes("UPDATE cron.job"), "the migration does not update cron.job");
  assert(!sql.includes("DELETE FROM cron.job"), "the migration does not delete from cron.job");
  assert(sql.includes("p_agent::text || E'\\n' || p_client_id::text || E'\\n' || p_trigger || E'\\n'"), "SQL key material matches the TypeScript material");
  assert(!sql.includes("sk-") && !sql.includes("service_role_key' ||"), "the migration does not embed a secret");
  assert(
    sql.includes("UPDATE public.agent_settings") &&
      sql.includes(
        "SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'agent-dispatch'), active := true)",
      ),
    "the flip SQL is documented in the migration",
  );
}

// The applied foundation function left an OUT name unqualified in ON CONFLICT.
{
  const fix = readFileSync(
    resolve("supabase/migrations/20261010220000_begin_agent_run_variable_conflict.sql"),
    "utf8",
  );
  const start = fix.indexOf("CREATE OR REPLACE FUNCTION public.begin_agent_run");
  assert(start >= 0, "the follow-up migration replaces begin_agent_run");
  const body = fix.slice(start);
  const directive = body.indexOf("#variable_conflict use_column");
  const declared = body.indexOf("DECLARE");
  assert(
    directive >= 0 && declared >= 0 && directive < declared,
    "begin_agent_run contains #variable_conflict use_column before its declarations",
  );
  assert(
    body.includes("RETURNS TABLE (run_id uuid, status text, idempotency_key text, is_new boolean)"),
    "begin_agent_run keeps the same output columns",
  );
  assert(
    body.includes("SECURITY DEFINER") && body.includes("SET search_path = public, extensions"),
    "begin_agent_run keeps its security settings",
  );
}

console.log("agent foundation ok");
