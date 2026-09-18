/**
 * Advisory state machine (P0.1) — pure transitions + SQL/TS drift guard.
 * Run: pnpm test:advisory-state
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADVISORY_EVENTS,
  ADVISORY_GUARDS,
  ADVISORY_STATES,
  ADVISORY_STATE_LABELS,
  ADVISORY_TRANSITION_RULES,
  APP_WRITABLE_ADVISORY_EVENTS,
  DEFAULT_REVIEW_CADENCE_DAYS,
  advisoryRulesSqlValues,
  inferAdvisoryStateFromFacts,
  isMissingAdvisoryRelation,
  nextAdvisoryState,
  type AdvisoryEvent,
  type AdvisoryFacts,
  type AdvisoryState,
} from "../src/lib/advisory-state";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── 1. Rule table sanity ─────────────────────────────────────────────────────

{
  const seqs = ADVISORY_TRANSITION_RULES.map((r) => r.seq);
  assert(new Set(seqs).size === seqs.length, "rule seq values are unique");
  for (const r of ADVISORY_TRANSITION_RULES) {
    assert(
      (ADVISORY_EVENTS as readonly string[]).includes(r.event),
      `rule ${r.seq}: unknown event ${r.event}`,
    );
    assert(
      r.from === "*" ||
        r.from === "none" ||
        (ADVISORY_STATES as readonly string[]).includes(r.from),
      `rule ${r.seq}: unknown from ${r.from}`,
    );
    assert(
      (ADVISORY_STATES as readonly string[]).includes(r.to),
      `rule ${r.seq}: unknown to ${r.to}`,
    );
    assert(
      (ADVISORY_GUARDS as readonly string[]).includes(r.guard),
      `rule ${r.seq}: unknown guard ${r.guard}`,
    );
  }
  for (const s of ADVISORY_STATES) {
    assert(Boolean(ADVISORY_STATE_LABELS[s]?.label), `label for ${s}`);
    assert(Boolean(ADVISORY_STATE_LABELS[s]?.waitingFor), `waitingFor copy for ${s}`);
  }
  // Every state must be reachable as a `to` of some rule (or be the bootstrap state).
  const reachable = new Set<string>(ADVISORY_TRANSITION_RULES.map((r) => r.to));
  reachable.add("onboarding");
  for (const s of ADVISORY_STATES) assert(reachable.has(s), `state ${s} is unreachable`);
  eq(DEFAULT_REVIEW_CADENCE_DAYS, 30, "review cadence mirrors the SQL interval");
}

// ── 2. Bootstrap ─────────────────────────────────────────────────────────────

{
  const t = nextAdvisoryState(null, "client.created");
  eq(t.to, "onboarding", "fresh client → onboarding");
  assert(t.newCycle && t.changed, "client.created opens a cycle");

  const withData = nextAdvisoryState(null, "client.created", { hasFinancials: true });
  eq(withData.to, "data_validation", "client created with financials skips straight to validation");

  // Any event on a state-less client bootstraps first, then applies.
  const upload = nextAdvisoryState(null, "data.uploaded");
  eq(upload.to, "data_validation", "upload on state-less client");
  eq(upload.from, null, "from stays null on bootstrap");
  assert(upload.newCycle, "bootstrap opens a cycle");

  const noise = nextAdvisoryState(null, "action.started");
  eq(noise.to, "onboarding", "unmatched event on state-less client still bootstraps");
  assert(
    noise.changed && noise.newCycle && noise.rule === null,
    "bootstrap recorded, no rule fired",
  );
}

// ── 3. Owner-only happy path (no accountant anywhere) ────────────────────────

{
  let s: AdvisoryState | null = null;
  const step = (event: AdvisoryEvent, ctx = {}) => {
    const t = nextAdvisoryState(s, event, { hasFirm: false, ...ctx });
    s = t.to;
    return t;
  };
  step("client.created");
  eq(s, "onboarding", "1");
  step("brain.question_answered");
  eq(s, "context_collection", "answering a brain question moves out of onboarding");
  step("profile.completed");
  eq(s, "financial_data_collection", "profile done → waiting for numbers");
  step("data.uploaded");
  eq(s, "data_validation", "upload → validation");
  step("data.validated");
  eq(s, "diagnosis", "snapshot → diagnosis");
  step("diagnosis.reviewed");
  eq(s, "forecasting", "reviewed → forecasting");
  step("forecast.published");
  eq(s, "recommendations", "forecast → recommendations");
  const prop = step("recommendation.proposed");
  eq(s, "client_decision", "owner-only: proposal goes straight to the owner, no accountant gate");
  eq(prop.rule?.guard, "no_firm", "no_firm guard fired");
  const act = step("action.created", { openActions: 1 });
  eq(s, "action_execution", "first action → execution");
  assert(!act.newCycle, "actions stay in the same cycle");
  step("action.completed", { openActions: 2 });
  eq(s, "action_execution", "one done, others open → still executing");
  step("action.completed", { openActions: 0 });
  eq(s, "outcome_monitoring", "last action done → monitoring");
  step("cycle.review_due");
  eq(s, "next_review", "cadence elapsed → review due");
  const next = step("data.uploaded");
  eq(s, "data_validation", "new statements → validate again");
  assert(next.newCycle, "new statements after the loop closed open a new cycle");
}

// ── 4. Accountant-connected path ─────────────────────────────────────────────

{
  let s: AdvisoryState | null = "recommendations";
  const step = (event: AdvisoryEvent, ctx = {}) => {
    const t = nextAdvisoryState(s, event, { hasFirm: true, ...ctx });
    s = t.to;
    return t;
  };
  step("recommendation.proposed");
  eq(s, "accountant_review", "firm-connected proposal waits for the accountant");
  const rej = step("recommendation.rejected");
  eq(s, "accountant_review", "rejection is recorded, state unchanged");
  assert(!rej.changed && rej.rule === null, "rejection fires no rule");
  step("recommendation.approved");
  eq(s, "client_decision", "approval hands the decision to the owner");

  // Sign-off path: only advisory/action_plan scopes unblock the decision.
  s = "accountant_review";
  step("review.signed_off", { scope: "financials" });
  eq(s, "accountant_review", "financials sign-off does not approve recommendations");
  step("review.signed_off", { scope: "advisory" });
  eq(s, "client_decision", "advisory sign-off approves the pack");

  // Accountant can also skip straight to tasks.
  s = "accountant_review";
  step("action.created", { openActions: 1 });
  eq(s, "action_execution", "creating a task from review starts execution");
}

// ── 5. Re-upload semantics + restart ─────────────────────────────────────────

{
  for (const from of [
    "diagnosis",
    "forecasting",
    "recommendations",
    "accountant_review",
    "client_decision",
  ] as const) {
    const t = nextAdvisoryState(from, "data.uploaded");
    eq(t.to, "data_validation", `re-upload from ${from} re-validates`);
    assert(!t.newCycle, `re-upload from ${from} stays in the same cycle`);
  }
  for (const from of ["action_execution", "outcome_monitoring", "next_review"] as const) {
    const t = nextAdvisoryState(from, "data.uploaded");
    eq(t.to, "data_validation", `new period from ${from} re-validates`);
    assert(t.newCycle, `new period from ${from} opens a new cycle`);
  }
  const same = nextAdvisoryState("data_validation", "data.uploaded");
  eq(same.to, "data_validation", "upload while validating");
  assert(!same.changed && same.rule === null, "no-op recorded without a rule");

  for (const from of ADVISORY_STATES) {
    const t = nextAdvisoryState(from, "cycle.restarted");
    eq(t.to, "financial_data_collection", `restart from ${from}`);
    assert(t.newCycle, `restart from ${from} opens a new cycle`);
    eq(t.rule?.from, "*", "wildcard rule fired");
  }

  // Exact-state rules beat wildcard: data.uploaded has no wildcard, but make
  // sure ordering logic is exercised by an event that has both.
  const restartFromNone = nextAdvisoryState(null, "cycle.restarted");
  eq(restartFromNone.to, "financial_data_collection", "restart on state-less client");
}

// ── 6. Reserved / audit-only events never move state ─────────────────────────

{
  const quiet: AdvisoryEvent[] = [
    "action.started",
    "action.blocked",
    "review.retracted",
    "recommendation.superseded",
    "outcome.recorded",
    "data.request_opened",
    "data.request_fulfilled",
    "cycle.backfilled",
  ];
  for (const s of ADVISORY_STATES) {
    for (const e of quiet) {
      const t = nextAdvisoryState(s, e, { hasFirm: true, openActions: 0 });
      eq(t.to, s, `${e} from ${s} is audit-only`);
      assert(!t.changed, `${e} from ${s} unchanged`);
    }
  }
}

// ── 7. Derived fallback mirrors the backfill precedence ──────────────────────

{
  const base: AdvisoryFacts = {
    hasFirm: false,
    hasProfile: false,
    hasFinancials: false,
    hasSnapshot: false,
    hasForecast: false,
    proposedSteps: 0,
    approvedSteps: 0,
    openActions: 0,
    doneActions: 0,
  };
  eq(inferAdvisoryStateFromFacts(base), "onboarding", "empty client");
  eq(
    inferAdvisoryStateFromFacts({ ...base, hasProfile: true }),
    "financial_data_collection",
    "profile only",
  );
  eq(
    inferAdvisoryStateFromFacts({ ...base, hasFinancials: true }),
    "data_validation",
    "financials only",
  );
  eq(
    inferAdvisoryStateFromFacts({ ...base, hasFinancials: true, hasSnapshot: true }),
    "diagnosis",
    "snapshot",
  );
  eq(
    inferAdvisoryStateFromFacts({ ...base, hasSnapshot: true, hasForecast: true }),
    "recommendations",
    "forecast",
  );
  eq(
    inferAdvisoryStateFromFacts({ ...base, hasForecast: true, proposedSteps: 1 }),
    "client_decision",
    "owner proposal",
  );
  eq(
    inferAdvisoryStateFromFacts({ ...base, hasFirm: true, hasForecast: true, proposedSteps: 1 }),
    "accountant_review",
    "firm proposal",
  );
  eq(
    inferAdvisoryStateFromFacts({ ...base, proposedSteps: 1, approvedSteps: 1 }),
    "client_decision",
    "approved",
  );
  eq(inferAdvisoryStateFromFacts({ ...base, doneActions: 2 }), "outcome_monitoring", "all done");
  eq(
    inferAdvisoryStateFromFacts({ ...base, doneActions: 2, openActions: 1 }),
    "action_execution",
    "open beats done",
  );

  assert(
    isMissingAdvisoryRelation({ message: 'relation "public.advisory_events" does not exist' }),
    "missing relation",
  );
  assert(
    isMissingAdvisoryRelation({
      message: "Could not find the 'advisory_state' column of 'clients' in the schema cache",
    }),
    "missing column",
  );
  assert(
    !isMissingAdvisoryRelation({ message: "permission denied for table clients" }),
    "other errors pass through",
  );
}

// ── 8. SQL ↔ TS drift guard ──────────────────────────────────────────────────

{
  // The advisory spine is spread over several additive migrations. For each
  // guarded definition the LAST migration (by filename) that declares it wins,
  // so a later migration can re-declare a CHECK / re-seed the rules table.
  const migrationsDir = resolve("supabase/migrations");
  const advisoryFiles = readdirSync(migrationsDir)
    .filter((f) => /^\d+_(advisory|recommendations)/.test(f) && f.endsWith(".sql"))
    .sort();
  assert(advisoryFiles.includes("20260918120000_advisory_state.sql"), "P0.1 migration present");
  assert(
    advisoryFiles.includes("20260918130000_recommendations_outcomes.sql"),
    "P0.2 migration present",
  );
  const sources = advisoryFiles.map((f) => ({
    file: f,
    sql: readFileSync(resolve(migrationsDir, f), "utf8"),
  }));
  const latest = (re: RegExp, label: string): RegExpMatchArray => {
    for (let i = sources.length - 1; i >= 0; i--) {
      const m = sources[i].sql.match(re);
      if (m) return m;
    }
    throw new Error(`${label}: not found in any advisory migration`);
  };
  const anySql = (needle: string) => sources.some((s) => s.sql.includes(needle));
  const sql = sources.find((s) => s.file === "20260918120000_advisory_state.sql")!.sql;

  const expectedValues = advisoryRulesSqlValues();
  const seedFile = [...sources]
    .reverse()
    .find((s) => s.sql.includes("INSERT INTO public.advisory_transition_rules"));
  assert(Boolean(seedFile), "a migration seeds advisory_transition_rules");
  if (!seedFile!.sql.includes(expectedValues)) {
    throw new Error(
      `advisory_transition_rules seed in ${seedFile!.file} does not match src/lib/advisory-state.ts.\n` +
        "Add a new migration that re-seeds the table with:\n" +
        expectedValues,
    );
  }

  const quoted = (block: string) => Array.from(block.matchAll(/'([a-z_.*]+)'/g), (m) => m[1]);

  const stateCheck = latest(/clients_advisory_state_check CHECK \(([\s\S]*?)\);/, "state CHECK");
  const sqlStates = new Set(quoted(stateCheck[1]));
  for (const s of ADVISORY_STATES) assert(sqlStates.has(s), `SQL state CHECK missing ${s}`);
  eq(sqlStates.size, ADVISORY_STATES.length, "SQL state CHECK has no extra states");

  const eventCheck = latest(
    /(?:event\s+text NOT NULL CHECK \(event IN \(|advisory_events_event_check CHECK \(event IN \()([\s\S]*?)\)\)/,
    "event CHECK",
  );
  const sqlEvents = new Set(quoted(eventCheck[1]));
  for (const e of ADVISORY_EVENTS) assert(sqlEvents.has(e), `SQL event CHECK missing ${e}`);
  eq(sqlEvents.size, ADVISORY_EVENTS.length, "SQL event CHECK has no extra events");

  const guardCheck = latest(
    /guard\s+text NOT NULL CHECK \(guard IN \(([\s\S]*?)\)\)/,
    "guard CHECK",
  );
  const sqlGuards = new Set(quoted(guardCheck[1]));
  for (const g of ADVISORY_GUARDS) assert(sqlGuards.has(g), `SQL guard CHECK missing ${g}`);
  eq(sqlGuards.size, ADVISORY_GUARDS.length, "SQL guard CHECK has no extra guards");

  const allow = latest(/IF p_event NOT IN \(([\s\S]*?)\) THEN/, "RPC allowlist");
  const sqlAllow = new Set(quoted(allow[1]));
  for (const e of APP_WRITABLE_ADVISORY_EVENTS)
    assert(sqlAllow.has(e), `RPC allowlist missing ${e}`);
  eq(sqlAllow.size, APP_WRITABLE_ADVISORY_EVENTS.length, "RPC allowlist has no extra events");

  // Guard evaluation in SQL covers every guard name.
  for (const g of ADVISORY_GUARDS) {
    assert(anySql(`r.guard = '${g}'`), `advisory_next_state evaluates guard ${g}`);
  }
  assert(sql.includes("interval '30 days'"), "SQL review cadence is 30 days");

  // Every event that a trigger/RPC emits is a declared event.
  for (const s of sources) {
    for (const m of s.sql.matchAll(
      /advisory_(?:emit|apply_event|record_event)\([^,]+,\s*'([a-z_.]+)'/g,
    )) {
      assert(sqlEvents.has(m[1]), `${s.file} emits undeclared event ${m[1]}`);
    }
  }

  // Emission points wired.
  for (const trg of [
    "trg_advisory_clients ON public.clients",
    "trg_advisory_snapshots ON public.client_financial_snapshots",
    "trg_advisory_brain_questions ON public.client_brain_questions",
    "trg_advisory_next_steps ON public.proposed_next_steps",
    "trg_advisory_signoffs ON public.client_review_signoffs",
    "trg_advisory_action_items ON public.action_items",
  ]) {
    assert(sql.includes(`DROP TRIGGER IF EXISTS ${trg}`), `trigger wired: ${trg}`);
  }

  // Security posture: writes only via SECURITY DEFINER functions; reads via has_client_access.
  assert(
    !/CREATE POLICY "advisory_(events|cycles) (insert|update|delete)/.test(sql),
    "no direct write policies",
  );
  assert(
    /advisory_events select access"[\s\S]*?has_client_access\(auth\.uid\(\), client_id\)/.test(sql),
    "events readable via has_client_access",
  );
  assert(
    /REVOKE ALL ON FUNCTION public\.advisory_apply_event[\s\S]*?FROM PUBLIC, anon, authenticated/.test(
      sql,
    ),
    "apply_event not callable by authenticated",
  );
  assert(
    /GRANT EXECUTE ON FUNCTION public\.advisory_record_event[\s\S]*?TO authenticated/.test(sql),
    "record_event callable by authenticated",
  );
  assert(
    sql.includes("has_client_access(v_uid, p_client_id)"),
    "record_event checks client access",
  );

  // Additive-only: no drops of existing business tables/columns.
  assert(!/DROP TABLE/i.test(sql), "no DROP TABLE");
  assert(!/DROP COLUMN/i.test(sql), "no DROP COLUMN");
}

// ── 9. Server functions + wiring ─────────────────────────────────────────────

{
  const fns = readFileSync(resolve("src/lib/advisory-state.functions.ts"), "utf8");
  assert(fns.includes("export const getAdvisoryState"), "getAdvisoryState exported");
  assert(fns.includes("export const appendAdvisoryEvent"), "appendAdvisoryEvent exported");
  assert(fns.includes('rpc("advisory_record_event"'), "append uses the allowlisted RPC");
  assert(fns.includes("inferAdvisoryStateFromFacts"), "read path falls back to derived state");
  assert(fns.includes('source: "derived"'), "derived snapshots are labelled");
  assert(fns.includes("requireSupabaseAuth"), "server fns use auth middleware");

  const types = readFileSync(resolve("src/integrations/supabase/types.ts"), "utf8");
  for (const t of [
    "advisory_cycles: {",
    "advisory_events: {",
    "advisory_transition_rules: {",
    "advisory_record_event: {",
  ]) {
    assert(types.includes(t), `types.ts has ${t}`);
  }

  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert(Boolean(pkg.scripts["test:advisory-state"]), "test:advisory-state script registered");
}

console.log("advisory-state: all checks passed");
