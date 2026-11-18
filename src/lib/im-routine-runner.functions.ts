/**
 * Thin runner for accepted IM routines — loads maps/actions/runs and enqueues draft runs.
 * No SQL changes. Callable on demand; wire a Vercel cron when ops approve scheduling.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { agentIdempotencyKey, agentInputHash } from "@/lib/agent-bus";
import { handoffDecision, runnerEnabled, AGENT_RUNNERS } from "@/lib/owner-handoff";
import {
  countNewlyEnqueuedRun,
  IM_ACTIVATION_SOURCE,
  type DraftRunEnqueue,
} from "@/lib/im-activation-persist";
import { parseRoutineMapMeta, type RoutineActionRow, type RoutineRunRow } from "@/lib/client-routines";
import {
  imBudgetVarianceThresholdBreached,
  imRoutinePeriodKey,
  planImRoutineEnqueues,
  scheduledRunInputs,
  type ImRoutineEventContext,
} from "@/lib/im-routine-schedule";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55 } from "@/lib/claude-request";
import { computeBudgetMonths, normalizeBudgetDocument } from "@/lib/budget.compute";
import { normalizeTaxonomyTotals } from "@/lib/budget.variance";
import type { BudgetDocument } from "@/lib/budget.types";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  is: (column: string, value: null) => Filter;
  order: (column: string, options: { ascending: boolean }) => Filter;
  limit: (count: number) => Filter;
  maybeSingle: () => Promise<DbResult<Row | null>>;
};

type InsertFilter = {
  select: (columns: string) => { maybeSingle: () => Promise<DbResult<Row | null>> };
};

type Admin = {
  from: (table: string) => {
    select: (columns: string) => Filter;
    insert: (row: Row) => InsertFilter;
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError }>;
};

function admin(): Admin {
  return supabaseAdmin as unknown as Admin;
}

async function assertFirmAccess(userId: string, firmId: string): Promise<void> {
  const db = admin();
  const owned = await db.from("firms").select("id").eq("id", firmId).eq("owner_user_id", userId).maybeSingle();
  if (owned.error) throw new Error(owned.error.message);
  if (owned.data?.id) return;
  const member = await db
    .from("firm_memberships")
    .select("firm_id")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .maybeSingle();
  if (member.error) throw new Error(member.error.message);
  if (!member.data?.firm_id) throw new Error("You do not have access to this firm");
}

async function pilotBooks(clientId: string): Promise<{ hasLedger: boolean; hasUpload: boolean }> {
  const db = admin();
  const [xero, qbo, sage, uploads] = await Promise.all([
    db.from("xero_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("qbo_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("sage_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("client_artifacts").select("id").eq("client_id", clientId).eq("kind", "upload").limit(1).maybeSingle(),
  ]);
  return {
    hasLedger: Boolean(xero.data?.id || qbo.data?.id || sage.data?.id),
    hasUpload: Boolean(uploads.data?.id),
  };
}

async function loadBudgetDriftFlags(clientId: string, periodKey: string): Promise<{
  actualsLanded: boolean;
  varianceBreached: boolean;
  periodOnFile: boolean;
}> {
  const db = admin();
  const actuals = await db
    .from("budget_month_actuals")
    .select("totals, status, month")
    .eq("client_id", clientId)
    .eq("month", periodKey)
    .eq("status", "confirmed")
    .limit(1)
    .maybeSingle();
  const actualsLanded = Boolean(actuals.data?.totals);
  if (!actualsLanded) return { actualsLanded: false, varianceBreached: false, periodOnFile: false };

  const artifact = await db
    .from("client_artifacts")
    .select("meta")
    .eq("client_id", clientId)
    .eq("kind", "budget")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const raw = artifact.data?.meta;
  if (!raw || typeof raw !== "object") {
    return { actualsLanded, varianceBreached: false, periodOnFile: true };
  }
  try {
    const doc = normalizeBudgetDocument(raw as BudgetDocument);
    const months = computeBudgetMonths(doc, doc.activeScenario);
    const monthRow = months.find((row) => row.month === periodKey);
    if (!monthRow) return { actualsLanded, varianceBreached: false, periodOnFile: true };
    const totals = normalizeTaxonomyTotals(actuals.data?.totals as Record<string, unknown>);
    const breached = imBudgetVarianceThresholdBreached(monthRow, totals);
    return { actualsLanded, varianceBreached: breached, periodOnFile: true };
  } catch {
    return { actualsLanded, varianceBreached: false, periodOnFile: true };
  }
}

async function enqueueScheduledDraftRun(input: {
  agent: "financial_manager" | "analyst" | "advisor";
  clientId: string;
  firmId: string;
  actionItemId: string;
  periodKey: string;
}): Promise<DraftRunEnqueue | null> {
  const decision = handoffDecision(input.agent);
  if (!decision.ok) return null;
  const db = admin();
  const setting = await db.from("agent_settings").select("value").eq("key", decision.settingKey).maybeSingle();
  if (setting.error || !runnerEnabled(setting.data?.value)) return null;

  const inputs = scheduledRunInputs(input.actionItemId, input.periodKey);
  const idempotencyKey = await agentIdempotencyKey({
    agent: input.agent,
    clientId: input.clientId,
    trigger: "on_demand",
    inputs,
  });
  const inputHash = await agentInputHash(inputs);
  const correlationId = crypto.randomUUID();
  const inserted = await db
    .from("agent_runs")
    .insert({
      agent: input.agent,
      client_id: input.clientId,
      firm_id: input.firmId,
      trigger: "on_demand",
      audience: "accountant",
      idempotency_key: idempotencyKey,
      input_hash: inputHash,
      correlation_id: correlationId,
      status: "queued",
      action_item_id: input.actionItemId,
      attempt: 1,
      summary: "Implementation Manager routine — draft only.",
      trace: [
        {
          tool: "im_routine_scheduler",
          label: `Queued for period ${input.periodKey}`,
          status: "queued",
          im_design_model: CLAUDE_OPUS_55,
          im_execution_model: CLAUDE_SONNET_55,
        },
      ],
    })
    .select("id")
    .maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const found = await db
        .from("agent_runs")
        .select("id")
        .eq("agent", input.agent)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      const runId = typeof found.data?.id === "string" ? found.data.id : null;
      return runId ? { runId, created: false } : null;
    }
    throw new Error(inserted.error.message);
  }
  const runId = typeof inserted.data?.id === "string" ? inserted.data.id : null;
  if (!runId) return null;
  const runner = AGENT_RUNNERS[input.agent];
  const invoke = await db.rpc("agent_invoke", {
    p_function: runner,
    p_body: {
      client_id: input.clientId,
      trigger: "on_demand",
      inputs,
      correlation_id: correlationId,
    },
  });
  if (invoke.error) console.warn("im_routine_scheduler agent_invoke", invoke.error.message);
  return { runId, created: true };
}

export const runImRoutineScheduler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firmId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const db = admin();
    const clientRows = data.clientId
      ? { data: [{ id: data.clientId }], error: null }
      : await (db
          .from("clients")
          .select("id")
          .eq("firm_id", data.firmId)
          .order("created_at", { ascending: true })
          .limit(40) as unknown as Promise<{ data: Row[] | null; error: DbError }>);
    if (clientRows.error) throw new Error(clientRows.error.message);
    const clients = clientRows.data ?? [];

    const now = new Date();
    const periodKey = imRoutinePeriodKey(now);
    let enqueued = 0;

    for (const row of clients) {
      const clientId = typeof row.id === "string" ? row.id : "";
      if (!clientId) continue;
      const books = await pilotBooks(clientId);
      const drift = await loadBudgetDriftFlags(clientId, periodKey);
      const scheduleContext: ImRoutineEventContext = {
        ...books,
        now,
        periodOnFile: drift.periodOnFile || books.hasLedger,
        actualsLanded: drift.actualsLanded,
        varianceBreached: drift.varianceBreached,
        documentUploaded: books.hasUpload,
        cashCollectionsRisk: books.hasLedger,
      };

      const artifacts = await (db
        .from("client_artifacts")
        .select("meta")
        .eq("client_id", clientId)
        .eq("kind", "routine_map")
        .limit(12) as unknown as Promise<{ data: Row[] | null; error: DbError }>);
      if (artifacts.error) continue;
      const metas = (artifacts.data ?? [])
        .map((artifact) => parseRoutineMapMeta(artifact.meta))
        .filter((meta): meta is NonNullable<typeof meta> => Boolean(meta?.accepted_at));

      const actionsRes = await (db
        .from("action_items")
        .select("id, title, status, source_move_key, sent_at, driver_key")
        .eq("client_id", clientId)
        .eq("driver_key", IM_ACTIVATION_SOURCE)
        .limit(120) as unknown as Promise<{ data: RoutineActionRow[] | null; error: DbError }>);
      if (actionsRes.error) continue;
      const actions = actionsRes.data ?? [];

      const runsRes = await (db
        .from("agent_runs")
        .select("id, agent, status, action_item_id, started_at, finished_at, queued_at")
        .eq("client_id", clientId)
        .order("queued_at", { ascending: false })
        .limit(80) as unknown as Promise<{ data: RoutineRunRow[] | null; error: DbError }>);
      if (runsRes.error) continue;
      const runs = runsRes.data ?? [];

      for (const meta of metas) {
        const plan = planImRoutineEnqueues({
          firmId: data.firmId,
          clientId,
          meta,
          actions,
          runs,
          context: scheduleContext,
          now,
        });
        for (const row of plan) {
          const actionItem = actions.find((action) => action.source_move_key === row.actionMoveKey);
          if (!actionItem?.id) continue;
          const result = await enqueueScheduledDraftRun({
            agent: row.agent,
            clientId,
            firmId: data.firmId,
            actionItemId: actionItem.id,
            periodKey: row.periodKey,
          });
          enqueued += countNewlyEnqueuedRun(result);
        }
      }
    }

    return { ok: true as const, enqueued, periodKey };
  });