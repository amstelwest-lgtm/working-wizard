/**
 * Next Step resolver (P0.3) — main branches, blocker precedence, route validity.
 * Run: pnpm test:next-step
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADVISORY_STATES, type AdvisoryState } from "../src/lib/advisory-state";
import {
  ACCOUNTANT_STUDIO_TABS,
  NEXT_STEP_AUDIENCES,
  NEXT_STEP_TARGETS,
  NEXT_STEP_URGENCIES,
  OWNER_BOARD_TABS,
  daysBetween,
  nextStepRoute,
  outstandingChips,
  resolveNextStep,
  urgencyLabel,
  type NextStepFacts,
} from "../src/lib/next-step";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = "2026-09-18T12:00:00.000Z";
const CLIENT = "11111111-1111-4111-8111-111111111111";

function facts(over: Partial<NextStepFacts> = {}): NextStepFacts {
  return {
    clientId: CLIENT,
    state: "onboarding",
    stateSource: "persisted",
    hasFirm: false,
    hasProfile: false,
    hasFinancials: false,
    hasSnapshot: false,
    hasForecast: false,
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

const owner = (f: NextStepFacts) => resolveNextStep(f, "owner");
const acct = (f: NextStepFacts) => resolveNextStep(f, "accountant");

// ── 1. Totality: every state × audience yields a valid step and route ────────

{
  for (const state of ADVISORY_STATES) {
    for (const audience of NEXT_STEP_AUDIENCES) {
      const step = resolveNextStep(facts({ state }), audience);
      assert(step.title.length > 0, `${state}/${audience}: title`);
      assert(step.reason.length > 0, `${state}/${audience}: reason`);
      assert(step.cta.label.length > 0, `${state}/${audience}: cta label`);
      assert((NEXT_STEP_TARGETS as readonly string[]).includes(step.key), `${state}: key`);
      assert(
        (NEXT_STEP_URGENCIES as readonly string[]).includes(step.urgency),
        `${state}: urgency`,
      );
      eq(step.state, state, "echoes state");
      eq(step.audience, audience, "echoes audience");
      const r = step.cta.route;
      if (audience === "owner") {
        eq(r.path, "/app", `${state}/owner: path`);
        assert(
          r.tab !== null && (OWNER_BOARD_TABS as readonly string[]).includes(r.tab),
          `${state}/owner: tab ${r.tab} is an owner board tab`,
        );
      } else {
        eq(r.path, `/clients/${CLIENT}`, `${state}/accountant: path`);
        assert(
          r.tab !== null && (ACCOUNTANT_STUDIO_TABS as readonly string[]).includes(r.tab),
          `${state}/accountant: tab ${r.tab} is a studio tab`,
        );
        assert(r.href.startsWith(`/clients/${CLIENT}?tab=${r.tab}`), `${state}: href carries tab`);
      }
    }
  }
  // Every target maps to a tab on both surfaces.
  for (const t of NEXT_STEP_TARGETS) {
    assert(nextStepRoute(t, "owner", CLIENT).tab !== null, `owner tab for ${t}`);
    assert(nextStepRoute(t, "accountant", CLIENT).tab !== null, `accountant tab for ${t}`);
  }
}

// ── 2. State branches ────────────────────────────────────────────────────────

{
  eq(owner(facts({ state: "onboarding" })).key, "profile", "onboarding without profile → profile");
  eq(
    owner(facts({ state: "onboarding", hasProfile: true })).key,
    "upload",
    "onboarding + profile → upload",
  );

  eq(
    owner(facts({ state: "context_collection", openQuestions: 3 })).key,
    "questions",
    "open questions → answer them",
  );
  assert(
    owner(facts({ state: "context_collection", openQuestions: 3 })).title.includes(
      "3 open questions",
    ),
    "question count in title",
  );
  eq(
    owner(facts({ state: "context_collection", openQuestions: 1 })).title,
    "Answer 1 open question",
    "singular",
  );
  eq(owner(facts({ state: "context_collection" })).key, "upload", "no open questions → upload");

  eq(owner(facts({ state: "financial_data_collection" })).key, "upload", "collection → upload");
  eq(
    acct(facts({ state: "financial_data_collection" })).cta.route.search.onboard,
    "1",
    "accountant upload opens the nudge",
  );
  eq(owner(facts({ state: "data_validation" })).key, "validate", "validation");
  eq(owner(facts({ state: "diagnosis" })).key, "diagnosis", "diagnosis");
  eq(owner(facts({ state: "forecasting" })).key, "forecast", "forecasting");
  eq(
    owner(facts({ state: "forecasting" })).cta.route.tab,
    "cash",
    "forecast lands on cash (owner)",
  );
  eq(
    acct(facts({ state: "forecasting" })).cta.route.tab,
    "cash",
    "forecast lands on cash (accountant)",
  );
  eq(owner(facts({ state: "recommendations" })).key, "recommend", "recommendations");
  eq(
    acct(facts({ state: "recommendations" })).cta.route.tab,
    "advisory",
    "accountant drafts in advisory",
  );
  eq(owner(facts({ state: "recommendations" })).cta.route.tab, "next", "owner reads next moves");

  // accountant_review: the two seats see different work.
  // P1: with no pack yet the accountant builds one; the pack is the review unit.
  const ar = facts({ state: "accountant_review", hasFirm: true, proposedRecommendations: 2 });
  eq(acct(ar).key, "generate_pack", "accountant generates the pack first");
  eq(acct(ar).cta.route.tab, "advisory", "pack lives on the advisory tab");
  eq(owner(ar).key, "wait", "owner waits");
  eq(owner(ar).urgency, "info", "waiting is informational, not a CTA to hammer");
  const arPack = facts({ ...ar, packStatus: "in_review", packVersion: 3 });
  eq(acct(arPack).key, "review_pack", "pack in review → review it");
  eq(acct(arPack).title, "Review advisory pack v3", "pack version in title");
  eq(
    owner(arPack).title,
    "Your accountant is reviewing your advisory pack",
    "owner copy names the pack",
  );
  eq(
    acct(facts({ ...ar, packStatus: "changes_requested" })).key,
    "review_pack",
    "changes requested → still the accountant's",
  );
  eq(
    acct(facts({ ...ar, packStatus: "rejected" })).key,
    "generate_pack",
    "rejected → build a new one",
  );
  // Approved pack but state still accountant_review (e.g. sign-off via a
  // different route): fall back to reviewing the remaining recommendations.
  eq(acct(facts({ ...ar, packStatus: "approved" })).key, "review", "approved pack → plain review");
  eq(
    acct(facts({ ...ar, packStatus: "approved" })).title,
    "Review 2 proposed recommendations",
    "review count",
  );

  // client_decision + pack: owner reads before deciding.
  const cdPack = facts({
    state: "client_decision",
    hasFirm: true,
    proposedRecommendations: 0,
    approvedWithoutAction: 2,
    packStatus: "approved",
    packVersion: 2,
    packRequiresReview: true,
    packDelivered: false,
  });
  eq(owner(cdPack).key, "read_pack", "owner reads the signed-off pack before actions");
  eq(owner(cdPack).cta.route.tab, "next", "pack sits on Next Moves for the owner");
  eq(owner({ ...cdPack, packDelivered: true }).key, "start_actions", "once read, on to actions");
  eq(acct(cdPack).key, "start_actions", "accountant is not asked to read their own pack");
  const cdOwnerOnly = facts({
    state: "client_decision",
    hasFirm: false,
    proposedRecommendations: 3,
    packStatus: "draft",
    packVersion: 1,
  });
  eq(owner(cdOwnerOnly).key, "read_pack", "owner-only draft pack → read and accept");
  eq(owner(cdOwnerOnly).title, "Read and accept advisory pack v1", "accept copy");
  eq(
    owner({ ...cdOwnerOnly, packStatus: "approved", packDelivered: true }).key,
    "decide",
    "accepted → decide",
  );

  // client_decision branches.
  eq(
    owner(facts({ state: "client_decision", proposedRecommendations: 2 })).key,
    "decide",
    "direct client decides on proposed",
  );
  eq(
    owner(facts({ state: "client_decision", approvedWithoutAction: 1 })).key,
    "start_actions",
    "approved but unplanned → create actions",
  );
  eq(
    owner(facts({ state: "client_decision", approvedWithoutAction: 1 })).cta.route.tab,
    "next",
    "owner starts actions from next moves",
  );
  eq(
    acct(facts({ state: "client_decision", approvedWithoutAction: 1 })).cta.route.tab,
    "plan",
    "accountant starts actions from the plan",
  );
  eq(
    owner(facts({ state: "client_decision", hasFirm: true, proposedRecommendations: 1 })).key,
    "wait",
    "firm client: unreviewed leftovers are the accountant's",
  );
  eq(
    acct(facts({ state: "client_decision", hasFirm: true, proposedRecommendations: 1 })).key,
    "review",
    "…and the accountant is told to finish reviewing",
  );
  const empty = owner(facts({ state: "client_decision" }));
  eq(empty.key, "recommend", "everything rejected → propose new moves");
  eq(empty.urgency, "soon", "not urgent");

  // action_execution branches.
  eq(owner(facts({ state: "action_execution", openActions: 4 })).key, "actions", "open actions");
  eq(
    owner(facts({ state: "action_execution", openActions: 4 })).cta.route.tab,
    "tasks",
    "owner tasks tab",
  );
  eq(
    acct(facts({ state: "action_execution", openActions: 4 })).cta.route.tab,
    "plan",
    "accountant plan tab",
  );
  eq(
    owner(facts({ state: "action_execution", approvedWithoutAction: 2 })).key,
    "start_actions",
    "no open actions but unplanned approvals",
  );
  eq(owner(facts({ state: "action_execution" })).key, "outcome", "nothing open → measure");

  // outcome_monitoring: review in the future vs due.
  const future = owner(
    facts({
      state: "outcome_monitoring",
      nextReviewAt: "2026-10-01T00:00:00.000Z",
      actionedUnmeasured: 1,
    }),
  );
  eq(future.key, "outcome", "monitoring");
  eq(future.urgency, "soon", "future review is soon, not now");
  eq(future.title, "Next review in 13 days", "days until review");
  eq(future.daysToReview, 13, "daysToReview exposed");
  assert(future.reason.includes("1 recommendation still needs"), "singular unmeasured copy");

  const due = owner(
    facts({ state: "outcome_monitoring", nextReviewAt: "2026-09-01T00:00:00.000Z" }),
  );
  eq(due.urgency, "now", "past review date → now");
  eq(due.title, "Measure what changed", "due copy");
  eq(owner(facts({ state: "outcome_monitoring" })).urgency, "now", "no review date → now");

  eq(owner(facts({ state: "next_review" })).key, "restart", "next review → restart");
  eq(acct(facts({ state: "next_review" })).cta.route.search.onboard, "1", "restart opens upload");
}

// ── 3. Blocker precedence ────────────────────────────────────────────────────

{
  const base = facts({ state: "action_execution", openActions: 5 });
  eq(owner({ ...base, overdueActions: 2 }).key, "chase", "overdue beats open actions");
  eq(owner({ ...base, overdueActions: 2 }).urgency, "blocking", "overdue is blocking");
  eq(acct({ ...base, overdueActions: 2 }).title, "Chase 2 overdue actions", "accountant chases");
  eq(owner({ ...base, overdueActions: 1 }).title, "1 action is overdue", "owner singular");
  eq(owner({ ...base, overdueActions: 2 }).title, "2 actions are overdue", "owner plural");
  eq(
    acct({ ...base, overdueActions: 2 }).cta.route.search.filter,
    "overdue",
    "lands on overdue filter",
  );

  eq(owner({ ...base, blockedActions: 1 }).key, "unblock", "blocked beats open actions");
  eq(
    owner({ ...base, blockedActions: 1, overdueActions: 1 }).key,
    "chase",
    "overdue beats blocked",
  );
  eq(
    acct({ ...base, blockedActions: 1 }).cta.route.search.filter,
    "blocked",
    "lands on blocked filter",
  );

  eq(
    owner({ ...base, overdueActions: 3, blockedActions: 1, openDataRequests: 1 }).key,
    "data_request",
    "missing data beats everything",
  );

  // Blockers never override the pre-data states: there is nothing to chase yet.
  for (const state of [
    "onboarding",
    "context_collection",
    "financial_data_collection",
  ] as AdvisoryState[]) {
    const s = owner(facts({ state, overdueActions: 9, blockedActions: 9, openDataRequests: 9 }));
    assert(s.key === "profile" || s.key === "upload", `${state}: pre-data step wins (${s.key})`);
  }
  // …but do override every post-data state.
  for (const state of ADVISORY_STATES.filter(
    (s) => !["onboarding", "context_collection", "financial_data_collection"].includes(s),
  )) {
    eq(owner(facts({ state, overdueActions: 1 })).key, "chase", `${state}: overdue overrides`);
  }
}

// ── 4. Determinism + outstanding echo ────────────────────────────────────────

{
  const f = facts({
    state: "action_execution",
    openActions: 2,
    overdueActions: 1,
    openQuestions: 4,
  });
  eq(JSON.stringify(owner(f)), JSON.stringify(owner(f)), "same facts → same step");
  const s = owner(f);
  eq(s.outstanding.openActions, 2, "outstanding echoes open actions");
  eq(s.outstanding.overdueActions, 1, "outstanding echoes overdue");
  eq(s.outstanding.openQuestions, 4, "outstanding echoes questions");
  eq(s.stateLabel, "Actions in progress", "state label from advisory-state");
  eq(daysBetween(NOW, "2026-09-19T11:00:00.000Z"), 1, "partial day rounds up");
  eq(daysBetween(NOW, "2026-09-18T12:00:00.000Z"), 0, "same instant");
  eq(daysBetween("garbage", NOW), null, "bad date → null");
}

// ── 5. Route shape ───────────────────────────────────────────────────────────

{
  const r = nextStepRoute("chase", "accountant", CLIENT);
  eq(r.href, `/clients/${CLIENT}?tab=plan&filter=overdue`, "href includes tab and filter");
  const o = nextStepRoute("chase", "owner", CLIENT);
  eq(o.href, "/app", "owner href is the board");
  eq(o.tab, "tasks", "owner tab carried for the in-app switch");
  eq(Object.keys(o.search).length, 0, "owner route adds no query params /app ignores");
}

// ── 6. Wiring ────────────────────────────────────────────────────────────────

{
  const fns = readFileSync(resolve("src/lib/next-step.functions.ts"), "utf8");
  assert(fns.includes("export const getNextStep"), "getNextStep exported");
  assert(fns.includes("requireSupabaseAuth"), "auth middleware");
  assert(
    fns.includes("loadAdvisorySnapshot("),
    "state comes from the P0.1 snapshot (access-checked)",
  );
  assert(
    fns.includes("resolveNextStep(facts, audience)"),
    "server fn delegates to the pure resolver",
  );
  assert(
    fns.includes('count(sb, "data_requests", data.clientId'),
    "openDataRequests counts live data_requests (P0.6)",
  );
  assert(
    fns.includes('.eq("status", "unanswered").in("audience", questionAudiences)'),
    "questions filtered by audience",
  );
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert(Boolean(pkg.scripts["test:next-step"]), "test:next-step script registered");
}

// ── 7. P0.4 presentation helpers ─────────────────────────────────────────────

{
  for (const u of NEXT_STEP_URGENCIES) assert(urgencyLabel(u).length > 0, `urgency label ${u}`);

  const o = {
    openQuestions: 2,
    proposedRecommendations: 3,
    approvedWithoutAction: 1,
    openActions: 5,
    overdueActions: 2,
    blockedActions: 1,
    actionedUnmeasured: 1,
    openDataRequests: 0,
  };
  const ownerChips = outstandingChips(o, "owner");
  eq(
    ownerChips.map((c) => c.key).join(","),
    "overdueActions,blockedActions,openActions,proposedRecommendations,approvedWithoutAction,actionedUnmeasured,openQuestions",
    "chips ordered most urgent first; zero counts omitted",
  );
  eq(ownerChips[0].label, "2 overdue", "overdue chip");
  eq(ownerChips[1].label, "1 blocked", "blocked chip singular");
  eq(ownerChips[3].label, "3 to decide", "owner decides");
  eq(outstandingChips(o, "accountant")[3].label, "3 to review", "accountant reviews");
  eq(ownerChips[3].target, "decide", "owner chip target");
  eq(outstandingChips(o, "accountant")[3].target, "review", "accountant chip target");
  eq(ownerChips[5].label, "1 result to record", "unmeasured singular");
  for (const c of ownerChips) {
    assert((NEXT_STEP_TARGETS as readonly string[]).includes(c.target), `chip ${c.key} target`);
  }
  eq(
    outstandingChips(
      {
        ...o,
        openQuestions: 0,
        proposedRecommendations: 0,
        approvedWithoutAction: 0,
        openActions: 0,
        overdueActions: 0,
        blockedActions: 0,
        actionedUnmeasured: 0,
      },
      "owner",
    ).length,
    0,
    "no chips when nothing outstanding",
  );
}

// ── 8. P0.4 shell wiring — first screen is action, not ratios ────────────────

{
  const card = readFileSync(resolve("src/components/next-step-card.tsx"), "utf8");
  assert(card.includes("useServerFn(getNextStep)"), "card fetches getNextStep");
  assert(
    card.includes('event: "diagnosis.reviewed"'),
    "card records diagnosis.reviewed (only app-writable step)",
  );
  assert(card.includes("outstandingChips("), "card renders outstanding chips");
  assert(card.includes("visibilitychange"), "card refreshes when the tab regains focus");
  assert(
    !/navigate\(|useNavigate|window\.location/.test(card),
    "card never navigates itself; host performs the CTA",
  );

  const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
  const studioCard = studio.indexOf("<NextStepCard");
  const studioBriefing = studio.indexOf("<ClientBriefing");
  const studioSections = studio.indexOf("{/* ===== SUMMARY TAB ===== */}");
  const studioRail = studio.indexOf('className="deliverable-rail"');
  assert(studioCard > 0, "accountant studio renders NextStepCard");
  assert(studioRail > 0, "studio lists deliverables in a left rail");
  const studioOverview = studio.indexOf('id="pane-overview"');
  assert(studioOverview > 0 && studioOverview < studioCard, "overview pane holds the Next Step");
  assert(
    studioCard < studioBriefing && studioBriefing < studioSections,
    "studio: Next Step and briefing sit in Overview, above Client Brain",
  );
  assert(studio.includes('audience="accountant"'), "studio uses accountant audience");
  assert(
    studio.includes("setFirstDataOpen(true)") && studio.includes("setProfileOpen(true)"),
    "studio CTA opens upload / profile dialogs",
  );
  assert(
    studio.includes("filter: route.search.filter"),
    "studio CTA carries overdue/blocked filter to the plan",
  );

  const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
  const appCard = app.indexOf("<NextStepCard");
  const appTabs = app.indexOf('id="owner-board-tabs"');
  assert(appCard > 0, "owner board renders NextStepCard");
  assert(appCard < appTabs, "owner board: Next Step above the tab strip (health)");
  assert(app.includes('audience="owner"'), "owner board uses owner audience");
  assert(app.includes("effectiveClientId && !sampleMode"), "hidden in sample mode");
  assert(
    app.includes('setFirstRunStep("first-data")') && app.includes("openProfileDialog("),
    "owner CTA opens upload / profile flows",
  );
  assert(
    /validateSearch[\s\S]*OWNER_BOARD_TABS/.test(app),
    "/app accepts ?tab= from Next Step routes",
  );
  assert(app.includes("if (searchTab) setActiveTab(searchTab)"), "/app applies ?tab=");

  const css = readFileSync(resolve("src/styles/primitives.css"), "utf8");
  assert(css.includes(".milon-next-step {"), "card styles present");
  assert(css.includes('.milon-next-step[data-urgency="blocking"]'), "blocking urgency styled");
}

console.log("next-step: all checks passed");
