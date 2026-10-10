/**
 * Analyst allow-list, retries, evidence, and the enqueue call sites.
 * No database and no model call.
 * Run: pnpm test:agent-analyst
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  attachCitedEvidence,
  canonicalEvidenceKey,
  citedFigureMatches,
  citedNumbers,
  figuresClose,
  groundFindingEvidence,
  isClientIdle,
  periodEndKey,
  periodEndsMentioned,
} from "../src/lib/agent-bus.ts";
import { priorActivityIso } from "../src/lib/agent-enqueue.ts";
import {
  ANALYST_MAX_ITERATIONS,
  ANALYST_TOOLS,
  analystFailurePlan,
  analystRunCostUsd,
  analystRunOutcome,
  analystRunSummary,
  analystToolAllowed,
  collectStoredReads,
  dataQualityComparesPeriods,
  dedupePeriodOf,
  evidenceKeysNote,
  canonicalComparableKey,
  executeAnalystGate,
  FINDING_KINDS,
  figureKeyOverlap,
  findingDuplicates,
  findingRecordKey,
  higherFindingSeverity,
  normalizeFindingKind,
  labelHealthScore,
  statementVariance,
} from "../src/lib/agent-analyst.ts";
import { scorecardHealthFromFinancials } from "../src/lib/health-score.ts";
import { figuresPeriodLabelFrom } from "../src/lib/statement-period.ts";
import { analystToolSchemas, ANALYST_SYSTEM } from "../supabase/functions/_shared/agent-prompts/analyst.ts";
import { classifyResult, formatAgentPrompt, runAgentLoop } from "../supabase/functions/_shared/agent-core/loop.ts";
import {
  promptCachePrefixCostFactor,
  shapeCachedModelRequest,
} from "../supabase/functions/_shared/agent-core/prompt-cache.ts";

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
  assert(executeSrc.includes("attachCitedEvidence"), "a cited stored number is attached instead of rejected");
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
  assert(ANALYST_MAX_ITERATIONS === 10, "the analyst loop stops at 10 iterations");
  assert(analystRunCostUsd(1_000_000, 1_000_000) === 12, "cost uses the Sonnet 5.5 $2 and $10 rates");
}

// record_finding.severity is the same enum execute.ts accepts, and a rejection
// is written into the next prompt so the model can correct the call.
{
  const finding = analystToolSchemas().find((tool) => tool.name === "record_finding");
  const props = (finding?.input_schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  assert(JSON.stringify(props.severity?.enum) === JSON.stringify(["info", "watch", "act"]), "severity enum is info, watch, act");
  assert(typeof props.severity?.description === "string" && String(props.severity.description).includes("watch"), "severity describes when to use each value");
  assert(JSON.stringify(props.kind?.enum) === JSON.stringify([...FINDING_KINDS]), "kind is the fixed finding enum");
  assert(props.title?.maxLength === 200, "title is capped at 200 characters");
  assert(props.detail?.minLength === 1, "detail cannot be empty");
  assert(props.detail?.maxLength === 2000, "detail is capped at 2000 characters");
  const required = finding?.input_schema.required as string[] | undefined;
  assert(required?.includes("detail"), "detail is required on record_finding");
  const figureShapes = (props.figures?.additionalProperties as { anyOf?: Array<{ type?: string }> } | undefined)?.anyOf;
  assert(figureShapes?.some((shape) => shape.type === "number"), "a flat figure value is a number");
  assert(figureShapes?.some((shape) => shape.type === "object"), "a period map is allowed inside figures");
  for (const kind of FINDING_KINDS) {
    assert(ANALYST_SYSTEM.includes(kind), `the system prompt names kind ${kind}`);
  }
  assert(ANALYST_SYSTEM.includes("evidence keys you may cite:"), "the prompt points at the evidence-key line");
  for (const word of ["info", "watch", "act"]) {
    assert(ANALYST_SYSTEM.includes(word), `the system prompt names severity ${word}`);
  }
  assert(ANALYST_SYSTEM.includes("No action is asked"), "info is a stored fact with no action");
  assert(ANALYST_SYSTEM.includes("looked at again"), "watch means look again");
  assert(ANALYST_SYSTEM.includes("need a decision soon"), "act means the figures need a decision");

  const rejection = "Severity must be info, watch, or act.";
  const classified = classifyResult("record_finding", { error: rejection, tool_blocked: true });
  assert(classified.detail === rejection, "a rejected finding keeps its error text");
  const prompts: string[] = [];
  await runAgentLoop({
    objective: "Review the books on file.",
    audience: "accountant",
    maxIterations: ANALYST_MAX_ITERATIONS,
    allowedTools: ["record_finding"],
    toolLabels: { record_finding: "Finding" },
    reason: async (ctx) => {
      prompts.push(formatAgentPrompt(ctx));
      if (ctx.iteration === 1) {
        return { kind: "tool", name: "record_finding", args: { severity: "high" }, why: "note a change" };
      }
      return { kind: "stop", reason: "no_further_action", summary: "Corrected after the error." };
    },
    execute: async () => ({ error: rejection, tool_blocked: true }),
  });
  assert(prompts.length >= 2, "a rejection does not end the loop");
  assert(prompts[1].includes(rejection), "the next turn includes the rejection text");
}

// Claimed figures match every read in the run, with a tight rounding tolerance.
{
  assert(figuresClose(43.8, 43.79), "43.8 matches 43.79 rounded to one place");
  assert(!figuresClose(43.8, 43.74), "43.8 does not match 43.74");
  assert(figuresClose(100, 100.4), "an integer matches a stored value that rounds to it within 0.5%");
  assert(!figuresClose(100, 100.6), "a 0.6% gap is outside the tolerance");
  assert(figuresClose(1.23456, 1.234564), "values equal at 4 decimal places match");
  assert(!figuresClose(0, 1), "zero matches only through the 4 decimal place check");
  assert(figuresClose(0, 0), "zero matches zero");

  const older = { snapshotId: "snap-aug", periodLabel: "Aug 2026", figures: { cash: 10, revenue: 80 } };
  const newer = { snapshotId: "snap-sep", periodLabel: "Sep 2026", figures: { debtor_days: 43.79, revenue: 100 } };
  const across = groundFindingEvidence({
    pool: [older, newer],
    claimedFigures: { cash: 10, debtor_days: 43.8 },
  });
  assert(across.ok === false, "a flat map that mixes two periods is rejected");
  if (!across.ok) {
    assert(across.error.includes("more than one period"), "the error says the figures span periods");
    assert(across.error.includes("Aug 2026") && across.error.includes("Sep 2026"), "the error names both periods");
    assert(!across.error.includes("snap-sep"), "the rejection does not stamp the later snapshot");
  }
  const structured = groundFindingEvidence({
    pool: [older, newer],
    claimedFigures: { "Aug 2026": { cash: 10 }, "Sep 2026": { debtor_days: 43.8 } },
  });
  assert(structured.ok === true, "the same numbers are accepted when each period has its own map");
  if (structured.ok) {
    assert(structured.evidence.snapshot_id === null, "mixed periods do not share one snapshot id");
    assert(structured.evidence.period_label === null, "mixed periods do not share one period label");
    const byPeriod = structured.evidence.figures as Record<string, Record<string, number>>;
    assert(byPeriod["Aug 2026"]?.cash === 10, "August keeps the stored cash");
    assert(byPeriod["Sep 2026"]?.debtor_days === 43.79, "September keeps the stored debtor days, not the rounded claim");
  }
  const most = groundFindingEvidence({
    pool: [older, newer],
    claimedFigures: { debtor_days: 43.8, revenue: 100 },
  });
  assert(most.ok === true, "a flat map from one period is accepted");
  if (most.ok) {
    assert(most.evidence.snapshot_id === "snap-sep", "that period's snapshot is the evidence row");
    const flat = most.evidence.figures as Record<string, number>;
    assert(flat.debtor_days === 43.79, "evidence keeps the stored number");
  }
  const rejected = groundFindingEvidence({
    pool: [older, newer],
    claimedFigures: { cash: 1, debtor_days: 43.8 },
  });
  assert(rejected.ok === false, "a key that matches no read rejects the finding");
  if (!rejected.ok) {
    assert(rejected.error.startsWith("The finding's figures do not match the books that were read."), "the error keeps the books sentence");
    assert(rejected.error.includes("Failed: cash=1"), "the error lists the failing key and value");
    assert(rejected.error.includes("Aug 2026: cash=10"), "the error lists an older read");
    assert(rejected.error.includes("Sep 2026: debtor_days=43.79"), "the error lists the later read");
  }

  const health = collectStoredReads(
    {
      overall: 48,
      period_label: "Sep 2026",
      snapshot_id: "snap-sep",
      pillars: [
        { id: "profit", label: "Profit", score: 70 },
        { id: "assets", label: "Assets", score: 60 },
        { id: "financing", label: "Financing", score: 50 },
        { id: "cash", label: "Cash", score: 55 },
      ],
    },
    { snapshotId: null, periodLabel: null },
  );
  assert(health.length === 1, "pillar scores join the health read for that period");
  assert(health[0]?.periodLabel === "Sep 2026", "the health read keeps its period");
  assert(health[0]?.figures["pillar:profit"] === 70 && health[0]?.figures["pillar:cash"] === 55, "pillar keys are pillar:<id>");
  const keyNote = evidenceKeysNote(health);
  assert(keyNote?.startsWith("evidence keys you may cite:"), "a read lists the keys the model may cite");
  assert(keyNote?.includes("pillar:profit") && keyNote?.includes("overall"), "the list is the keys on that read");
  assert(health[0]?.figures.overall === 48, "the overall score stays on the same read");

  const history = collectStoredReads(
    {
      scores: [
        { period_date: "2026-08-01", score: 40, is_estimated: false },
        { period_date: "2026-09-01", score: 48, is_estimated: true },
      ],
    },
    { snapshotId: null, periodLabel: null },
  );
  assert(history.length === 2, "each score-history period is its own read");
  assert(history[0]?.periodLabel === "2026-08-01", "a score read is keyed by period");
  assert(history[0]?.figures.score === 40, "the score value is stored");
  assert(history[0]?.figures["score:2026-08-01"] === 40, "the period key disambiguates the score");
  assert(history[1]?.figures["score:2026-09-01"] === 48, "the later period has its own key");

  const fromHistory = groundFindingEvidence({
    pool: history,
    claimedFigures: { "score:2026-08-01": 40 },
  });
  assert(fromHistory.ok === true, "a score claim matches the period it names");
  if (fromHistory.ok) assert(fromHistory.evidence.period_label === "2026-08-01", "the evidence period is the matching score row");

  const mixedScores = groundFindingEvidence({
    pool: history,
    claimedFigures: { "score:2026-08-01": 40, "score:2026-09-01": 48 },
  });
  assert(mixedScores.ok === false, "two score periods in one flat map are rejected");
  const nestedScores = groundFindingEvidence({
    pool: history,
    claimedFigures: { "2026-08-01": { score: 40 }, "2026-09-01": { score: 48 } },
  });
  assert(nestedScores.ok === true, "score periods filed under their labels are accepted");
  if (nestedScores.ok) assert(nestedScores.evidence.snapshot_id === null, "score history does not borrow a snapshot id");

  const statementHistory = collectStoredReads(
    {
      empty: false,
      periods: [
        {
          period_label: "Sep 2026",
          period_date: "2026-09-30",
          ratios: { "Debtor Days": 25, "Creditor Days": 37 },
        },
        {
          period_label: "Oct 2026",
          period_date: "2026-10-31",
          ratios: { "Debtor Days": 40, "Creditor Days": 50 },
        },
      ],
    },
    { snapshotId: null, periodLabel: null },
  );
  assert(statementHistory.length === 2, "each statement-history period is its own read");
  assert(statementHistory[0]?.periodLabel === "Sep 2026", "September history keeps its own period label");
  assert(
    statementHistory[0]?.figures["Debtor Days"] === 25 && statementHistory[0]?.figures["Creditor Days"] === 37,
    "September history keeps debtor days 25 and creditor days 37",
  );
  const sepHistory = groundFindingEvidence({
    pool: statementHistory,
    claimedFigures: { "Sep 2026": { debtor_days: 25, creditor_days: 37 } },
  });
  assert(sepHistory.ok === true, "September debtor and creditor days are citable under Sep 2026");
  if (sepHistory.ok) {
    assert(sepHistory.evidence.period_label === "Sep 2026", "the evidence period is Sep 2026");
    const byPeriod = sepHistory.evidence.figures as Record<string, Record<string, number>>;
    assert(byPeriod["Sep 2026"]?.["Debtor Days"] === 25, "evidence keeps September debtor days");
    assert(byPeriod["Sep 2026"]?.["Creditor Days"] === 37, "evidence keeps September creditor days");
  }
  const missingPeriod = groundFindingEvidence({
    pool: statementHistory,
    claimedFigures: { "Nov 2026": { debtor_days: 25 } },
  });
  assert(missingPeriod.ok === false, "a period the history did not return is still rejected");
  if (!missingPeriod.ok) {
    assert(missingPeriod.error.includes("No stored read is labeled Nov 2026"), "the error names the missing period");
    assert(missingPeriod.error.includes("Sep 2026"), "the error lists September as available");
  }

  const aliasKeys = new Set(["score:2026-10-05", "pillar:profit", "Debtor Days"]);
  assert(canonicalEvidenceKey("score_2026-10-05", aliasKeys) === "score:2026-10-05", "score_date aliases to score:date");
  assert(canonicalEvidenceKey("profit_pillar_score", aliasKeys) === "pillar:profit", "profit_pillar_score aliases to pillar:profit");
  assert(canonicalEvidenceKey("debtor_days", aliasKeys) === "Debtor Days", "a snake_case ratio aliases to the stored label");
  const bothSpellings = new Set(["debtor_days", "Debtor Days", "creditor_days", "Creditor Days"]);
  assert(
    canonicalEvidenceKey("debtor_days", bothSpellings) === "Debtor Days",
    "the display label wins when the pool has both spellings",
  );
  const sepDays = {
    snapshotId: "snap-sep",
    periodLabel: "Sep 2026",
    figures: { "Debtor Days": 25, "Creditor Days": 37 },
  };
  const octDays = {
    snapshotId: "snap-oct",
    periodLabel: "Oct 2026",
    figures: { debtor_days: 25, creditor_days: 37 },
  };
  const aliasedMix = groundFindingEvidence({
    pool: [sepDays, octDays],
    claimedFigures: { debtor_days: 25, creditor_days: 37 },
  });
  assert(aliasedMix.ok === false, "alias keys do not hide a second period that holds the same figures");
  if (!aliasedMix.ok) {
    assert(aliasedMix.error.includes("more than one period"), "the alias mix asks for one map per period");
    assert(!aliasedMix.error.includes("snap-oct"), "the alias mix does not stamp the October snapshot");
  }
  const sepOnly = groundFindingEvidence({
    pool: [sepDays, { ...octDays, figures: { debtor_days: 40, creditor_days: 50 } }],
    claimedFigures: { debtor_days: 25, creditor_days: 37 },
  });
  assert(sepOnly.ok === true, "September's display keys match a snake_case claim");
  if (sepOnly.ok) {
    assert(sepOnly.evidence.snapshot_id === "snap-sep", "the matching period is September, not the later snapshot");
    const stored = sepOnly.evidence.figures as Record<string, number>;
    assert(stored["Debtor Days"] === 25 && stored["Creditor Days"] === 37, "evidence keeps the display keys");
  }
  const aliased = groundFindingEvidence({
    pool: [{ snapshotId: "snap-oct", periodLabel: "Oct 2026", figures: { "score:2026-10-05": 78, "pillar:profit": 70 } }],
    claimedFigures: { score_2026_10_05: 78, profit_pillar_score: 70 },
  });
  assert(aliased.ok === true, "aliased keys match the stored keys");
  if (aliased.ok) {
    const stored = aliased.evidence.figures as Record<string, number>;
    assert(stored["score:2026-10-05"] === 78 && stored["pillar:profit"] === 70, "evidence stores the canonical keys");
    assert(aliased.evidence.snapshot_id === "snap-oct", "one period keeps its snapshot");
  }
}

// A recorded finding is not pooled again, and its arguments land on the trace.
{
  const executeSrc = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
  const runSrc = readFileSync(resolve("supabase/functions/agent-analyst/run.ts"), "utf8");
  assert(!executeSrc.includes("ctx.pool.push"), "record_finding does not add its own evidence to the pool");
  assert(runSrc.includes("collectStoredReads"), "score history and pillar scores enter the pool");
  assert(runSrc.includes('name !== "record_finding"'), "the run skips pooling a recorded finding");
  assert(runSrc.includes("cachePrompt: true"), "analyst runs cache the system prompt and the tools");
  assert(runSrc.includes("cache_write_tokens"), "cache writes are stored on the run");
  assert(runSrc.includes("cache_read_tokens"), "cache reads are stored on the run");

  const traced = await runAgentLoop({
    objective: "Review the books on file.",
    audience: "accountant",
    maxIterations: 4,
    allowedTools: ["get_health", "record_finding"],
    toolLabels: { get_health: "Health", record_finding: "Finding" },
    reason: async (ctx) => {
      if (ctx.iteration === 1) return { kind: "tool", name: "get_health", args: {}, why: "read health" };
      if (ctx.iteration === 2) {
        return {
          kind: "tool",
          name: "record_finding",
          args: { kind: "cash", severity: "watch", title: "Cash on file is 40", figures: { cash: 40 } },
          why: "record the cash figure",
        };
      }
      return { kind: "stop", reason: "no_further_action", summary: "Review stored." };
    },
    execute: async (name) => (name === "get_health" ? { overall: 48, cash: 40 } : { recorded: true }),
  });
  assert(traced.trace[0]?.tool === "get_health" && !("args" in traced.trace[0]), "a read trace has no args key");
  assert(traced.trace[1]?.tool === "record_finding", "the finding is on the trace");
  const findingArgs = traced.trace[1]?.args as { figures?: { cash?: number } } | undefined;
  assert(findingArgs?.figures?.cash === 40, "the trace records the record_finding arguments");
}

// Prompt caching is opt-in. Milonbot's request stays uncached.
{
  const tools = [
    { name: "get_health", description: "Health", input_schema: { type: "object" } },
    { name: "finish", description: "Stop", input_schema: { type: "object" } },
  ];
  const off = shapeCachedModelRequest({ system: "Review the books.", tools, cachePrompt: false });
  assert(off.system === "Review the books.", "an uncached call keeps the system prompt as a string");
  assert(off.tools === tools, "an uncached call keeps the tool array unchanged");
  assert(!("betaHeader" in off), "an uncached call adds no cache header");
  assert(!JSON.stringify(off.tools).includes("cache_control"), "uncached tools have no cache_control");

  const on = shapeCachedModelRequest({ system: "Review the books.", tools, cachePrompt: true });
  assert(Array.isArray(on.system), "a cached call sends the system prompt as a content block");
  const block = Array.isArray(on.system) ? on.system[0] : null;
  assert(block?.cache_control.type === "ephemeral", "the system block is marked ephemeral");
  assert(on.tools[0] && !("cache_control" in on.tools[0]), "only the last tool carries cache_control");
  assert(
    (on.tools[1] as { cache_control?: { type?: string } }).cache_control?.type === "ephemeral",
    "the last tool is marked ephemeral",
  );
  assert(!("betaHeader" in on), "caching does not send the legacy prompt-caching beta header");
  assert(on.tools !== tools, "caching does not mutate the caller's tool list");

  const turns = ANALYST_MAX_ITERATIONS;
  const prefix = promptCachePrefixCostFactor(turns);
  assert(
    Math.abs(prefix - (1.25 + 0.05 * (turns - 1)) / turns) < 1e-12,
    "the cached prefix writes once at 1.25x then reads at 0.05x",
  );
  assert(prefix < 0.25, "a 10-turn cached prefix costs under a quarter of paying the input rate every turn");
  assert(ANALYST_SYSTEM.length / 4 >= 512, "the analyst system prompt clears the 512-token Sonnet 5.5 cache minimum");
  assert(analystRunCostUsd(1_000_000, 1_000_000) === 12, "uncached input and output use Sonnet 5.5 $2 and $10");
  assert(analystRunCostUsd(0, 0, 1_000_000, 0) === 2.5, "a million 5-minute cache-write tokens cost $2.50");
  assert(analystRunCostUsd(0, 0, 0, 1_000_000) === 0.1, "a million cache-read tokens cost $0.10");
  assert(
    analystRunCostUsd(1_000_000, 1_000_000, 0, 0, "claude-sonnet-4-6") === 18,
    "Sonnet 4.6 input and output stay $3 and $15",
  );
  assert(
    analystRunCostUsd(0, 0, 1_000_000, 0, "claude-sonnet-4-6") === 3.75,
    "Sonnet 4.6 cache writes stay $3.75",
  );
  assert(
    analystRunCostUsd(0, 0, 0, 1_000_000, "claude-sonnet-4-6") === 0.3,
    "Sonnet 4.6 cache reads stay $0.30",
  );

  const claudeSrc = readFileSync(resolve("supabase/functions/milon-bot/claude.ts"), "utf8");
  const handlerSrc = readFileSync(resolve("supabase/functions/milon-bot/handler.ts"), "utf8");
  const indexSrc = readFileSync(resolve("supabase/functions/milon-bot/index.ts"), "utf8");
  assert(claudeSrc.includes("shapeCachedModelRequest"), "the model call shapes cache markers through the shared helper");
  assert(claudeSrc.includes("opts?.cachePrompt === true"), "cache markers are added only when cachePrompt is set");
  assert(!claudeSrc.includes("prompt-caching-2024-07-31"), "the model call does not send the legacy cache beta header");
  assert(!claudeSrc.includes("anthropic-beta"), "the model call does not set an anthropic-beta header");
  assert(!handlerSrc.includes("cachePrompt"), "milon-bot chat does not opt into prompt caching");
  assert(!indexSrc.includes("cachePrompt"), "the milon-bot entrypoint does not opt into prompt caching");
  assert(
    ANALYST_SYSTEM.includes("cash conversion cycle"),
    "the prompt names cash conversion cycle as a figure that must come from a tool",
  );
  assert(
    ANALYST_SYSTEM.includes("Do not add, subtract, or multiply tool results into a new figure for the title."),
    "the prompt forbids derived arithmetic in titles",
  );
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
  const invoke = readFileSync(
    resolve("supabase/migrations/20261010233000_agent_invoke_timeout.sql"),
    "utf8",
  );
  assert(invoke.includes("timeout_milliseconds := 60000"), "agent_invoke waits 60 seconds");
  assert(invoke.includes("CREATE OR REPLACE FUNCTION public.agent_invoke(p_function text, p_body jsonb)"), "agent_invoke keeps its signature");

  const promptFiles = readdirSync(resolve("supabase/functions/_shared/agent-prompts"));
  assert(promptFiles.includes("analyst.ts"), "the analyst prompt file is in place");
}

// A capped review that already saved a finding succeeds. A cap with none stays partial.
{
  const capped = await runAgentLoop({
    objective: "Review the books on file.",
    audience: "accountant",
    maxIterations: 2,
    allowedTools: ["get_health", "record_finding"],
    toolLabels: { get_health: "Health", record_finding: "Finding" },
    reason: async (ctx) => {
      if (ctx.iteration === 1) {
        return {
          kind: "tool",
          name: "record_finding",
          args: { kind: "health", severity: "info", title: "Stored health is 69", figures: { overall: 69 } },
          why: "record",
        };
      }
      return { kind: "tool", name: "get_health", args: {}, why: "one more read" };
    },
    execute: async (name) => (name === "record_finding" ? { recorded: true } : { overall: 69 }),
  });
  assert(capped.status === "safety_limit", "the shared loop still stops at its cap");
  const done = analystRunOutcome({
    stopReason: capped.status,
    steps: capped.trace.map((step) => ({ tool: step.tool, status: step.status })),
    maxIterations: 2,
  });
  assert(done.status === "succeeded" && done.stopReason === "cap_after_findings", "a cap after a finding is succeeded");
  const capSummary = analystRunSummary({
    stopReason: done.stopReason,
    summary: capped.summary,
  });
  assert(capSummary.includes("recorded its findings"), "a finished cap says the review recorded findings");
  assert(!capSummary.includes("Stopped at the iteration limit"), "a succeeded cap does not keep the iteration-limit sentence");
  const partialSummary = analystRunSummary({
    stopReason: "safety_limit",
    summary: "Stopped at the iteration limit before the objective was closed.",
  });
  assert(
    partialSummary === "Stopped at the iteration limit before the objective was closed.",
    "a real safety stop keeps the loop summary",
  );
  const dedupedClass = classifyResult("record_finding", { recorded: true, deduped: true, finding_id: "abc" });
  assert(dedupedClass.status === "ok", "a deduped finding is an accepted step");
  const dedupedCap = analystRunOutcome({
    stopReason: "safety_limit",
    steps: [
      { tool: "record_finding", status: dedupedClass.status },
      { tool: "get_health", status: "ok" },
    ],
    maxIterations: 2,
  });
  assert(
    dedupedCap.status === "succeeded" && dedupedCap.stopReason === "cap_after_findings",
    "a deduped finding counts toward the cap",
  );
  const empty = analystRunOutcome({
    stopReason: "safety_limit",
    steps: Array.from({ length: 10 }, () => ({ tool: "get_health", status: "ok" })),
    maxIterations: 10,
  });
  assert(empty.status === "partial" && empty.stopReason === "safety_limit", "a cap with no finding stays partial");
  const early = analystRunOutcome({
    stopReason: "safety_limit",
    steps: [{ tool: "record_finding", status: "ok" }],
    maxIterations: 10,
  });
  assert(early.status === "partial", "a safety stop before the cap stays partial");
  const runSrc = readFileSync(resolve("supabase/functions/agent-analyst/run.ts"), "utf8");
  assert(runSrc.includes("analystRunOutcome"), "the analyst run uses the cap outcome");
  assert(runSrc.includes("analystRunSummary"), "the analyst run replaces the cap summary");
  assert(runSrc.includes("evidence_keys_note"), "each read result lists the evidence keys");
  const loopSrc = readFileSync(resolve("supabase/functions/_shared/agent-core/loop.ts"), "utf8");
  assert(
    loopSrc.includes("Stopped at the iteration limit before the objective was closed."),
    "the shared loop summary is unchanged",
  );
}

// A repeated finding refreshes last_seen. Same kind and period, or 60% figure overlap, inside 7 days.
{
  const now = Date.parse("2026-10-10T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const recent = [
    {
      id: "old",
      kind: "score_decline",
      figures: { overall: 69 },
      seenAtMs: now - 8 * day,
      periodLabel: "2026-10-06",
      snapshotId: null,
      severity: "watch",
    },
    {
      id: "fresh",
      kind: "score_decline",
      figures: { overall: 69 },
      seenAtMs: now - day,
      periodLabel: "2026-10-06",
      snapshotId: null,
      severity: "info",
    },
  ];
  const byKind = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "score_decline",
      figures: { cash: 10 },
      periodLabel: "2026-10-06",
      snapshotId: null,
    },
    recent,
  });
  assert(byKind?.id === "fresh", "the same kind and period inside 7 days matches even when the title and figures differ");
  const wide = {
    id: "wide",
    kind: "other",
    figures: { a: 1, b: 2, c: 3, d: 4, e: 5 },
    seenAtMs: now - day,
    periodLabel: "Sep 2026",
    snapshotId: "snap-sep",
    severity: "watch",
  };
  assert(
    figureKeyOverlap({ a: 1, b: 2, c: 3, x: 9, y: 8 }, wide.figures) === 0.6,
    "three shared keys out of five is 60 percent",
  );
  const byOverlap = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "liquidity",
      figures: { a: 1, b: 2, c: 3, x: 9, y: 8 },
      periodLabel: "Oct 2026",
      snapshotId: "snap-oct",
    },
    recent: [wide],
  });
  assert(byOverlap == null, "a different kind is not a duplicate even when 60 percent of the figures match");
  const sameKindOverlap = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "other",
      figures: { a: 1, b: 2, c: 3, x: 9, y: 8 },
      periodLabel: "Oct 2026",
      snapshotId: "snap-oct",
    },
    recent: [wide],
  });
  assert(sameKindOverlap?.id === "wide", "a 60 percent overlap of the same kind still matches");
  const thin = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "liquidity",
      figures: { a: 1, b: 2, z: 0, x: 9, y: 8 },
      periodLabel: "Oct 2026",
      snapshotId: "snap-oct",
    },
    recent: [wide],
  });
  assert(thin == null, "a 40 percent overlap is not a duplicate");
  const otherKind = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "liquidity",
      figures: { cash: 10 },
      periodLabel: "2026-10-06",
      snapshotId: null,
    },
    recent,
  });
  assert(otherKind == null, "a different kind on the same period is not a duplicate without figure overlap");
  const stale = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "score_decline",
      figures: { overall: 69 },
      periodLabel: "2026-10-06",
      snapshotId: null,
    },
    recent: [recent[0]],
  });
  assert(stale == null, "a finding last seen 8 days ago is not a duplicate");
  const again = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "score_decline",
      figures: { overall: 69 },
      periodLabel: "2026-10-06",
      snapshotId: null,
    },
    recent,
  });
  assert(again?.id === byKind?.id, "matching the same row twice is idempotent");
  assert(higherFindingSeverity("info", "watch") === "watch", "watch replaces info");
  assert(higherFindingSeverity("watch", "act") === "act", "act replaces watch");
  assert(higherFindingSeverity("act", "info") === null, "a lower severity does not replace a higher one");
  assert(higherFindingSeverity("watch", "watch") === null, "the same severity stays");
  const executeSrc = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
  assert(executeSrc.includes("deduped: true"), "a duplicate is reported as already recorded");
  assert(executeSrc.includes("last_seen"), "a duplicate updates last_seen");
  assert(executeSrc.includes("higherFindingSeverity"), "a duplicate raises severity when the new one is higher");
  assert(executeSrc.includes("findingKindAllowed"), "kind is checked against the enum");
  assert(
    executeSrc.indexOf("deduped: true") < executeSrc.indexOf('type: "finding"'),
    "a duplicate does not send another finding message",
  );
  const migration = readFileSync(
    resolve("supabase/migrations/20261011001000_agent_findings_last_seen.sql"),
    "utf8",
  );
  assert(migration.includes("ADD COLUMN IF NOT EXISTS last_seen"), "last_seen is added in place");
  assert(migration.includes("agent_findings_recent_idx"), "recent findings are indexed by client, agent, and last_seen");
  assert(
    !readFileSync(resolve("supabase/migrations/20261010160000_agent_foundation.sql"), "utf8").includes("last_seen"),
    "the applied foundation migration is unchanged",
  );
  const collapse = readFileSync(
    resolve("supabase/migrations/20261011030000_agent_findings_collapse_duplicates.sql"),
    "utf8",
  );
  for (const id of [
    "69471b80-7e6d-4ec8-b96c-a59b16fb9fce",
    "c0be29bb-8d51-47f9-a201-32a6ac1a2a2f",
    "171506a0-f4c0-46c0-896e-d090dba9d6a1",
    "e3f97ba0-a718-4bcb-b7b1-2346877fa6db",
  ]) {
    assert(collapse.includes(id), `the cleanup names ${id}`);
  }
  assert(collapse.includes("superseded_by IS NULL"), "a second run does not supersede a row twice");
  assert(collapse.includes("GREATEST(keeper.last_seen, dup.last_seen)"), "the keeper last_seen moves forward");
  assert(collapse.includes("2faf551f-a965-40b4-b250-10cf47705457"), "the signup working-capital finding is documented");
  const collapseCode = collapse.replace(/--[^\n]*/g, "");
  assert(!collapseCode.includes("2faf551f"), "the signup working-capital finding is not superseded");

  assert(
    normalizeFindingKind("Profit Drivers – weakest health pillar") === "weakest_pillar",
    "a free-text weakest-pillar kind matches the enum",
  );
  assert(
    normalizeFindingKind("Creditor Days vs Debtor Days") === "working_capital_days",
    "a free-text debtor and creditor kind matches working capital",
  );
  assert(canonicalComparableKey("profit", 58, "Sep 2026") === "pillar:profit", "a legacy profit score matches pillar:profit");
  assert(
    canonicalComparableKey("Oct 2026|Debtor Days", 43.8, null) === "Debtor Days",
    "a per-period debtor days key matches the flat label",
  );
  assert(canonicalComparableKey("cash", 128450, "Sep 2026") === "cash", "a cash balance is not relabelled as a pillar");
  const legacyPillar = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "weakest_pillar",
      figures: { "pillar:profit": 58, overall: 75 },
      periodLabel: "Sep 2026",
      snapshotId: "snap-sep",
    },
    recent: [
      {
        id: "legacy-pillar",
        kind: "Profit Drivers – weakest health pillar",
        figures: { profit: 58, overall: 75, net_margin: 0.09 },
        seenAtMs: now - day,
        periodLabel: "Sep 2026",
        snapshotId: "snap-sep",
        severity: "watch",
      },
    ],
  });
  assert(legacyPillar?.id === "legacy-pillar", "a new weakest_pillar finding matches the legacy profit row for that period");
  const legacyDays = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "working_capital_days",
      figures: { "Oct 2026": { "Debtor Days": 43.8, "Creditor Days": 73 } },
      periodLabel: "Oct 2026",
      snapshotId: "snap-oct",
    },
    recent: [
      {
        id: "legacy-days",
        kind: "Creditor Days vs Debtor Days",
        figures: { "Debtor Days": 43.8, "Creditor Days": 73, "Gross Margin": 0.6, "Operating Margin": 0.16 },
        seenAtMs: now - day,
        periodLabel: "Oct 2026",
        snapshotId: "snap-oct",
        severity: "watch",
      },
    ],
  });
  assert(legacyDays?.id === "legacy-days", "flat Debtor Days on a period match the nested working-capital finding");

  assert(
    dedupePeriodOf({
      periodLabel: null,
      figures: { "Sep 2026": { "pillar:profit": 58 }, "2026-10-08": { "score:2026-10-08": 71 } },
    }) === "Sep 2026",
    "a nested statement period is kept and a score-history date is not",
  );
  assert(
    dedupePeriodOf({
      periodLabel: null,
      figures: { "Sep 2026": { "pillar:profit": 58 }, "Oct 2026": { "pillar:profit": 60 } },
    }) === null,
    "two statement periods are not collapsed to one",
  );
  const nestedPillar = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "weakest_pillar",
      figures: { "Sep 2026": { "pillar:profit": 58 }, "2026-10-08": { "score:2026-10-08": 71 } },
      periodLabel: null,
      snapshotId: null,
    },
    recent: [
      {
        id: "69471b80",
        kind: "weakest_pillar",
        figures: { profit: 58 },
        seenAtMs: now - day,
        periodLabel: "Sep 2026",
        snapshotId: "snap-sep",
        severity: "watch",
      },
    ],
  });
  assert(
    nestedPillar?.id === "69471b80",
    "a nested Sep 2026 profit pillar matches the keeper even when period_label is null",
  );
  assert(periodEndKey("1 Jan 2026 – 30 Sep 2026") === "2026-09", "a statement range ends in September 2026");
  assert(periodEndKey("Sep 2026") === "2026-09", "a month stamp is that month");
  assert(periodEndKey("1 Oct 2025 – 30 Sep 2026") === "2026-09", "a year spanning into September ends in September");
  assert(
    periodEndsMentioned("1 Oct 2025 – 30 Sep 2026 compared with Oct 2026").size === 2,
    "a range plus another month is two period ends",
  );
  const longRange = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "weakest_pillar",
      figures: { "pillar:profit": 58 },
      periodLabel: "1 Jan 2026 – 30 Sep 2026",
      snapshotId: null,
    },
    recent: [
      {
        id: "69471b80",
        kind: "weakest_pillar",
        figures: { profit: 58 },
        seenAtMs: now - day,
        periodLabel: "Sep 2026",
        snapshotId: "snap-sep",
        severity: "watch",
      },
    ],
  });
  assert(longRange?.id === "69471b80", "the long health range matches the September keeper");
  const sharedEnd = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "weakest_pillar",
      figures: { "Sep 2026": { "pillar:profit": 58 }, "Oct 2026": { "pillar:profit": 60 } },
      periodLabel: null,
      snapshotId: null,
    },
    recent: [
      {
        id: "69471b80",
        kind: "weakest_pillar",
        figures: { profit: 58 },
        seenAtMs: now - day,
        periodLabel: "Sep 2026",
        snapshotId: "snap-sep",
        severity: "watch",
      },
    ],
  });
  assert(sharedEnd?.id === "69471b80", "a multi-period finding matches on the shared September end");
  const crossKind = findingDuplicates({
    nowMs: now,
    candidate: {
      kind: "weakest_pillar",
      figures: { "pillar:profit": 50 },
      periodLabel: "1 Oct 2025 – 30 Sep 2026",
      snapshotId: null,
    },
    recent: [
      {
        id: "9e99e9e8",
        kind: "data_quality",
        figures: { "pillar:profit": 50 },
        seenAtMs: now - day,
        periodLabel: "Sep 2026",
        snapshotId: null,
        severity: "watch",
      },
      {
        id: "8556e68f",
        kind: "weakest_pillar",
        figures: { profit: 50 },
        seenAtMs: now - 2 * day,
        periodLabel: "Sep 2026",
        snapshotId: "snap-sep",
        severity: "watch",
      },
    ],
  });
  assert(crossKind?.id === "8556e68f", "weakest pillar matches its keeper and not the data-quality row");
  assert(
    dataQualityComparesPeriods({
      title: "Sep 2026 debtor days disagree with Oct 2026",
      detail: "The labels do not match.",
      figures: { debtor_days: 25 },
    }),
    "naming two periods is not a data-quality conflict",
  );
  assert(
    !dataQualityComparesPeriods({
      title: "Assets do not equal liabilities plus equity",
      detail: "The September books do not balance.",
      figures: { totalAssets: 10, equity: 4 },
    }),
    "one period can still be a data-quality finding",
  );

  const legacySql = readFileSync(
    resolve("supabase/migrations/20261011040000_agent_findings_legacy_normalize.sql"),
    "utf8",
  );
  for (const id of [
    "69471b80-7e6d-4ec8-b96c-a59b16fb9fce",
    "c5dce3e6-1230-455f-b211-6ae400886f76",
    "cd3cfbb4-d97f-46ba-962c-8573d8184656",
    "032eaf02-ea42-4f2b-bd70-872543b1e759",
  ]) {
    assert(legacySql.includes(id), `the legacy cleanup names ${id}`);
  }
  assert(legacySql.includes("pillar:"), "legacy pillar ids are stored as pillar: keys");
  assert(legacySql.includes("jsonb_build_object"), "flat figures are nested under the period label");
  assert(legacySql.includes("superseded_by IS NULL"), "the legacy cleanup does not supersede a row twice");
  assert(legacySql.includes("GREATEST(keeper.last_seen, dup.last_seen)"), "the legacy keeper last_seen moves forward");
  assert(legacySql.includes("2faf551f-a965-40b4-b250-10cf47705457"), "the signup working-capital finding is documented again");
  const legacyCode = legacySql.replace(/--[^\n]*/g, "");
  assert(!legacyCode.includes("2faf551f"), "the signup working-capital finding is not superseded by the legacy cleanup");

  const nested = readFileSync(
    resolve("supabase/migrations/20261011150000_agent_findings_nested_period_dedupe.sql"),
    "utf8",
  );
  assert(nested.includes("69471b80-7e6d-4ec8-b96c-a59b16fb9fce"), "the nested cleanup names the keeper");
  assert(nested.includes("42d2fad5-"), "the nested cleanup names the Signup duplicate");
  assert(nested.includes("superseded_by IS NULL"), "a second run does not supersede the nested row twice");
  assert(nested.includes("GREATEST(keeper.last_seen, dup.last_seen)"), "the nested keeper last_seen moves forward");
  assert(nested.includes("cfaa8b3d-") && nested.includes("7c147e88-"), "the null recipients are named");
  assert(nested.includes("to_agent = 'financial_manager'"), "those messages are addressed to the financial manager");
  assert(nested.includes("to_agent IS NULL"), "a second run does not rewrite a recipient that is already set");

  const periodCleanup = readFileSync(
    resolve("supabase/migrations/20261011210000_agent_findings_period_label_cleanup.sql"),
    "utf8",
  );
  assert(periodCleanup.includes("69471b80-7e6d-4ec8-b96c-a59b16fb9fce"), "the period cleanup names the September keeper");
  assert(periodCleanup.includes("b456deb8-"), "the period cleanup names the long-range duplicate");
  assert(periodCleanup.includes("8556e68f-"), "the period cleanup names the weakest-pillar keeper");
  assert(periodCleanup.includes("9e99e9e8-") && periodCleanup.includes("10464c39-"), "the labelling artefacts are named");
  assert(periodCleanup.includes("superseded_by IS NULL"), "a second run does not supersede a row twice");
  assert(periodCleanup.includes("GREATEST(keeper.last_seen, dup.last_seen)"), "the true duplicate moves last_seen forward");
  const periodCode = periodCleanup.replace(/--[^\n]*/g, "");
  assert(!periodCode.includes("982d09f0"), "the genuine finding is not superseded");

  const recipients = readFileSync(
    resolve("supabase/migrations/20261011180000_agent_messages_analyst_recipient.sql"),
    "utf8",
  );
  assert(recipients.includes("to_agent = 'financial_manager'"), "older analyst findings are addressed to the financial manager");
  assert(recipients.includes("from_agent = 'analyst'"), "only analyst messages are backfilled");
  assert(recipients.includes("type = 'finding'"), "only finding messages are backfilled");
  assert(recipients.includes("to_agent IS NULL"), "a second run does not rewrite a recipient that is already set");
  const recipientCode = recipients.replace(/--[^\n]*/g, "");
  assert(
    !recipientCode.includes("cfaa8b3d") && !recipientCode.includes("7c147e88"),
    "the remaining null recipients are not limited to the two already named",
  );
  const executeSrcForDetail = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
  assert(executeSrcForDetail.includes("A finding needs a detail."), "an empty detail is refused");
  assert(executeSrcForDetail.includes('to_agent: "financial_manager"'), "a new finding is addressed to the financial manager");
  assert(!executeSrcForDetail.includes("to_agent: null"), "a new finding does not leave the recipient empty");
}

// A stored number in the title is attached from the read. A number no read returned is refused.
{
  const pool = [
    { snapshotId: null, periodLabel: "2026-10-05", figures: { score: 78, "score:2026-10-05": 78 } },
    { snapshotId: null, periodLabel: "2026-10-06", figures: { score: 69, "score:2026-10-06": 69 } },
  ];
  const one = attachCitedEvidence({
    title: "Health dropped from 78 to 69",
    detail: "",
    pool,
    evidence: { snapshot_id: null, period_label: "2026-10-06", figures: { score: 69 } },
  });
  assert(one.ok === true, "a cited score that was read is attached instead of rejected");
  if (one.ok) {
    const byPeriod = one.evidence.figures as Record<string, Record<string, number>>;
    assert(one.evidence.snapshot_id === null, "two score periods do not share one snapshot");
    assert(byPeriod["2026-10-05"]?.["score:2026-10-05"] === 78, "78 is attached with its period key");
    assert(byPeriod["2026-10-06"]?.["score:2026-10-06"] === 69, "69 is attached with its period key");
  }
  const invented = attachCitedEvidence({
    title: "The cash conversion cycle is 33 days",
    detail: "",
    pool,
    evidence: { snapshot_id: null, period_label: "2026-10-06", figures: { "score:2026-10-06": 69 } },
  });
  assert(invented.ok === false, "a cited number that no read returned is refused");
  if (!invented.ok) {
    assert(invented.error.includes("33"), "the error names the number that was not read");
    assert(!invented.error.includes("figures do not include it"), "a stored number is not rejected for being left out of figures");
  }
  const stamped = groundFindingEvidence({
    pool: [{ snapshotId: "snap-oct", periodLabel: "Oct 2026", figures: { "Debtor Days": 43.79 } }],
    claimedFigures: { "Debtor Days": 43.8, snapshot_id: "snap-oct", period_label: "Oct 2026" },
  });
  assert(stamped.ok === true, "snapshot_id inside figures does not reject the finding");
  if (stamped.ok) {
    const flat = stamped.evidence.figures as Record<string, number>;
    assert(flat["Debtor Days"] === 43.79, "the stored debtor days stay");
    assert(flat.snapshot_id == null && flat.period_label == null, "snapshot_id and period_label are not figure keys");
    assert(stamped.evidence.snapshot_id === "snap-oct", "the snapshot id moves to the evidence row");
    assert(stamped.evidence.period_label === "Oct 2026", "the period label stays on the evidence row");
  }
  assert(
    ANALYST_SYSTEM.includes("both scores and both periods"),
    "the prompt tells the model to carry both scores and both periods",
  );
  assert(ANALYST_SYSTEM.includes("Do not put snapshot_id or period_label inside figures."), "the prompt keeps snapshot ids out of figures");
  assert(
    ANALYST_SYSTEM.includes("Do not put snapshot ids or other ids in the title or detail."),
    "the prompt keeps ids out of the title and detail",
  );
  assert(ANALYST_SYSTEM.includes("call finish"), "the prompt says to finish after a finding is recorded");

  assert(
    citedFigureMatches(0.5849, 4, 0.5849514537921812),
    "0.5849 matches a stored margin truncated to four places",
  );
  assert(citedFigureMatches(46, 0, 0.4587378668612735), "46 matches the percent form of 0.4587");
  assert(!citedFigureMatches(33, 0, 0.4587378668612735), "33 does not match that ratio");
  assert(citedNumbers("e806dc36-8e43-4324-a28c-c5d5fa66a240 Sep 2026").length === 0, "a snapshot id and a period label contribute no cited numbers");
  for (const date of [
    "2026-09-30",
    "2026-09-30T00:00:00Z",
    "2026-09-30T00:00:00.000Z",
    "30 Sep 2026",
    "30th September 2026",
    "Sep 30, 2026",
    "September 30, 2026",
    "Sep 30",
    "30 Sep",
    "1 Jan 2026 – 30 Sep 2026",
    "09/30/2026",
    "30/09/2026",
  ]) {
    assert(citedNumbers(date).length === 0, `${date} contributes no cited numbers`);
  }
  assert(citedNumbers("Debtor days are 25 as of 30 Sep 2026").map((n) => n.value).join(",") === "25", "a date beside a real figure leaves only that figure");
  assert(citedNumbers("Cash is 30").map((n) => n.value).join(",") === "30", "a bare 30 is still a cited number");
  assert(
    citedNumbers("Debtor days: 25 (peer median 40 days). Creditor days: 37 (healthy band 30–60 days).").map((n) => n.value).join(",") === "25,37",
    "peer-median and healthy-band day numbers are not citations",
  );
  assert(citedNumbers("1 Oct 2025 – 30 Sep 2026").length === 0, "a derived period range contributes no cited numbers");
  assert(citedNumbers("Revenue is R412k").map((n) => n.value).join(",") === "412000", "R412k is four hundred and twelve thousand");
  assert(citedNumbers("Revenue is $0.4m").map((n) => n.value).join(",") === "400000", "$0.4m is four hundred thousand");
  assert(citedNumbers("Revenue is 412,350").map((n) => n.value).join(",") === "412350", "a thousands separator is one number");
  assert(citedFigureMatches(412, 0, 412600), "412 matches a stored 412,xxx revenue");
  assert(!citedFigureMatches(69, 0, 69000), "a score of 69 does not match EBITDA in the thousands");
  const withId = attachCitedEvidence({
    title: "Gross margin is 0.5849",
    detail: "Snapshot e806dc36-8e43-4324-a28c-c5d5fa66a240 for Sep 2026.",
    pool: [
      {
        snapshotId: "e806dc36-8e43-4324-a28c-c5d5fa66a240",
        periodLabel: "Sep 2026",
        figures: { gross_margin: 0.5849514537921812 },
      },
    ],
    evidence: {
      snapshot_id: "e806dc36-8e43-4324-a28c-c5d5fa66a240",
      period_label: "Sep 2026",
      figures: { gross_margin: 0.5849514537921812 },
    },
  });
  assert(withId.ok === true, "digits inside a snapshot id are not a missing figure");
  const datedTitle = attachCitedEvidence({
    title: "Debtor days are 25 as of 30 Sep 2026",
    detail: "Period 1 Jan 2026 – 30 Sep 2026 (2026-09-30).",
    pool: [
      {
        snapshotId: "e806dc36-8e43-4324-a28c-c5d5fa66a240",
        periodLabel: "Sep 2026",
        figures: { "Debtor Days": 25 },
      },
    ],
    evidence: {
      snapshot_id: "e806dc36-8e43-4324-a28c-c5d5fa66a240",
      period_label: "Sep 2026",
      figures: { "Debtor Days": 25 },
    },
  });
  assert(datedTitle.ok === true, "the day of the month inside a date is not a missing figure");
  const bareThirty = attachCitedEvidence({
    title: "Cash is 30",
    detail: "",
    pool: [
      {
        snapshotId: "e806dc36-8e43-4324-a28c-c5d5fa66a240",
        periodLabel: "Sep 2026",
        figures: { "Debtor Days": 25 },
      },
    ],
    evidence: {
      snapshot_id: "e806dc36-8e43-4324-a28c-c5d5fa66a240",
      period_label: "Sep 2026",
      figures: { "Debtor Days": 25 },
    },
  });
  assert(bareThirty.ok === false, "a bare 30 that was not read is still refused");
  if (!bareThirty.ok) assert(bareThirty.error.includes("30"), "the error names 30");
  const band = attachCitedEvidence({
    title: "Debtor days are 25",
    detail: "Peer median 40 days. Healthy band 30–60 days.",
    pool: [
      {
        snapshotId: "snap-sep",
        periodLabel: "Sep 2026",
        figures: { "Debtor Days": 25 },
      },
    ],
    evidence: { snapshot_id: "snap-sep", period_label: "Sep 2026", figures: { "Debtor Days": 25 } },
  });
  assert(band.ok === true, "40 and 30 inside day labels are not missing figures");
  const revenue = attachCitedEvidence({
    title: "Revenue is R412k",
    detail: "About 412.",
    pool: [
      {
        snapshotId: "snap-sep",
        periodLabel: "Sep 2026",
        figures: { revenue: 412600 },
      },
    ],
    evidence: { snapshot_id: "snap-sep", period_label: "Sep 2026", figures: {} },
  });
  assert(revenue.ok === true, "412k and a bare 412 match the stored revenue");
  if (revenue.ok) {
    const figs = revenue.evidence.figures as Record<string, number>;
    assert(figs.revenue === 412600, "the evidence keeps the stored revenue");
  }
  const refiled = attachCitedEvidence({
    title: "Sep 2026 debtor days 25 and creditor days 37",
    detail: "",
    pool: [
      {
        snapshotId: "snap-sep",
        periodLabel: "Sep 2026",
        figures: { "Debtor Days": 25, "Creditor Days": 37 },
      },
      {
        snapshotId: "snap-oct",
        periodLabel: "Oct 2026",
        figures: { debtor_days: 40, creditor_days: 50 },
      },
    ],
    evidence: {
      snapshot_id: "snap-oct",
      period_label: "Oct 2026",
      figures: { debtor_days: 25, creditor_days: 37 },
    },
  });
  assert(refiled.ok === true, "September days cited under an October stamp are refiled");
  if (refiled.ok) {
    assert(refiled.evidence.period_label === "Sep 2026", "the evidence period is September, not October");
    const figs = refiled.evidence.figures as Record<string, number>;
    assert(figs["Debtor Days"] === 25 && figs["Creditor Days"] === 37, "the display keys are the stored September figures");
    assert(refiled.evidence.snapshot_id === "snap-sep", "the September snapshot is kept");
  }
  const percent = attachCitedEvidence({
    title: "Fixed costs are 46% of revenue",
    detail: "",
    pool: [
      {
        snapshotId: "snap-sep",
        periodLabel: "Sep 2026",
        figures: { "Fixed Cost Ratio": 0.4587378668612735 },
      },
    ],
    evidence: { snapshot_id: "snap-sep", period_label: "Sep 2026", figures: {} },
  });
  assert(percent.ok === true, "a rounded percent is attached from the ratio");
  if (percent.ok) {
    const figs = percent.evidence.figures as Record<string, number>;
    assert(figs["Fixed Cost Ratio"] === 0.4587378668612735, "the evidence keeps the stored ratio");
  }
  const small = attachCitedEvidence({
    title: "One of 4 pillars",
    detail: "100 is just a round label",
    pool,
    evidence: { snapshot_id: null, period_label: "2026-10-06", figures: { "score:2026-10-06": 69 } },
  });
  assert(small.ok === true, "a count of 4 and a bare 100 do not reject the finding");
  if (small.ok) assert(small.warning?.includes("4") && small.warning?.includes("100"), "those leftovers are a warning");
  const gap = attachCitedEvidence({
    title: "A 13 point gap",
    detail: "",
    pool,
    evidence: { snapshot_id: null, period_label: "2026-10-06", figures: { "score:2026-10-06": 69 } },
  });
  assert(gap.ok === false, "13 is a substantive number that was not read");

  const sameKey = findingRecordKey({
    kind: "weakest_pillar",
    periodLabel: "Oct 2026",
    snapshotId: "B6E99169-94AC-4FDB-9DF5-056C7CB33209",
  });
  assert(
    sameKey ===
      findingRecordKey({
        kind: "weakest_pillar",
        periodLabel: "oct 2026",
        snapshotId: "b6e99169-94ac-4fdb-9df5-056c7cb33209",
      }),
    "the same kind and period are one recorded key",
  );
  const runSrc = readFileSync(resolve("supabase/functions/agent-analyst/run.ts"), "utf8");
  const repeatSrc = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
  assert(runSrc.includes("recordedKeys"), "a run remembers findings it already recorded");
  assert(repeatSrc.includes("Already recorded, call finish."), "an in-run repeat tells the model to finish");
  assert(
    repeatSrc.indexOf("Already recorded, call finish.") < repeatSrc.indexOf('type: "finding"'),
    "an in-run repeat does not send another finding message",
  );
}

// The health tool returns the stored score. The live 67 is the current books with debt-to-equity.
{
  const labeled = labelHealthScore({
    liveOverall: 67,
    storedScore: 69,
    storedAsOf: "2026-10-06",
  });
  assert(labeled.overall === 69 && labeled.overall_as_of === "2026-10-06", "overall is the stored score and its as-of");
  assert(labeled.overall_basis === "stored", "the stored score is labeled stored");
  assert(labeled.live_overall === 67, "the recalculation stays available");
  assert(labeled.live_overall_label.includes("Not the stored score"), "the live score is labeled as a recalculation");
  const qa = {
    revenue: "700000",
    cogs: "280000",
    fixedCosts: "351000",
    ebit: "60000",
    ebitda: "69000",
    ebt: "60000",
    netIncome: "60000",
    receivables: "48500",
    payables: "28500",
    inventory: "62000",
    cash: "128450",
    totalAssets: "306950",
    equity: "150000",
    totalLiabilities: "156950",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  };
  const market = { country: "US" as const, copyPack: "us" as const };
  const live = scorecardHealthFromFinancials({
    financials: qa,
    fyStartMonth: 1,
    periodMonths: 12,
    market,
  });
  const { totalLiabilities: _liabilities, ...withoutDebt } = qa;
  const savedShape = scorecardHealthFromFinancials({
    financials: withoutDebt,
    fyStartMonth: 1,
    periodMonths: 12,
    market,
  });
  assert(live.overall === 67, `current books with debt-to-equity score 67, got ${live.overall}`);
  assert(savedShape.overall === 69, `the same books without debt-to-equity score 69, got ${savedShape.overall}`);
  assert(
    live.pillars.find((pillar) => pillar.id === "financing")?.score === 83,
    "debt-to-equity pulls the financing pillar to 83",
  );
  assert(
    savedShape.pillars.find((pillar) => pillar.id === "financing")?.score === 91,
    "without debt-to-equity the financing pillar is 91",
  );
  const executeSrc = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
  assert(executeSrc.includes("labelHealthScore"), "the analyst health tool labels the stored score");
  assert(executeSrc.includes("client_score_history"), "the analyst health tool reads the stored score");
  const healthBranch = executeSrc.slice(
    executeSrc.indexOf('if (tool === "get_health")'),
    executeSrc.indexOf('if (tool === "get_ratios")'),
  );
  assert(healthBranch.includes("figuresPeriodLabelFrom"), "get_health labels the live-books period");
  assert(healthBranch.includes('from("clients")'), "get_health reads the live books");
  assert(
    !/period_label:\s*\(snap\?\.period_label/.test(healthBranch),
    "get_health does not stamp the latest snapshot period",
  );
  assert(
    figuresPeriodLabelFrom(qa, "Oct 2026") === "1 Oct 2025 – 30 Sep 2026",
    "QA US without a period start is twelve months ending 30 Sep 2026",
  );
  assert(
    figuresPeriodLabelFrom({ periodEnd: "2026-09-30" }, "Oct 2026") === "Sep 2026",
    "a period end without a month count still beats the snapshot label",
  );
  assert(figuresPeriodLabelFrom({}, "Oct 2026") === "Oct 2026", "the snapshot label is only the fallback when there is no period end");
  assert(
    ANALYST_SYSTEM.includes("September versus October is not an inconsistency"),
    "the prompt tells the model that two periods are not a data-quality conflict",
  );
  const executeForSkip = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
  assert(
    executeForSkip.includes("Figures from different periods are not a data-quality conflict. Call finish."),
    "a cross-period data-quality finding is skipped without a rejection",
  );
}

console.log("agent analyst ok");
