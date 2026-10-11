/**
 * Financial Manager and Advisor runners. No database and no model call.
 * Run: pnpm test:agent-runners
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analystRunCostUsd } from "../src/lib/agent-analyst.ts";
import { findingDuplicates } from "../src/lib/agent-analyst.ts";
import { booksQualityFigures, savedBudgetFigures, savedCashflowFigures } from "../src/lib/agent-books.ts";
import {
  draftClaimsSignedOff,
  draftMessageType,
  prepareDraftRecord,
  resolveDraftRecipient,
  RUNNER_COST_CEILING_USD,
  RUNNER_COST_STOP_USD,
  RUNNER_TOKEN_ENVELOPE,
  runnerEarlyFinish,
  runnerShouldStopForCost,
} from "../src/lib/agent-draft.ts";
import {
  ADVISOR_COST_CEILING_USD,
  ADVISOR_COST_STOP_USD,
  ADVISOR_DRAFT_KINDS,
  ADVISOR_MAX_ITERATIONS,
  ADVISOR_PEERS,
  ADVISOR_TOOLS,
  advisorRunOutcome,
  executeAdvisorGate,
} from "../src/lib/agent-advisor.ts";
import {
  FM_COST_CEILING_USD,
  FM_COST_STOP_USD,
  FM_DRAFT_KINDS,
  FM_MAX_ITERATIONS,
  FM_PEERS,
  FM_TOOLS,
  executeFinancialManagerGate,
  fmRunOutcome,
} from "../src/lib/agent-financial-manager.ts";
import { REJECTED_TRACE_ARGS_MAX, runAgentLoop } from "../supabase/functions/_shared/agent-core/loop.ts";
import { handoffDecision } from "../src/lib/owner-handoff.ts";
import { advisorToolSchemas, ADVISOR_SYSTEM } from "../supabase/functions/_shared/agent-prompts/advisor.ts";
import {
  financialManagerToolSchemas,
  FINANCIAL_MANAGER_SYSTEM,
} from "../supabase/functions/_shared/agent-prompts/financial-manager.ts";
import { claudeRequestFields, CLAUDE_SONNET_55 } from "../src/lib/claude-request.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const pool = [
  { snapshotId: "snap-sep", periodLabel: "Sep 2026", figures: { revenue: 100, cash: 40 } },
  { snapshotId: null, periodLabel: "saved cashflow", figures: { opening_balance: 1000, lowest_closing: 800, horizon_weeks: 13 } },
];

// Grounding: a draft may only carry figures a read returned.
{
  const missing = prepareDraftRecord({
    kind: "action_point_draft",
    allowedKinds: FM_DRAFT_KINDS,
    severity: "watch",
    title: "Cash needs a look",
    detail: "The books on file show cash of 1.",
    claimedFigures: { cash: 1 },
    pool,
    recordedKeys: new Set(),
  });
  assert(missing.ok === false, "a figure that was not stored is rejected");
  const kept = prepareDraftRecord({
    kind: "action_point_draft",
    allowedKinds: FM_DRAFT_KINDS,
    severity: "act",
    title: "Cash on file is 40",
    detail: "The September books on file show cash of 40.",
    claimedFigures: { cash: 40 },
    pool,
    recordedKeys: new Set(),
  });
  assert(kept.ok === true, "a draft whose figures match a read is kept");
  if (kept.ok) {
    assert(kept.evidence.draft === true, "a saved draft is marked draft");
    assert(kept.evidence.requires_human_approval === true, "a person must approve the draft");
    assert(kept.evidence.figures.cash === 40, "the stored cash is the evidence");
    assert(kept.evidence.period_label === "Sep 2026", "the period stays on the evidence");
  }
}

// Dedupe is by kind and period end. Dismissed rows are not in the set the writer queries.
{
  const recent = [
    {
      id: "old",
      kind: "action_point_draft",
      figures: { cash: 40 },
      seenAtMs: Date.parse("2026-10-08T00:00:00Z"),
      periodLabel: "1 Jan 2026 – 30 Sep 2026",
      snapshotId: "snap-sep",
      severity: "watch",
    },
  ];
  const same = findingDuplicates({
    nowMs: Date.parse("2026-10-10T00:00:00Z"),
    candidate: {
      kind: "action_point_draft",
      figures: { cash: 40 },
      periodLabel: "Sep 2026",
      snapshotId: null,
    },
    recent,
  });
  assert(same?.id === "old", "the same kind and period end dedupes");
  const otherKind = findingDuplicates({
    nowMs: Date.parse("2026-10-10T00:00:00Z"),
    candidate: {
      kind: "data_request_draft",
      figures: { cash: 40 },
      periodLabel: "Sep 2026",
      snapshotId: "snap-sep",
    },
    recent,
  });
  assert(otherKind === null, "a different kind is a different draft");
  const desk = read("supabase/functions/_shared/agent-desk.ts");
  assert(desk.includes('.is("dismissed_reason", null)'), "dismissed findings are not revived");
  assert(desk.includes('.is("superseded_by", null)'), "superseded findings are not revived");
}

// Drafts only. Signed off is refused. No live records.
{
  assert(draftClaimsSignedOff(["Pack signed off"]), "signed off is recognised");
  assert(!draftClaimsSignedOff(["Cash on file is 40"]), "a normal draft is not a sign-off");
  const signed = prepareDraftRecord({
    kind: "next_move_draft",
    allowedKinds: ADVISOR_DRAFT_KINDS,
    severity: "info",
    title: "Pack signed off",
    detail: "The books on file show cash of 40.",
    claimedFigures: { cash: 40 },
    pool,
    recordedKeys: new Set(),
  });
  assert(signed.ok === false, "a signed-off draft is refused");
  if (!signed.ok) assert(signed.error.includes("accountant-only"), "the refusal says signed off is accountant-only");
  assert(draftMessageType("data_request_draft") === "request", "a data request draft is a request message");
  assert(draftMessageType("accountant_handoff_draft") === "handoff", "an accountant hand-off is a hand-off message");
  assert(!deskWritesLiveRecords(read("supabase/functions/_shared/agent-desk.ts")), "the desk writer does not open live records");
}

function deskWritesLiveRecords(src: string): boolean {
  return (
    src.includes('from("data_requests")') ||
    src.includes('from("deliverable_drafts")') ||
    src.includes('from("proposed_next_steps")') ||
    src.includes('from("action_items")') ||
    src.includes("advisory_pack_review") ||
    src.includes("signed_off_at") ||
    src.includes("send_email") ||
    src.includes("access_token")
  );
}

// Allow-lists. Email, sign-off, and the other bot's writes are refused.
{
  assert(executeFinancialManagerGate("record_draft").allowed === true, "the financial manager can draft");
  assert(executeFinancialManagerGate("send_email").allowed === false, "the financial manager cannot email");
  assert(executeFinancialManagerGate("get_health").allowed === false, "health is not on the financial manager list");
  assert(executeAdvisorGate("record_draft").allowed === true, "the advisor can draft");
  assert(executeAdvisorGate("record_finding").allowed === false, "the advisor does not publish analyst findings");
  assert(executeAdvisorGate("send_email").allowed === false, "the advisor cannot email");
  assert(!FM_TOOLS.includes("get_health" as never), "the financial manager list is its own");
  const fmSchema = financialManagerToolSchemas().find((tool) => tool.name === "record_draft");
  const fmKind = (fmSchema?.input_schema.properties as { kind?: { enum?: string[] } }).kind?.enum;
  assert(JSON.stringify(fmKind) === JSON.stringify([...FM_DRAFT_KINDS]), "financial manager kinds are the draft kinds");
  const advisorSchema = advisorToolSchemas().find((tool) => tool.name === "record_draft");
  const advisorKind = (advisorSchema?.input_schema.properties as { kind?: { enum?: string[] } }).kind?.enum;
  assert(JSON.stringify(advisorKind) === JSON.stringify([...ADVISOR_DRAFT_KINDS]), "advisor kinds are the draft kinds");
  assert(!advisorKind?.some((kind) => /sign/i.test(kind)), "no signed-off kind");
  const fmTo = (fmSchema?.input_schema.properties as { to_agent?: { enum?: string[] } }).to_agent?.enum;
  const advisorTo = (advisorSchema?.input_schema.properties as { to_agent?: { enum?: string[] } }).to_agent?.enum;
  const fmRequired = fmSchema?.input_schema.required as string[];
  const advisorRequired = advisorSchema?.input_schema.required as string[];
  assert(JSON.stringify(fmTo) === JSON.stringify([...FM_PEERS]), "financial manager to_agent is analyst or advisor");
  assert(JSON.stringify(advisorTo) === JSON.stringify([...ADVISOR_PEERS]), "advisor to_agent is financial_manager or analyst");
  assert(!fmTo?.includes("financial_manager"), "the financial manager schema excludes itself");
  assert(!advisorTo?.includes("advisor"), "the advisor schema excludes itself");
  assert(!fmRequired.includes("to_agent") && !advisorRequired.includes("to_agent"), "to_agent is optional");
}

// Stored cash and budget. Tax stays out. Closings come from the saved cashflow.
{
  const cash = savedCashflowFigures({
    openingBalance: "1000",
    revenue: [{ amount: "100", frequency: "once-off", startWeek: 1 }],
    expenses: [],
    other: [],
  });
  assert(cash.empty === false, "a saved cashflow is readable");
  assert(cash.figures.opening_balance === 1000, "opening cash is the stored opening");
  assert(cash.figures.week_1_closing === 1100, "week 1 closing is the saved cashflow reading");
  assert(cash.figures.horizon_weeks === 13, "the horizon is the product's 13 weeks");
  assert(/not a bank/i.test(cash.note), "cash copy does not claim a bank balance");
  const budget = savedBudgetFigures({
    openingCash: 5000,
    gpPct: 40,
    fyStart: "2026-03",
    vatRate: 15,
    wc: { debtorDays: 30, creditorDays: 20, inventoryDays: 10 },
  });
  assert(budget.figures.opening_cash === 5000, "budget opening cash is stored");
  assert(budget.figures.debtor_days === 30, "budget debtor days are stored");
  assert(!("vatRate" in budget.figures), "budget tax is not a figure");
  assert(/not a tax/i.test(budget.note), "budget copy says it is not a tax figure");
  const quality = booksQualityFigures({
    qboConnected: true,
    xeroConnected: false,
    sageConnected: false,
    hasUpload: true,
    statementTotals: { revenue: 100 },
  });
  assert(quality.connected_ledgers === 1 && quality.has_upload === 1 && quality.revenue === 100, "quality counts ledgers and uploads");
}

// Runners resolve. Unknown bots do not. Flags default off in the migration.
{
  const manager = handoffDecision("financial_manager");
  const advisor = handoffDecision("advisor");
  assert(manager.ok && manager.runner === "agent-financial-manager", "owner hand-off resolves the financial manager");
  assert(advisor.ok && advisor.runner === "agent-advisor", "owner hand-off resolves the advisor");
  assert(handoffDecision("bookkeeper").ok === false, "an unknown bot is not a runner");
  const fn = read("supabase/functions/owner-handoff/index.ts");
  assert(!fn.includes("no_runner"), "owner hand-off does not return no_runner");
  const dispatch = read("supabase/functions/agent-dispatch/index.ts");
  assert(dispatch.includes('fn: "agent-financial-manager"'), "dispatch invokes the financial manager");
  assert(dispatch.includes('fn: "agent-advisor"'), "dispatch invokes the advisor");
  assert(dispatch.includes('fn: "agent-analyst"'), "dispatch still invokes the analyst");
  assert(dispatch.includes('reason: "disabled"'), "every flag off does not read a queue");
  assert(!dispatch.includes("precard"), "dispatch does not touch the pre-card allowance");
  const sql = read("supabase/migrations/20261012120000_agent_fm_advisor_runners.sql");
  assert(sql.includes("pgmq.create('agent_advisor')"), "advisor queue");
  assert(sql.includes("pgmq.create('agent_fm_dlq')"), "financial manager dead-letter queue");
  assert(sql.includes("pgmq.create('agent_advisor_dlq')"), "advisor dead-letter queue");
  assert(sql.includes("('financial_manager_enabled', 'false'::jsonb)"), "financial manager flag starts false");
  assert(sql.includes("('advisor_enabled', 'false'::jsonb)"), "advisor flag starts false");
  assert(sql.includes("agent_idempotency_key"), "a routed message enqueues with the idempotency key");
  assert(sql.includes("'trigger', 'message'"), "the queued run trigger is message");
  assert(sql.includes("'agent-financial-manager'"), "invoke allows the financial manager");
  assert(sql.includes("'agent-advisor'"), "invoke allows the advisor");
  assert(sql.includes("timeout_milliseconds := 60000"), "invoke keeps the 60 second timeout");
  const applied = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert(!applied.includes("SET value = 'true'"), "the migration does not flip a flag on");
  assert(!applied.includes("cron.alter_job"), "the migration does not activate the cron");
}

// Same statuses as the analyst. Sonnet 5.5 call shape. Cost envelope. No pre-card.
{
  const job = read("supabase/functions/_shared/agent-core/job.ts");
  const analystRun = read("supabase/functions/agent-analyst/run.ts");
  for (const status of ["succeeded", "partial", "dead", "cancelled", "skipped", "running", "queued"]) {
    assert(job.includes(`"${status}"`), `the runner uses status ${status}`);
    assert(analystRun.includes(`"${status}"`), `the analyst uses status ${status}`);
  }
  assert(!job.includes('"failed"'), "the runner does not add a failed status");
  assert(job.includes("cachePrompt: true"), "runs cache the system prompt and the tools");
  assert(job.includes('toolChoice: { type: "auto" }'), "tool choice is auto, not forced");
  assert(!job.includes("temperature"), "the runner does not set a temperature");
  assert(job.includes("runAgentLoop"), "parallel tool calls go through the shared loop");
  assert(job.includes("decisionFromClaude"), "a reply's tool calls are all executed");
  const fields = claudeRequestFields({
    model: CLAUDE_SONNET_55,
    temperature: 0.2,
    toolChoice: { type: "auto" },
  });
  assert(fields.thinking?.type === "between_tools", "Sonnet 5.5 thinks between tools");
  assert(!("temperature" in fields), "Sonnet 5.5 does not send a temperature");
  assert(fields.tool_choice?.type === "auto", "Sonnet 5.5 does not force a tool");
  const cost = analystRunCostUsd(
    RUNNER_TOKEN_ENVELOPE.uncachedInputTokens,
    RUNNER_TOKEN_ENVELOPE.outputTokens,
    RUNNER_TOKEN_ENVELOPE.cacheWriteTokens,
    RUNNER_TOKEN_ENVELOPE.cacheReadTokens,
  );
  assert(cost <= RUNNER_COST_STOP_USD, `a normal four-turn run costs ${cost}, over the stop line`);
  assert(cost <= RUNNER_COST_CEILING_USD && RUNNER_COST_CEILING_USD <= 0.06, "each run stays at or under $0.06");
  assert(RUNNER_COST_STOP_USD < RUNNER_COST_CEILING_USD, "the stop line leaves headroom under the ceiling");
  assert(runnerShouldStopForCost(RUNNER_COST_STOP_USD), "a run at the stop line does not call the model again");
  assert(!runnerShouldStopForCost(0.04), "the turn-3 production spend can take another turn");
  assert(!runnerShouldStopForCost(RUNNER_COST_STOP_USD - 0.01), "a cheaper run may continue");
  assert(FM_MAX_ITERATIONS === 6 && ADVISOR_MAX_ITERATIONS === 6, "a 3–4 turn run has headroom before the cap");
  assert(FM_COST_CEILING_USD === 0.06 && ADVISOR_COST_CEILING_USD === 0.06, "each agent ceiling is $0.06");
  assert(FM_COST_STOP_USD === RUNNER_COST_STOP_USD && ADVISOR_COST_STOP_USD === RUNNER_COST_STOP_USD, "each agent stops on the shared line");
  assert(runnerEarlyFinish(0) === null, "a run with no draft keeps going");
  const early = runnerEarlyFinish(1);
  assert(early?.reason === "objective_complete", "a recorded draft finishes the run");
  const capped = fmRunOutcome({
    stopReason: "safety_limit",
    maxIterations: FM_MAX_ITERATIONS,
    steps: [
      { tool: "get_books_quality", status: "ok" },
      { tool: "record_draft", status: "ok" },
      { tool: "get_cash_13_week", status: "ok" },
      { tool: "record_draft", status: "error" },
      { tool: "get_inbox", status: "ok" },
      { tool: "record_draft", status: "ok" },
    ],
  });
  assert(capped.status === "succeeded" && capped.stopReason === "cap_after_findings", "a cap after a draft is the analyst finish");
  const advisorCap = advisorRunOutcome({
    stopReason: "safety_limit",
    maxIterations: ADVISOR_MAX_ITERATIONS,
    steps: Array.from({ length: ADVISOR_MAX_ITERATIONS }, (_, i) =>
      i === 1 ? { tool: "record_draft", status: "ok" } : { tool: "get_health", status: "ok" },
    ),
  });
  assert(
    advisorCap.status === "succeeded" && advisorCap.stopReason === "cap_after_findings",
    "the advisor cap after a draft is the analyst finish",
  );
  const jobSrc = read("supabase/functions/_shared/agent-core/job.ts");
  const reasonBody = jobSrc.slice(jobSrc.indexOf("reason: async"));
  assert(
    reasonBody.indexOf("runnerEarlyFinish") < reasonBody.indexOf("callClaudeRound"),
    "drafts finish before another model call",
  );
  assert(jobSrc.includes("config.costStopUsd"), "the cost stop is the agent's own line");

  for (const file of [
    "supabase/functions/agent-financial-manager/index.ts",
    "supabase/functions/agent-financial-manager/run.ts",
    "supabase/functions/agent-financial-manager/execute.ts",
    "supabase/functions/agent-advisor/index.ts",
    "supabase/functions/agent-advisor/run.ts",
    "supabase/functions/agent-advisor/execute.ts",
    "supabase/functions/_shared/agent-core/job.ts",
    "supabase/functions/_shared/agent-core/serve-runner.ts",
    "supabase/functions/_shared/agent-desk.ts",
  ]) {
    const src = read(file);
    assert(!src.includes("precard"), `${file} does not touch the pre-card allowance`);
    assert(!src.includes("increment_precard"), `${file} does not increment pre-card usage`);
  }
  assert(job.includes('from "./claude.ts"'), "the runner uses the shared model call");
  assert(job.includes("sanitizeAgentError"), "stored errors are scrubbed before they are kept");
}

// Prompts: books, not bank, no tax, drafts only, advisor never signs off.
{
  for (const prompt of [FINANCIAL_MANAGER_SYSTEM, ADVISOR_SYSTEM]) {
    assert(!/claude|anthropic/i.test(prompt), "prompt copy does not name the model vendor");
    assert(/books on file/i.test(prompt), "findings are books-based");
    assert(/not a bank/i.test(prompt) || /not bank-verified/i.test(prompt), "copy does not claim bank-verified cash");
    assert(prompt.includes("No tax"), "the runner does not give tax figures");
    assert(/drafts only/i.test(prompt), "writes are drafts");
    assert(/person approves/i.test(prompt), "a person approves before anything is sent");
  }
  assert(FINANCIAL_MANAGER_SYSTEM.includes("Milōn Financial Manager"), "the financial manager names itself");
  assert(ADVISOR_SYSTEM.includes("Milōn Advisor"), "the advisor names itself");
  assert(/signed off is accountant-only/i.test(ADVISOR_SYSTEM), "the advisor never signs off");
  assert(FINANCIAL_MANAGER_SYSTEM.includes("action_point_draft"), "the prompt names the action-point draft");
  for (const prompt of [FINANCIAL_MANAGER_SYSTEM, ADVISOR_SYSTEM]) {
    assert(prompt.includes("to_agent is a bot key"), "to_agent is a bot key");
    assert(prompt.includes("never the accountant or the owner"), "to_agent is never the accountant or the owner");
    assert(prompt.includes("draft=true"), "human approval is implied by draft=true");
  }
  const config = read("supabase/config.toml");
  assert(/\[functions\.agent-financial-manager\]\nverify_jwt = true/.test(config), "financial manager JWT is required");
  assert(/\[functions\.agent-advisor\]\nverify_jwt = true/.test(config), "advisor JWT is required");
  const serve = read("supabase/functions/_shared/agent-core/serve-runner.ts");
  assert(serve.includes('!== "service_role"'), "the runners are service-role only");
}

// The production rejection is normalised onto the default recipient.
{
  const REJECTION = "to_agent must be one of: analyst, advisor.";
  function legacyRejection(value: unknown, peers: readonly string[]): string | null {
    const ok = typeof value === "string" && peers.includes(value);
    return ok ? null : `to_agent must be one of: ${peers.join(", ")}.`;
  }
  for (const kind of FM_DRAFT_KINDS) {
    for (const bad of ["accountant", "owner", "financial_manager"]) {
      assert(legacyRejection(bad, FM_PEERS) === REJECTION, `${bad} is the production rejection`);
      const resolved = resolveDraftRecipient({
        agent: "financial_manager",
        kind,
        toAgent: bad,
        peers: FM_PEERS,
      });
      assert(resolved.toAgent === null, `${kind} with ${bad} has no bot recipient`);
      assert(resolved.normalised, `${kind} with ${bad} is normalised`);
    }
    const omitted = resolveDraftRecipient({
      agent: "financial_manager",
      kind,
      toAgent: undefined,
      peers: FM_PEERS,
    });
    assert(omitted.toAgent === null && !omitted.normalised, `${kind} with no to_agent stays with the person`);
  }
  const nextMove = resolveDraftRecipient({
    agent: "financial_manager",
    kind: "next_move_draft",
    toAgent: "owner",
    peers: FM_PEERS,
  });
  assert(legacyRejection("owner", FM_PEERS) === REJECTION, "a next move used the same rejection");
  assert(nextMove.toAgent === "advisor" && nextMove.normalised, "a financial manager next move defaults to the advisor");
  const kept = resolveDraftRecipient({
    agent: "financial_manager",
    kind: "action_point_draft",
    toAgent: "analyst",
    peers: FM_PEERS,
  });
  assert(kept.toAgent === "analyst" && !kept.normalised, "a valid bot key is kept");
  const advisorRejection = "to_agent must be one of: financial_manager, analyst.";
  for (const kind of ADVISOR_DRAFT_KINDS) {
    assert(legacyRejection("accountant", ADVISOR_PEERS) === advisorRejection, "the advisor rejection names its peers");
    assert(legacyRejection("advisor", ADVISOR_PEERS) === advisorRejection, "the advisor cannot message itself");
    const resolved = resolveDraftRecipient({
      agent: "advisor",
      kind,
      toAgent: "accountant",
      peers: ADVISOR_PEERS,
    });
    assert(resolved.toAgent === "financial_manager" && resolved.normalised, `${kind} defaults to the financial manager`);
  }
  const advisorOmit = resolveDraftRecipient({
    agent: "advisor",
    kind: "next_move_draft",
    toAgent: undefined,
    peers: ADVISOR_PEERS,
  });
  assert(advisorOmit.toAgent === "financial_manager" && !advisorOmit.normalised, "an omitted advisor recipient uses the default");
}

// A rejected tool call keeps a truncated copy of its arguments on the trace.
{
  const huge = "x".repeat(2000);
  const rejected = await runAgentLoop({
    objective: "Draft from the books on file.",
    audience: "accountant",
    maxIterations: 2,
    allowedTools: ["record_draft", "get_books_quality"],
    toolLabels: { record_draft: "Draft", get_books_quality: "Books" },
    reason: async (ctx) => {
      if (ctx.iteration === 1) {
        return {
          kind: "tool",
          name: "record_draft",
          args: { kind: "action_point_draft", to_agent: "accountant", detail: huge },
          why: "draft",
        };
      }
      return { kind: "tool", name: "get_books_quality", args: { period: "latest" }, why: "read" };
    },
    execute: async (name) =>
      name === "record_draft"
        ? { error: "to_agent must be one of: analyst, advisor." }
        : { empty: false, figures: { revenue: 100 } },
  });
  const draft = rejected.trace.find((step) => step.tool === "record_draft");
  const read = rejected.trace.find((step) => step.tool === "get_books_quality");
  assert(draft?.status === "error", "the rejected draft is an error step");
  assert(draft?.detail === "to_agent must be one of: analyst, advisor.", "the trace keeps the rejection");
  assert(typeof draft?.rejected_args === "string" && draft.rejected_args.includes("accountant"), "rejected arguments include to_agent");
  assert(draft.rejected_args.length <= REJECTED_TRACE_ARGS_MAX + 1, "rejected arguments are truncated");
  assert(!draft.rejected_args.includes(huge), "the long argument does not land in full");
  assert(read && !("args" in read) && !("rejected_args" in read), "a successful read keeps its arguments off the trace");
}

console.log("agent runners ok");
