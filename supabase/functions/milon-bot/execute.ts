/**
 * Runs one allowlisted Milonbot tool against the caller's Supabase client.
 * Writes go through the existing recommendation RPC and action-plan RLS.
 * p_approve is always false. Nothing here sends email.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentAudience, AgentToolName } from "./agent.ts";
import { resolveRatioRecord } from "../ask-ai/derive-ratios.ts";
import {
  buildOverviewBrief,
  copyPackFromMarket,
  overviewFactLines,
} from "../ask-ai/overview-brief.ts";
import { buildBlockers, buildBrainAnswer, buildInviteStatus, numericRatios } from "./logic.ts";
import {
  coerceAdvisoryState,
  shapeAdvisoryPosition,
  shapeCash,
  shapeCompany,
  shapeDataRequests,
  shapeHealth,
  shapeHistory,
  shapeOutcomes,
  shapeRecommendations,
  shapeSnapshot,
  shapeTasks,
} from "./tools.ts";
import type { AdvisoryFacts } from "../../../src/lib/advisory-state.ts";
import {
  assessClientMetrics,
  persistedRunwayWeeks,
  runwayDisplayLabel,
} from "../../../src/lib/client-metrics.ts";
import type { NextStepFacts } from "../../../src/lib/next-step.ts";

type Ctx = {
  clientId: string;
  userId: string;
  token: string;
  audience: AgentAudience;
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function countRows(
  client: SupabaseClient,
  table: string,
  clientId: string,
  apply?: (q: ReturnType<SupabaseClient["from"]>) => ReturnType<SupabaseClient["from"]>,
): Promise<number> {
  let q = client.from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (apply) q = apply(q);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

async function canWritePlan(ctx: Ctx): Promise<boolean> {
  const { data, error } = await ctx.userClient.rpc("is_action_plan_writer", {
    _user_id: ctx.userId,
    _client_id: ctx.clientId,
  });
  if (error) return false;
  return data === true;
}

function dueDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

async function createTask(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  const recommendationId =
    typeof args.recommendationId === "string" ? args.recommendationId.trim() : "";
  if (!recommendationId) {
    return { error: "recommendationId is required", created: false, verified: false };
  }
  if (!(await canWritePlan(ctx))) {
    return {
      error: "This seat can read the client but cannot change the action plan.",
      created: false,
      verified: false,
      needs_human: true,
    };
  }
  const { data, error } = await ctx.userClient.rpc("advisory_create_action_from_recommendation", {
    p_recommendation_id: recommendationId,
    p_title: typeof args.title === "string" ? args.title : null,
    p_due_date: dueDate(args.dueDate),
    p_owner_id: null,
    p_approve: false,
  });
  if (error) {
    const message = error.message || "Could not create the task";
    const needsHuman = /must be approved/i.test(message);
    return {
      error: message,
      created: false,
      verified: false,
      needs_human: needsHuman,
      recommendation_id: recommendationId,
    };
  }
  const actionItemId = typeof data === "string" ? data : "";
  if (!actionItemId) {
    return { error: "The task RPC returned no id", created: false, verified: false };
  }
  const { data: row, error: readErr } = await ctx.userClient
    .from("action_items")
    .select("id, title, status, recommendation_id, client_id")
    .eq("id", actionItemId)
    .eq("client_id", ctx.clientId)
    .maybeSingle();
  if (readErr || !row) {
    return {
      error: readErr?.message || "The task id came back but the row was not readable.",
      created: false,
      verified: false,
      action_item_id: actionItemId,
    };
  }
  return {
    created: true,
    verified: true,
    action_item_id: row.id,
    title: row.title,
    status: row.status,
    recommendation_id: row.recommendation_id,
  };
}

async function assignTask(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  const actionItemId = typeof args.actionItemId === "string" ? args.actionItemId.trim() : "";
  const employeeId = typeof args.employeeId === "string" ? args.employeeId.trim() : "";
  if (!actionItemId || !employeeId) {
    return { error: "actionItemId and employeeId are required", assigned: false, verified: false };
  }
  if (!(await canWritePlan(ctx))) {
    return {
      error: "This seat can read the client but cannot change the action plan.",
      assigned: false,
      verified: false,
      needs_human: true,
    };
  }
  const { data: person, error: personErr } = await ctx.userClient
    .from("client_employees")
    .select("id, name")
    .eq("id", employeeId)
    .eq("client_id", ctx.clientId)
    .eq("active", true)
    .maybeSingle();
  if (personErr) return { error: personErr.message, assigned: false, verified: false };
  if (!person) {
    return {
      error: "That person is not an active member of this client.",
      assigned: false,
      verified: false,
    };
  }
  const { data: before, error: beforeErr } = await ctx.userClient
    .from("action_items")
    .select("id, owner_id, sent_at")
    .eq("id", actionItemId)
    .eq("client_id", ctx.clientId)
    .maybeSingle();
  if (beforeErr) return { error: beforeErr.message, assigned: false, verified: false };
  if (!before) return { error: "Task not found", assigned: false, verified: false };

  const { data: after, error: updErr } = await ctx.userClient
    .from("action_items")
    .update({ owner_id: employeeId })
    .eq("id", actionItemId)
    .eq("client_id", ctx.clientId)
    .select("id, owner_id, sent_at")
    .maybeSingle();
  if (updErr || !after || after.owner_id !== employeeId) {
    return {
      error: updErr?.message || "Assignment did not stick.",
      assigned: false,
      verified: false,
    };
  }
  return {
    assigned: true,
    verified: true,
    action_item_id: after.id,
    owner_id: after.owner_id,
    owner_name: person.name,
    emailed: false,
    sent_at_unchanged: after.sent_at === before.sent_at,
  };
}

async function advisoryPosition(ctx: Ctx): Promise<unknown> {
  const now = new Date().toISOString();
  const today = todayIso();
  const [
    clientRes,
    proposed,
    approved,
    approvedNoAction,
    openActions,
    doneActions,
    overdue,
    blocked,
    openQuestions,
    openData,
    outcomeRows,
    packRes,
    snapCount,
  ] = await Promise.all([
    ctx.userClient
      .from("clients")
      .select(
        "advisory_state, firm_id, operating_profile, financials, cashflow, cash_runway_weeks, next_review_at",
      )
      .eq("id", ctx.clientId)
      .maybeSingle(),
    countRows(ctx.userClient, "proposed_next_steps", ctx.clientId, (q) =>
      q.eq("status", "proposed"),
    ),
    countRows(ctx.userClient, "proposed_next_steps", ctx.clientId, (q) =>
      q.in("status", ["approved", "edited"]),
    ),
    countRows(ctx.userClient, "proposed_next_steps", ctx.clientId, (q) =>
      q.in("status", ["approved", "edited"]).is("linked_action_item_id", null),
    ),
    countRows(ctx.userClient, "action_items", ctx.clientId, (q) => q.neq("status", "done")),
    countRows(ctx.userClient, "action_items", ctx.clientId, (q) => q.eq("status", "done")),
    countRows(ctx.userClient, "action_items", ctx.clientId, (q) =>
      q.neq("status", "done").lt("due_date", today),
    ),
    countRows(ctx.userClient, "action_items", ctx.clientId, (q) => q.eq("status", "blocked")),
    countRows(ctx.userClient, "client_brain_questions", ctx.clientId, (q) =>
      q.eq("status", "unanswered").in("audience", [ctx.audience, "both"]),
    ),
    countRows(ctx.userClient, "data_requests", ctx.clientId, (q) =>
      q.in("status", ["open", "sent"]),
    ),
    ctx.userClient
      .from("recommendation_outcomes")
      .select("recommendation_id")
      .eq("client_id", ctx.clientId)
      .limit(200),
    ctx.userClient
      .from("advisory_packs")
      .select("status, version, requires_review, delivered_at")
      .eq("client_id", ctx.clientId)
      .neq("status", "superseded")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    countRows(ctx.userClient, "client_financial_snapshots", ctx.clientId),
  ]);

  const client = clientRes.data;
  const hasForecast = Boolean(client?.cashflow) || typeof client?.cash_runway_weeks === "number";
  const factsForInfer: AdvisoryFacts = {
    hasFirm: Boolean(client?.firm_id),
    hasProfile: Boolean(client?.operating_profile),
    hasFinancials: Boolean(client?.financials) || snapCount > 0,
    hasSnapshot: snapCount > 0,
    hasForecast,
    proposedSteps: proposed,
    approvedSteps: approved,
    openActions,
    doneActions,
  };
  const state = coerceAdvisoryState(
    (client?.advisory_state as string | null) ?? null,
    factsForInfer,
  );
  const measured = new Set(
    ((outcomeRows.data ?? []) as Array<{ recommendation_id?: string }>).map(
      (r) => r.recommendation_id,
    ),
  );
  const actioned = await ctx.userClient
    .from("proposed_next_steps")
    .select("id")
    .eq("client_id", ctx.clientId)
    .in("status", ["approved", "edited"])
    .not("linked_action_item_id", "is", null)
    .limit(100);
  const actionedUnmeasured = ((actioned.data ?? []) as Array<{ id: string }>).filter(
    (row) => !measured.has(row.id),
  ).length;
  const pack = packRes.data;
  const packStatus = pack && typeof pack.status === "string" ? pack.status : null;
  const facts: NextStepFacts = {
    clientId: ctx.clientId,
    state,
    stateSource: client?.advisory_state ? "persisted" : "derived",
    hasFirm: factsForInfer.hasFirm,
    hasProfile: factsForInfer.hasProfile,
    hasFinancials: factsForInfer.hasFinancials,
    hasSnapshot: factsForInfer.hasSnapshot,
    hasForecast,
    openQuestions,
    proposedRecommendations: proposed,
    approvedWithoutAction: approvedNoAction,
    openActions,
    overdueActions: overdue,
    blockedActions: blocked,
    actionedUnmeasured,
    openDataRequests: openData,
    packStatus:
      packStatus === "draft" ||
      packStatus === "in_review" ||
      packStatus === "changes_requested" ||
      packStatus === "approved" ||
      packStatus === "rejected"
        ? packStatus
        : null,
    packVersion: typeof pack?.version === "number" ? pack.version : null,
    packRequiresReview: pack?.requires_review === true,
    packDelivered: Boolean(pack?.delivered_at),
    nextReviewAt: (client?.next_review_at as string | null) ?? null,
    now,
  };
  return shapeAdvisoryPosition(facts, ctx.audience);
}

async function invokeExisting(
  name: "brain-propose" | "brain-deliverable-draft",
  ctx: Ctx,
): Promise<unknown> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.token}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ clientId: ctx.clientId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = typeof body?.error === "string" ? body.error : `${name} failed (${res.status})`;
    return { error: err };
  }
  return body;
}

export async function executeAgentTool(
  name: AgentToolName,
  args: Record<string, unknown>,
  ctx: Ctx,
): Promise<unknown> {
  if (name === "get_company") {
    const [clientRes, peopleRes] = await Promise.all([
      ctx.userClient
        .from("clients")
        .select(
          "name, business_type, advisory_state, firm_id, financials, cashflow, financials_updated_at",
        )
        .eq("id", ctx.clientId)
        .maybeSingle(),
      ctx.userClient
        .from("client_employees")
        .select("id, name, role")
        .eq("client_id", ctx.clientId)
        .eq("active", true)
        .order("name")
        .limit(20),
    ]);
    const client = clientRes.data;
    const companyMetrics = assessClientMetrics({
      financials:
        client?.financials && typeof client.financials === "object"
          ? (client.financials as Record<string, unknown>)
          : null,
      cashflow: client?.cashflow,
      financialsUpdatedAt: (client?.financials_updated_at as string | null) ?? null,
    });
    return shapeCompany({
      name: (client?.name as string | null) ?? null,
      businessType: (client?.business_type as string | null) ?? null,
      advisoryState: (client?.advisory_state as string | null) ?? null,
      hasFirm: Boolean(client?.firm_id),
      cashRunwayWeeks: persistedRunwayWeeks(companyMetrics.runway),
      people: (peopleRes.data ?? []) as Array<{ id: string; name: string; role: string | null }>,
    });
  }

  if (name === "get_financial_snapshot" || name === "get_health") {
    const [snapRes, clientRes] = await Promise.all([
      ctx.userClient
        .from("client_financial_snapshots")
        .select("period_label, period_date, ratios, financials")
        .eq("client_id", ctx.clientId)
        .order("period_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      ctx.userClient
        .from("clients")
        .select("name, market, financials, cashflow, financials_updated_at, brain_summary")
        .eq("id", ctx.clientId)
        .maybeSingle(),
    ]);
    const snap = snapRes.data;
    const liveFinancials =
      clientRes.data?.financials && typeof clientRes.data.financials === "object"
        ? (clientRes.data.financials as Record<string, unknown>)
        : null;
    const healthMetrics = assessClientMetrics({
      financials: liveFinancials,
      cashflow: clientRes.data?.cashflow,
      financialsUpdatedAt: (clientRes.data?.financials_updated_at as string | null) ?? null,
    });
    const runway = persistedRunwayWeeks(healthMetrics.runway);
    if (name === "get_health") {
      const resolved = resolveRatioRecord(
        (snap?.ratios ?? null) as Record<string, unknown> | null,
        (snap?.financials ?? liveFinancials) as Record<string, unknown> | null,
      );
      const copyPack = copyPackFromMarket(clientRes.data?.market);
      const brief = buildOverviewBrief({
        financials: liveFinancials,
        ratios: resolved,
        runwayWeeks: runway,
        runwayLabel: runwayDisplayLabel(healthMetrics.runway),
        cash: healthMetrics.cash.amount,
        copyPack,
        clientName: typeof clientRes.data?.name === "string" ? clientRes.data.name : null,
        brainSummary: clientRes.data?.brain_summary ?? null,
        periodLabel: (snap?.period_label as string | null) ?? null,
        figuresAsOf: (snap?.period_date as string | null) ?? null,
      });
      const shaped = shapeHealth(resolved, runway, copyPack);
      return {
        ...shaped,
        overall: brief.health,
        health_label: brief.healthLabel,
        pillars: brief.pillars.map((p) => ({ id: p.id, label: p.label, score: p.score })),
        weakest: brief.weakest,
        cash_on_file: brief.cash,
        revenue: brief.revenue,
        creditor_days: brief.creditorDays,
        debtor_days: brief.debtorDays,
        gross_margin: brief.grossMargin,
        operating_margin: brief.operatingMargin,
        net_margin: brief.netMargin,
        overview_lines: overviewFactLines(brief),
      };
    }
    return shapeSnapshot({
      periodLabel: (snap?.period_label as string | null) ?? null,
      periodDate: (snap?.period_date as string | null) ?? null,
      ratios: snap?.ratios,
      financials: snap?.financials ?? clientRes.data?.financials,
      cashRunwayWeeks: runway,
    });
  }

  if (name === "get_cash_flow") {
    const { data } = await ctx.userClient
      .from("clients")
      .select("cashflow, cash_runway_weeks, financials, financials_updated_at")
      .eq("id", ctx.clientId)
      .maybeSingle();
    const financials = (data?.financials ?? null) as Record<string, unknown> | null;
    const metrics = assessClientMetrics({
      financials,
      cashflow: data?.cashflow,
      financialsUpdatedAt: (data?.financials_updated_at as string | null) ?? null,
    });
    return shapeCash(data?.cashflow, persistedRunwayWeeks(metrics.runway), {
      financials,
      openingCash: metrics.cash.amount,
      runway: metrics.runway,
      periodEnd: typeof financials?.periodEnd === "string" ? financials.periodEnd : null,
    });
  }

  if (name === "get_statement_history") {
    const { data } = await ctx.userClient
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", ctx.clientId)
      .order("period_date", { ascending: false })
      .limit(6);
    return shapeHistory(
      (data ?? []) as Array<{
        period_label: string | null;
        period_date: string | null;
        ratios: unknown;
      }>,
    );
  }

  if (name === "list_recommendations") {
    const { data, error } = await ctx.userClient
      .from("proposed_next_steps")
      .select(
        "id, title, status, priority, problem, confidence, expected_impact_metric, expected_impact_amount, linked_action_item_id, data_depth",
      )
      .eq("client_id", ctx.clientId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) return { error: error.message };
    return shapeRecommendations((data ?? []) as Array<Record<string, unknown>>);
  }

  if (name === "list_prior_outcomes") {
    const { data, error } = await ctx.userClient
      .from("recommendation_outcomes")
      .select(
        "recommendation_id, metric, expected_amount, actual_amount, variance_amount, period_label, measured_at",
      )
      .eq("client_id", ctx.clientId)
      .order("measured_at", { ascending: false })
      .limit(8);
    if (error) return { error: error.message };
    return shapeOutcomes((data ?? []) as Array<Record<string, unknown>>);
  }

  if (name === "list_tasks") {
    const [planRes, itemRes] = await Promise.all([
      ctx.userClient
        .from("action_plans")
        .select("outcome_goal")
        .eq("client_id", ctx.clientId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      ctx.userClient
        .from("action_items_v")
        .select("id, title, status, due_date, owner_id, owner_name, recommendation_id")
        .eq("client_id", ctx.clientId)
        .order("seq", { ascending: true })
        .limit(40),
    ]);
    if (itemRes.error) return { error: itemRes.error.message };
    return shapeTasks({
      outcomeGoal: (planRes.data?.outcome_goal as string | null) ?? null,
      items: (itemRes.data ?? []) as Array<Record<string, unknown>>,
    });
  }

  if (name === "list_data_requests") {
    const { data, error } = await ctx.userClient
      .from("data_requests")
      .select("id, kind, severity, status, title, reason")
      .eq("client_id", ctx.clientId)
      .in("status", ["open", "sent"])
      .order("requested_at", { ascending: false })
      .limit(10);
    if (error) return { error: error.message };
    return shapeDataRequests((data ?? []) as Array<Record<string, unknown>>);
  }

  if (name === "get_advisory_position") return advisoryPosition(ctx);

  if (name === "list_blockers") {
    const { data } = await ctx.userClient
      .from("client_brain_questions")
      .select("question_key, prompt_text, audience, last_asked_at")
      .eq("client_id", ctx.clientId)
      .eq("status", "unanswered")
      .order("created_at", { ascending: false })
      .limit(40);
    return buildBlockers(
      (data ?? []) as Array<{
        question_key: string;
        prompt_text: string | null;
        audience: string;
        last_asked_at: string | null;
      }>,
    );
  }

  if (name === "get_invite_status") {
    const [clientRes, inviteRes] = await Promise.all([
      ctx.userClient.from("clients").select("owner_user_id").eq("id", ctx.clientId).maybeSingle(),
      ctx.adminClient
        .from("invite_tokens")
        .select("purpose, created_at, expires_at, redeemed_at")
        .eq("client_id", ctx.clientId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    return buildInviteStatus({
      ownerUserId: (clientRes.data?.owner_user_id as string | null) ?? null,
      invites: (inviteRes.data ?? []) as Array<{
        purpose: string;
        created_at: string;
        expires_at: string;
        redeemed_at: string | null;
      }>,
    });
  }

  if (name === "answer_from_brain") {
    const topic = typeof args.topic === "string" ? args.topic.trim().toLowerCase() : "";
    const [factRes, clientRes, snapRes] = await Promise.all([
      ctx.userClient
        .from("context_facts")
        .select("fact_text, category")
        .eq("client_id", ctx.clientId)
        .is("superseded_by", null)
        .order("created_at", { ascending: false })
        .limit(30),
      ctx.userClient
        .from("clients")
        .select("brain_summary, financials, cashflow, financials_updated_at")
        .eq("id", ctx.clientId)
        .maybeSingle(),
      ctx.userClient
        .from("client_financial_snapshots")
        .select("period_label, period_date, ratios")
        .eq("client_id", ctx.clientId)
        .order("period_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    let facts = (factRes.data ?? []) as Array<{ fact_text: string; category: string | null }>;
    if (topic) {
      const filtered = facts.filter(
        (f) =>
          f.fact_text.toLowerCase().includes(topic) ||
          (f.category ?? "").toLowerCase().includes(topic),
      );
      if (filtered.length) facts = filtered;
    }
    const snap = snapRes.data;
    const brainMetrics = assessClientMetrics({
      financials:
        clientRes.data?.financials && typeof clientRes.data.financials === "object"
          ? (clientRes.data.financials as Record<string, unknown>)
          : null,
      cashflow: clientRes.data?.cashflow,
      financialsUpdatedAt: (clientRes.data?.financials_updated_at as string | null) ?? null,
    });
    const cash = persistedRunwayWeeks(brainMetrics.runway);
    return buildBrainAnswer({
      facts,
      brainSummary: clientRes.data?.brain_summary ?? null,
      financials: snap
        ? {
            period_label:
              (snap.period_label as string | null) ?? (snap.period_date as string | null) ?? null,
            ratios: numericRatios(snap.ratios),
            cash_runway_weeks: cash,
          }
        : cash != null
          ? { period_label: null, ratios: {}, cash_runway_weeks: cash }
          : null,
    });
  }

  if (name === "propose_next_steps") return invokeExisting("brain-propose", ctx);
  if (name === "draft_deliverable") return invokeExisting("brain-deliverable-draft", ctx);
  if (name === "create_task_from_recommendation") return createTask(ctx, args);
  if (name === "assign_task") return assignTask(ctx, args);

  return { error: "Tool is not executable", empty: true };
}
