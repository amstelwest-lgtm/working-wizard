/**
 * Direct-client path (P0.5) — an owner-only client (no firm) must be able to
 * go upload → diagnosis → forecast → recommendations → decision → actions →
 * outcome with no accountant seat involved, and every Next Step along the way
 * must land somewhere on the owner board.
 * Run: pnpm test:direct-client-path
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADVISORY_TRANSITION_RULES,
  nextAdvisoryState,
  type AdvisoryEvent,
  type AdvisoryState,
} from "../src/lib/advisory-state";
import { resolveNextStep, type NextStepFacts } from "../src/lib/next-step";
import { checkRootCauseClaims } from "../src/lib/recommendations";
import {
  dropOverclaimingSteps,
  stepOverclaims,
  systemPromptFor,
} from "../supabase/functions/brain-propose/logic.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = "2026-09-18T12:00:00.000Z";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function facts(over: Partial<NextStepFacts>): NextStepFacts {
  return {
    clientId: CLIENT,
    state: "onboarding",
    stateSource: "persisted",
    hasFirm: false,
    hasProfile: true,
    hasFinancials: true,
    hasSnapshot: true,
    hasForecast: true,
    openQuestions: 0,
    proposedRecommendations: 0,
    approvedWithoutAction: 0,
    openActions: 0,
    overdueActions: 0,
    blockedActions: 0,
    actionedUnmeasured: 0,
    openDataRequests: 0,
    nextReviewAt: null,
    now: NOW,
    ...over,
  };
}

// ── 1. State machine: owner-only client never enters accountant_review ───────

{
  const ownerCtx = { hasFirm: false, hasFinancials: false };
  const script: Array<{
    event: AdvisoryEvent;
    ctx?: Record<string, unknown>;
    expect: AdvisoryState;
  }> = [
    { event: "client.created", expect: "onboarding" },
    { event: "brain.question_answered", expect: "context_collection" },
    { event: "profile.completed", expect: "financial_data_collection" },
    { event: "data.uploaded", ctx: { hasFinancials: true }, expect: "data_validation" },
    { event: "data.validated", ctx: { hasFinancials: true }, expect: "diagnosis" },
    { event: "diagnosis.reviewed", expect: "forecasting" },
    { event: "forecast.published", expect: "recommendations" },
    { event: "recommendation.proposed", expect: "client_decision" },
    { event: "recommendation.decided", expect: "client_decision" },
    { event: "action.created", expect: "action_execution" },
    { event: "action.completed", ctx: { openActions: 0 }, expect: "outcome_monitoring" },
    { event: "cycle.review_due", expect: "next_review" },
    { event: "cycle.restarted", expect: "financial_data_collection" },
  ];
  let state: AdvisoryState | null = null;
  const visited: AdvisoryState[] = [];
  for (const step of script) {
    const t = nextAdvisoryState(state, step.event, { ...ownerCtx, ...(step.ctx ?? {}) });
    eq(t.to, step.expect, `owner-only ${step.event} from ${state ?? "∅"}`);
    state = t.to;
    visited.push(state);
  }
  assert(!visited.includes("accountant_review"), "owner-only cycle never enters accountant_review");

  // Firm-connected clients still route through review — the seat is optional, not removed.
  eq(
    nextAdvisoryState("recommendations", "recommendation.proposed", { hasFirm: true }).to,
    "accountant_review",
    "firm-connected client still gets accountant review",
  );

  // Every has_firm-guarded rule has a no_firm sibling so no state dead-ends without a firm.
  const firmGuarded = ADVISORY_TRANSITION_RULES.filter((r) => r.guard === "has_firm");
  assert(firmGuarded.length > 0, "there is at least one has_firm rule");
  for (const r of firmGuarded) {
    const sibling = ADVISORY_TRANSITION_RULES.find(
      (s) => s.event === r.event && s.from === r.from && s.guard === "no_firm",
    );
    assert(Boolean(sibling), `has_firm rule ${r.event}@${r.from} has a no_firm sibling`);
  }
}

// ── 2. Next Step for the owner along that path: always actionable on /app ────

{
  const path: Array<[AdvisoryState, Partial<NextStepFacts>, string]> = [
    [
      "onboarding",
      { hasProfile: false, hasFinancials: false, hasSnapshot: false, hasForecast: false },
      "profile",
    ],
    [
      "context_collection",
      { openQuestions: 2, hasFinancials: false, hasSnapshot: false },
      "questions",
    ],
    [
      "financial_data_collection",
      { hasFinancials: false, hasSnapshot: false, hasForecast: false },
      "upload",
    ],
    ["data_validation", {}, "validate"],
    ["diagnosis", {}, "diagnosis"],
    ["forecasting", { hasForecast: false }, "forecast"],
    ["recommendations", {}, "recommend"],
    ["client_decision", { proposedRecommendations: 2 }, "decide"],
    ["client_decision", { approvedWithoutAction: 1 }, "start_actions"],
    ["action_execution", { openActions: 3 }, "actions"],
    ["outcome_monitoring", { actionedUnmeasured: 1 }, "outcome"],
    ["next_review", {}, "restart"],
  ];
  for (const [state, over, key] of path) {
    const step = resolveNextStep(facts({ state, ...over }), "owner");
    eq(step.key, key, `owner next step in ${state}`);
    assert(step.key !== "wait", `owner never told to wait in ${state} without a firm`);
    eq(step.cta.route.path, "/app", `owner route path in ${state}`);
    assert(step.cta.route.tab !== null, `owner route lands on a board tab in ${state}`);
  }
  // Recommendation steps land on the Next Moves tab, where the panel lives.
  for (const key of ["recommend", "decide", "start_actions"] as const) {
    const st = resolveNextStep(
      facts({
        state: key === "recommend" ? "recommendations" : "client_decision",
        proposedRecommendations: key === "decide" ? 1 : 0,
        approvedWithoutAction: key === "start_actions" ? 1 : 0,
      }),
      "owner",
    );
    eq(st.key, key, `step ${key}`);
    eq(st.cta.route.tab, "next", `${key} → Next Moves tab`);
  }
  // Owner with a firm waits on review; owner without one decides. Same facts otherwise.
  eq(
    resolveNextStep(
      facts({ state: "client_decision", proposedRecommendations: 1, hasFirm: true }),
      "owner",
    ).key,
    "wait",
    "firm-connected owner waits on the remaining review",
  );
}

// ── 3. brain-propose: audience from firm_id, statement-depth claims dropped ──

{
  const owner = systemPromptFor("owner");
  const acct = systemPromptFor("accountant");
  assert(owner.includes("directly to the business owner"), "owner prompt addresses the owner");
  assert(
    !owner.toLowerCase().includes("approve / edit / reject"),
    "owner prompt has no reviewer verbs",
  );
  assert(
    owner.includes("never as regulated financial, tax or legal advice"),
    "owner prompt keeps HITL framing",
  );
  assert(acct.includes("briefing an accountant"), "accountant prompt unchanged in spirit");
  for (const p of [owner, acct]) {
    assert(
      p.includes("Never name or count specific invoices"),
      "both prompts forbid ledger-level claims",
    );
    assert(p.includes("Return ONLY valid JSON"), "both prompts keep the JSON contract");
  }

  const samples: Array<{ text: string; over: boolean }> = [
    { text: "Chase these five invoices before month end", over: true },
    { text: "Call the customers who owe more than 60 days", over: true },
    { text: "Speak to your largest debtor about terms", over: true },
    { text: "Tighten credit terms: debtor days rose from 41 to 58", over: false },
    { text: "Renegotiate supplier terms to lift creditor days toward 45", over: false },
    { text: "Cut discretionary overhead by ~5% to restore margin", over: false },
  ];
  for (const s of samples) {
    const edge = stepOverclaims({ title: s.text, rationale: null });
    const app = !checkRootCauseClaims({ data_depth: "statement", title: s.text }).ok;
    eq(edge, s.over, `edge overclaim: ${s.text}`);
    eq(app, edge, `edge and app claim rules agree: ${s.text}`);
  }
  const { kept, dropped } = dropOverclaimingSteps(
    samples.map((s) => ({ title: s.text, rationale: null, assumptions: [] })),
  );
  eq(dropped, 3, "three overclaiming steps dropped");
  eq(kept.length, 3, "three statement-safe steps kept");

  const fn = readFileSync(resolve("supabase/functions/brain-propose/index.ts"), "utf8");
  assert(
    fn.includes('client?.firm_id ? "accountant" : "owner"'),
    "audience decided from clients.firm_id",
  );
  assert(!/body\.audience|body\?\.audience/.test(fn), "audience never taken from the request body");
  assert(fn.includes("systemPromptFor(audience)"), "prompt chosen by audience");
  assert(
    fn.includes("dropOverclaimingSteps(payload.next_steps)"),
    "overclaims dropped before insert",
  );
  assert(
    fn.includes('source: "ai", data_depth: "statement"'),
    "AI proposals stamped statement-depth",
  );
  assert(fn.includes("has_client_access"), "access check is has_client_access (owner passes)");
  assert(!fn.includes("is_firm_member"), "edge fn never requires firm membership");
}

// ── 4. Shell wiring: owner can decide and spawn actions without a firm ───────

{
  const panel = readFileSync(resolve("src/components/recommendations-panel.tsx"), "utf8");
  assert(panel.includes("useServerFn(decideRecommendation)"), "panel decides via server fn");
  assert(
    panel.includes("useServerFn(createActionFromRecommendation)"),
    "panel spawns actions via server fn",
  );
  assert(panel.includes("invokeBrainPropose(clientId)"), "panel can ask the brain to propose");
  assert(
    panel.includes("STATEMENT_DEPTH_DISCLOSURE"),
    "panel shows the statement-depth disclosure",
  );
  assert(panel.includes('accept: "Accept"') && panel.includes('reject: "Not now"'), "owner verbs");
  assert(
    panel.includes('accept: "Approve"') && panel.includes('reject: "Reject"'),
    "accountant verbs",
  );

  const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
  const panelAt = app.indexOf("<RecommendationsPanel");
  const nextTabAt = app.indexOf('<TabsContent value="next">');
  const cashTabAt = app.indexOf('<TabsContent value="cash">');
  assert(
    panelAt > nextTabAt && panelAt < cashTabAt,
    "owner board mounts the panel on the Next Moves tab",
  );
  assert(
    app.includes('audience="owner"\n                    canPropose={hasRealFinancials}'),
    "owner panel proposes only with real figures",
  );
  assert(app.includes("setAdvisoryBump((n) => n + 1)"), "panel writes refresh the Next Step card");

  const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
  const sPanel = studio.indexOf("<RecommendationsPanel");
  const sAdvisory = studio.indexOf('id="pane-advisory"');
  assert(
    sPanel > sAdvisory,
    "studio mounts the panel on the Advisory tab (where Next Step routes review)",
  );
  assert(
    studio.includes('audience="accountant"\n                canPropose={hasFigures}'),
    "studio panel uses accountant audience",
  );

  const fns = readFileSync(resolve("src/lib/recommendations.functions.ts"), "utf8");
  assert(fns.includes("createActionWithoutRpc"), "pre-migration fallback exists");
  assert(fns.includes("linked_action_item_id: actionItemId"), "fallback links via legacy column");

  // The RLS boundary the owner path relies on.
  const writes = readFileSync(
    resolve("supabase/migrations/20260806300000_action_plan_owner_only_writes.sql"),
    "utf8",
  );
  assert(writes.includes("c.owner_user_id = _user_id"), "is_action_plan_writer includes the owner");
  const p02 = readFileSync(
    resolve("supabase/migrations/20260918130000_recommendations_outcomes.sql"),
    "utf8",
  );
  assert(
    p02.includes("is_action_plan_writer(v_uid, v_rec.client_id)"),
    "RPC uses the owner-or-firm write boundary",
  );
}

console.log("direct-client-path: all checks passed");
