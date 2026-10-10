/**
 * Analyst allow-list, retries, evidence, and the enqueue call sites.
 * No database and no model call.
 * Run: pnpm test:agent-analyst
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isClientIdle } from "../src/lib/agent-bus.ts";
import { priorActivityIso } from "../src/lib/agent-enqueue.ts";
import {
  ANALYST_MAX_ITERATIONS,
  ANALYST_TOOLS,
  analystFailurePlan,
  analystRunCostUsd,
  analystToolAllowed,
  executeAnalystGate,
  statementVariance,
} from "../src/lib/agent-analyst.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const DAY = 24 * 60 * 60 * 1000;

// Allow-list: the seven reads plus record_finding. Milonbot writes are refused.
{
  assert(ANALYST_TOOLS.length === 8, "seven read tools plus record_finding");
  for (const name of [
    "get_health",
    "get_ratios",
    "get_variance",
    "get_financial_snapshot",
    "get_statement_history",
    "get_data_freshness",
    "get_score_history",
    "record_finding",
  ]) {
    assert(analystToolAllowed(name), `${name} is allowed`);
    assert(executeAnalystGate(name).allowed === true, `${name} passes the gate`);
  }
  for (const blocked of [
    "get_cash_flow",
    "propose_next_steps",
    "draft_deliverable",
    "create_task_from_recommendation",
    "assign_task",
    "send_email",
    "get_company",
  ]) {
    const gate = executeAnalystGate(blocked);
    assert(gate.allowed === false, `${blocked} is refused`);
    if (!gate.allowed) {
      assert(gate.tool_blocked === true, `${blocked} is marked tool_blocked`);
      assert(gate.tool === blocked, "the refused name is recorded");
    }
  }
  const executeSrc = readFileSync(
    resolve("supabase/functions/agent-analyst/execute.ts"),
    "utf8",
  );
  assert(executeSrc.includes("executeAnalystGate"), "execute refuses a tool before it runs");
  assert(executeSrc.includes("groundFindingEvidence"), "findings are grounded in stored figures");
}

// Variance is the difference of stored totals, and only for keys present on both.
{
  const variance = statementVariance(
    { revenue: 120, cash: 40, equity: 10 },
    { revenue: 100, cash: 40 },
  );
  assert(variance.revenue.delta === 20, "revenue variance is current minus prior");
  assert(variance.cash.delta === 0, "an unchanged stored total is a zero delta");
  assert(variance.equity == null, "a total missing from the prior period is omitted");
}

// Retries: 1, 5, and 15 minutes, then the dead-letter queue. A 4xx is not retried.
{
  const first = analystFailurePlan(1, "Rate limit reached — try again in a moment.");
  assert(first.action === "retry" && first.delaySeconds === 60, "first failure waits 1 minute");
  const second = analystFailurePlan(2, "the model error (503): unavailable");
  assert(second.action === "retry" && second.delaySeconds === 300, "second failure waits 5 minutes");
  const third = analystFailurePlan(3, "the model error (500): down");
  assert(third.action === "retry" && third.delaySeconds === 900, "third failure waits 15 minutes");
  const dead = analystFailurePlan(4, "the model error (503): still down");
  assert(dead.action === "dead_letter", "the failure after 15 minutes is dead-lettered");
  const schema = analystFailurePlan(1, "the model error (400): bad schema");
  assert(schema.action === "dead", "a 4xx schema error is not retried");
  assert(!schema.error.toLowerCase().includes("claude"), "stored errors do not name the model vendor");
  assert(ANALYST_MAX_ITERATIONS === 4, "the analyst loop stops at 4 iterations");
  assert(analystRunCostUsd(1_000_000, 1_000_000) === 18, "cost uses the $3 and $15 rates");
}

// A sync passes the activity from before the write, so a 31-day-quiet client is idle.
{
  const now = Date.parse("2026-10-10T12:00:00Z");
  const quiet = new Date(now - 31 * DAY).toISOString();
  const activity = priorActivityIso({
    createdAt: new Date(now - 400 * DAY).toISOString(),
    lastLoginAt: null,
    previousBooksAt: quiet,
  });
  assert(activity === quiet, "prior activity is the books timestamp when login is absent");
  assert(
    isClientIdle({
      nowMs: now,
      createdAtMs: now - 400 * DAY,
      lastLoginAtMs: null,
      previousBooksAtMs: Date.parse(activity ?? ""),
    }),
    "that timestamp is idle",
  );
  const recent = priorActivityIso({
    createdAt: new Date(now - 400 * DAY).toISOString(),
    lastLoginAt: null,
    previousBooksAt: new Date(now - 5 * DAY).toISOString(),
  });
  assert(
    !isClientIdle({
      nowMs: now,
      createdAtMs: now - 400 * DAY,
      lastLoginAtMs: null,
      previousBooksAtMs: Date.parse(recent ?? ""),
    }),
    "books updated 5 days ago are enqueued",
  );
}

// Source locks: no pre-card charge, same model call, books-based prompt, sync hooks.
{
  const files = ["index.ts", "run.ts", "execute.ts"].map((name) =>
    readFileSync(resolve("supabase/functions/agent-analyst", name), "utf8"),
  );
  const dispatch = readFileSync(resolve("supabase/functions/agent-dispatch/index.ts"), "utf8");
  const joined = files.join("\n");
  assert(!joined.includes("precard"), "background analyst runs do not touch the pre-card allowance");
  assert(!joined.includes("increment_precard"), "background runs do not increment pre-card usage");
  assert(!dispatch.includes("precard"), "the dispatcher does not touch the pre-card allowance");
  assert(joined.includes('from "../_shared/agent-core/claude.ts"'), "the analyst uses the shared model call");
  assert(joined.includes('existing.status === "partial"'), "a finished partial run is not repeated");
  assert(joined.includes('existing.status === "running"'), "a live run is not started a second time");
  assert(dispatch.includes('p_function: "agent-analyst"'), "the dispatcher invokes agent-analyst");
  assert(dispatch.includes("agent_invoke"), "the invocation goes through the pg_net SQL function");
  assert(dispatch.includes('reason: "disabled"'), "a disabled flag does not read the queue");

  const prompt = readFileSync(resolve("supabase/functions/_shared/agent-prompts/analyst.ts"), "utf8");
  assert(!/claude|anthropic/i.test(prompt), "the analyst prompt does not name the model vendor");
  assert(!prompt.includes("Dana"), "the analyst prompt does not use a retired name");
  assert(prompt.includes("books on file"), "findings are books-based");
  assert(/not a bank/i.test(prompt), "copy does not claim bank-verified cash");
  assert(prompt.includes("No tax"), "the analyst does not give tax figures");
  assert(prompt.includes("Milōn Analyst"), "the agent names itself Milōn Analyst");

  for (const file of ["src/lib/xero.functions.ts", "src/lib/qbo.functions.ts", "src/lib/sage-sync.server.ts"]) {
    const src = readFileSync(resolve(file), "utf8");
    assert(src.includes("enqueueAgentEventSafe"), `${file} enqueues after a successful sync`);
    assert(src.includes('trigger: "sync"'), `${file} enqueues a sync event`);
    assert(src.includes("priorActivityIso"), `${file} passes activity from before the write`);
  }

  const migration = readFileSync(
    resolve("supabase/migrations/20261010160000_agent_foundation.sql"),
    "utf8",
  );
  assert(migration.includes("'upload', 'pdf_upload', 'financial_statement'"), "statement uploads enqueue");
  assert(migration.includes("agent-dispatch"), "the cron names the dispatcher");

  const promptFiles = readdirSync(resolve("supabase/functions/_shared/agent-prompts"));
  assert(promptFiles.includes("analyst.ts"), "the analyst prompt file is in place");
}

console.log("agent analyst ok");
