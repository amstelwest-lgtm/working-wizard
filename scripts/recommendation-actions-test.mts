/**
 * Wire actions to recommendations (P0.7) — the plan shows the parent
 * recommendation, creating tasks from approved recommendations is the default
 * path, chase email is untouched, and GET links still never mutate.
 * Run: pnpm test:recommendation-actions
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toActionItemWrite } from "../src/components/action-plan";
import { isActionable } from "../src/lib/recommendations";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── 1. View exposes the parent; DDL is a clean recreate ──────────────────────

{
  const sql = readFileSync(
    resolve("supabase/migrations/20260918150000_action_items_recommendation_view.sql"),
    "utf8",
  );
  assert(
    sql.includes("DROP VIEW IF EXISTS public.action_items_v;"),
    "view is dropped (ai.* froze its columns)",
  );
  assert(sql.includes("CREATE VIEW public.action_items_v"), "view recreated");
  assert(sql.includes("WITH (security_invoker = true)"), "RLS of underlying tables still applies");
  assert(
    sql.includes("LEFT JOIN public.proposed_next_steps p ON p.id = ai.recommendation_id"),
    "joins the parent recommendation",
  );
  for (const col of [
    "recommendation_title",
    "recommendation_status",
    "recommendation_metric",
    "recommendation_amount",
  ]) {
    assert(sql.includes(`AS ${col}`), `view exposes ${col}`);
  }
  assert(
    sql.includes("e.name  AS owner_name") && sql.includes("AS days_remaining"),
    "original columns preserved",
  );
  assert(!/ALTER TABLE|CREATE TABLE/.test(sql), "view-only migration: no table changes");
}

// ── 2. Plan UI: parent badge, write-stripping, default path ──────────────────

{
  const src = readFileSync(resolve("src/components/action-plan.tsx"), "utf8");

  // View-only columns must never reach an action_items write (PostgREST rejects them).
  const stripped = toActionItemWrite({
    title: "x",
    recommendation_id: "r1",
    recommendation_title: "Parent",
    recommendation_status: "approved",
    recommendation_metric: "cash",
    recommendation_amount: 1000,
    owner_name: "n",
    health: "on_track",
  } as never);
  eq(
    Object.keys(stripped).sort().join(","),
    "recommendation_id,title",
    "FK survives; joined columns stripped",
  );

  assert(src.includes("recommendation_id?: string | null;"), "Item carries recommendation_id");
  assert(src.includes("From recommendation"), "row shows the parent recommendation");
  assert(src.includes("data-drawer-recommendation"), "drawer shows the parent + expected impact");
  assert(
    src.includes("useServerFn(createActionFromRecommendation)"),
    "actions created via the FK-preserving path",
  );
  assert(
    src.includes("isActionable(r) && !r.linked_action_item_id"),
    "pending = approved/edited without an action",
  );
  assert(
    src.includes("Add from recommendations ({pendingRecs.length})"),
    "header offers the default path with a count",
  );
  assert(
    src.includes('variant={pendingRecs.length > 0 ? "outline" : "default"}'),
    "manual add demoted when recommendations wait",
  );
  assert(src.includes("function FromRecommendationsPanel"), "picker dialog exists");
  assert(
    src.includes("new Set(recommendations.map((r) => r.id))"),
    "picker preselects every pending recommendation",
  );
  assert(
    src.includes("pendingRecs.length > 0 ? setRecOpen(true) : quickAddRef.current?.focus()"),
    "empty state routes to recommendations first",
  );
  // Ordering inside the row: recommendation badge takes precedence over the strategic-move badge.
  const recBadge = src.indexOf("From recommendation\n");
  const moveBadge = src.indexOf("From strategic moves");
  assert(
    recBadge > 0 && moveBadge > recBadge,
    "recommendation badge wins over strategic-move badge",
  );

  // Semantics the badge relies on.
  assert(
    isActionable({ status: "approved" }) && isActionable({ status: "edited" }),
    "approved/edited are actionable",
  );
  assert(
    !isActionable({ status: "proposed" }) && !isActionable({ status: "rejected" }),
    "proposed/rejected are not",
  );
}

// ── 3. Recommendation panel and RPC keep the FK ──────────────────────────────

{
  const panel = readFileSync(resolve("src/components/recommendations-panel.tsx"), "utf8");
  assert(
    panel.includes("useServerFn(createActionFromRecommendation)"),
    "recommendation panel uses the same path",
  );
  const fns = readFileSync(resolve("src/lib/recommendations.functions.ts"), "utf8");
  assert(
    fns.includes('rpc("advisory_create_action_from_recommendation"'),
    "server fn calls the RPC",
  );
  const p02 = readFileSync(
    resolve("supabase/migrations/20260918130000_recommendations_outcomes.sql"),
    "utf8",
  );
  assert(
    p02.includes(
      "plan_id, client_id, seq, title, outcome_why, owner_id, due_date, source, recommendation_id",
    ),
    "RPC writes recommendation_id",
  );
  assert(
    p02.includes("advisory_sync_recommendation_link") || p02.includes("linked_action_item_id"),
    "legacy pointer kept in sync",
  );
}

// ── 4. Chase email still works; GET links still do not mutate ────────────────

{
  const fn = readFileSync(resolve("supabase/functions/task-link/index.ts"), "utf8");
  const getStart = fn.indexOf('if (req.method === "GET")');
  const postStart = fn.indexOf('if (req.method === "POST")');
  assert(getStart > 0 && postStart > getStart, "GET branch precedes POST branch");
  const getBody = fn.slice(getStart, postStart);
  assert(!/\.(update|insert|upsert|delete|rpc)\(/.test(getBody), "GET branch performs no writes");
  assert(/A GET must NEVER change data/.test(fn), "scanner-safety rule still documented");

  const route = readFileSync(resolve("src/routes/t.$token.tsx"), "utf8");
  assert(/GET loads read-only/.test(route), "token route: GET read-only");
  assert(
    !/method:\s*"GET"[\s\S]{0,200}(update|insert)/.test(route),
    "no mutation on GET in the route",
  );

  const plan = readFileSync(resolve("src/components/action-plan.tsx"), "utf8");
  assert(plan.includes("sendTransactionalEmail"), "chase / nudge email path untouched");
  assert(
    plan.includes('email_type === "nudge" || e.email_type === "overdue"'),
    "nudge + overdue tracking untouched",
  );
}

console.log("recommendation-actions: all checks passed");
