/**
 * Shared IM routine scheduler — service role only. Used by manual server fn and Vercel cron.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { agentIdempotencyKey, agentInputHash } from "@/lib/agent-bus";
import { handoffDecision, runnerEnabled, AGENT_RUNNERS } from "@/lib/owner-handoff";
import {
  countNewlyEnqueuedRun,
  imRoutineMapArtifactFilter,
  IM_ACTIVATION_SOURCE,
  type DraftRunEnqueue,
} from "@/lib/im-activation-persist";
import { parseRoutineMapMeta, type RoutineActionRow, type RoutineRunRow } from "@/lib/client-routines";
import {
  imBudgetVarianceThresholdBreached,
  imRoutinePeriodKey,
  countImRoutineStubSkips,
  planImRoutineEnqueues,
  scheduledRunInputs,
  type ImRoutineEventContext,
  IM_ROUTINE_TIME_ZONE,
  runStampInRoutinePeriod,
} from "@/lib/im-routine-schedule";
import { CLAUDE_SONNET_55, isClaudeOpus55 } from "@/lib/claude-request";
import { computeBudgetMonths, normalizeBudgetDocument } from "@/lib/budget.compute";
import { normalizeTaxonomyTotals } from "@/lib/budget.variance";
import type { BudgetDocument } from "@/lib/budget.types";
import {
  calendarMonthBounds,
  timeZoneCalendarDayUtcBounds,
  timeZoneMonthStartUtcIso,
} from "@/lib/statement-period";
import { imCashCollectionsRiskFromFinancials } from "@/lib/im-routine-signals";
import { imTaxDeadlineApproaching } from "@/lib/im-routine-tax-deadlines";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  or: (filters: string) => Filter;
  is: (column: string, value: null) => Filter;
  not: (column: string, operator: string, value: string) => Filter;
  order: (column: string, options: { ascending: boolean }) => Filter;
  limit: (count: number) => Filter;
  range: (from: number, to: number) => Filter;
  gte: (column: string, value: string) => Filter;
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

export type ImRoutineSchedulerCounts = {
  firmsScanned: number;
  due: number;
  invoked: number;
  skipped_idempotent: number;
  skipped_cap: number;
  skipped_stub_signal: number;
  skipped_unaccepted: number;
};

export function emptyImRoutineSchedulerCounts(): ImRoutineSchedulerCounts {
  return {
    firmsScanned: 0,
    due: 0,
    invoked: 0,
    skipped_idempotent: 0,
    skipped_cap: 0,
    skipped_stub_signal: 0,
    skipped_unaccepted: 0,
  };
}

export async function assertClientBelongsToFirm(clientId: string, firmId: string): Promise<void> {
  const db = admin();
  const row = await db.from("clients").select("firm_id").eq("id", clientId).maybeSingle();
  if (row.error) throw new Error(row.error.message);
  if (row.data?.firm_id !== firmId) throw new Error("Client does not belong to this firm");
}

async function pilotBooks(clientId: string, now: Date): Promise<{ hasLedger: boolean; hasUpload: boolean }> {
  const db = admin();
  const { from: periodStart } = calendarMonthBounds(now, 0, IM_ROUTINE_TIME_ZONE);
  const uploadSince = timeZoneMonthStartUtcIso(periodStart, IM_ROUTINE_TIME_ZONE);
  const [xero, qbo, sage, uploads] = await Promise.all([
    db.from("xero_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("qbo_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("sage_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db
      .from("client_artifacts")
      .select("id")
      .eq("client_id", clientId)
      .eq("kind", "upload")
      .gte("created_at", uploadSince)
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    hasLedger: Boolean(xero.data?.id || qbo.data?.id || sage.data?.id),
    hasUpload: Boolean(uploads.data?.id),
  };
}

async function loadClientBooksRow(
  clientId: string,
): Promise<{ financials: unknown; operating_profile: unknown }> {
  const db = admin();
  const row = await db
    .from("clients")
    .select("financials, operating_profile")
    .eq("id", clientId)
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return {
    financials: row.data?.financials ?? null,
    operating_profile: row.data?.operating_profile ?? null,
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

export async function loadImRoutineScheduleContext(clientId: string, now = new Date()): Promise<ImRoutineEventContext> {
  const periodKey = imRoutinePeriodKey(now);
  const books = await pilotBooks(clientId, now);
  const drift = await loadBudgetDriftFlags(clientId, periodKey);
  const booksRow = await loadClientBooksRow(clientId);
  const cashCollectionsRisk = imCashCollectionsRiskFromFinancials(booksRow.financials);
  const taxDeadlineApproaching = imTaxDeadlineApproaching(now, booksRow.operating_profile);
  return {
    ...books,
    now,
    periodOnFile: drift.periodOnFile || books.hasLedger,
    actualsLanded: drift.actualsLanded,
    varianceBreached: drift.varianceBreached,
    documentUploaded: books.hasUpload,
    cashCollectionsRisk,
    taxDeadlineApproaching,
  };
}

export async function countFirmRoutineInvokesToday(firmId: string, now: Date): Promise<number> {
  const db = admin();
  const { startIso, endIso } = timeZoneCalendarDayUtcBounds(now, IM_ROUTINE_TIME_ZONE);
  const res = await (db
    .from("agent_runs")
    .select("id, summary")
    .eq("firm_id", firmId)
    .gte("queued_at", startIso)
    .lt("queued_at", endIso)
    .limit(200) as unknown as Promise<{ data: Row[] | null; error: DbError }>);
  if (res.error) return 0;
  return (res.data ?? []).filter((row) => {
    const summary = typeof row.summary === "string" ? row.summary : "";
    return summary.includes("Implementation Manager routine");
  }).length;
}

async function enqueueScheduledDraftRun(input: {
  agent: "financial_manager" | "analyst" | "advisor";
  clientId: string;
  firmId: string;
  actionItemId: string;
  periodKey: string;
  botOwner?: string;
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
  const traceModel = CLAUDE_SONNET_55;
  if (isClaudeOpus55(traceModel)) throw new Error("IM routine runs must not use Opus");

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
      summary: input.botOwner?.toLowerCase().includes("tax")
        ? "Implementation Manager routine — draft for review."
        : "Implementation Manager routine — draft only.",
      trace: [
        {
          tool: "im_routine_scheduler",
          label: `Queued for period ${input.periodKey}`,
          status: "queued",
          im_execution_model: CLAUDE_SONNET_55,
          ...(input.botOwner?.toLowerCase().includes("tax")
            ? { im_routine_owner: "Tax Specialist", no_sars: true }
            : {}),
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

export type RunImRoutineSchedulerInput = {
  firmId: string;
  clientId?: string;
  maxInvokes?: number;
  firmDailyCap?: number;
  counts?: ImRoutineSchedulerCounts;
};

export async function runImRoutineSchedulerCore(
  input: RunImRoutineSchedulerInput,
): Promise<{ ok: true; enqueued: number; periodKey: string; counts: ImRoutineSchedulerCounts }> {
  const counts = input.counts ?? emptyImRoutineSchedulerCounts();
  counts.firmsScanned += 1;

  if (input.clientId) {
    await assertClientBelongsToFirm(input.clientId, input.firmId);
  }

  const db = admin();
  const clientRows = input.clientId
    ? { data: [{ id: input.clientId }], error: null }
    : await (db
        .from("clients")
        .select("id")
        .eq("firm_id", input.firmId)
        .order("created_at", { ascending: true })
        .limit(40) as unknown as Promise<{ data: Row[] | null; error: DbError }>);
  if (clientRows.error) throw new Error(clientRows.error.message);
  const clients = clientRows.data ?? [];

  const now = new Date();
  const periodKey = imRoutinePeriodKey(now);
  let enqueued = 0;
  let invokesLeft = input.maxInvokes ?? Number.POSITIVE_INFINITY;
  const firmDailyCap = input.firmDailyCap;
  let firmInvokesToday =
    firmDailyCap != null ? await countFirmRoutineInvokesToday(input.firmId, now) : 0;

  for (const row of clients) {
    const clientId = typeof row.id === "string" ? row.id : "";
    if (!clientId) continue;
    const scheduleContext = await loadImRoutineScheduleContext(clientId, now);

    const artifacts = await (db
      .from("client_artifacts")
      .select("meta")
      .eq("client_id", clientId)
      .or(imRoutineMapArtifactFilter())
      .limit(12) as unknown as Promise<{ data: Row[] | null; error: DbError }>);
    if (artifacts.error) continue;
    const metas = (artifacts.data ?? [])
      .map((artifact) => parseRoutineMapMeta(artifact.meta))
      .filter((meta): meta is NonNullable<typeof meta> => Boolean(meta));

    const acceptedMetas = metas.filter((meta) => meta.accepted_at);
    counts.skipped_unaccepted += metas.length - acceptedMetas.length;
    if (!acceptedMetas.length) continue;

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

    for (const meta of acceptedMetas) {
      counts.skipped_stub_signal += countImRoutineStubSkips({
        firmId: input.firmId,
        clientId,
        meta,
        actions,
        runs,
        context: scheduleContext,
        now,
      });
      const plan = planImRoutineEnqueues({
        firmId: input.firmId,
        clientId,
        meta,
        actions,
        runs,
        context: scheduleContext,
        now,
      });
      for (const row of plan) {
        counts.due += 1;
        if (invokesLeft <= 0) {
          counts.skipped_cap += 1;
          continue;
        }
        if (firmDailyCap != null && firmInvokesToday >= firmDailyCap) {
          counts.skipped_cap += 1;
          continue;
        }
        const actionItem = actions.find((action) => action.source_move_key === row.actionMoveKey);
        if (!actionItem?.id) continue;
        const already = runs.some(
          (run) =>
            run.action_item_id === actionItem.id &&
            runStampInRoutinePeriod(run.queued_at, row.periodKey) &&
            ["queued", "running", "succeeded", "partial", "skipped"].includes(run.status),
        );
        if (already) {
          counts.skipped_idempotent += 1;
          continue;
        }
        const result = await enqueueScheduledDraftRun({
          agent: row.agent,
          clientId,
          firmId: input.firmId,
          actionItemId: actionItem.id,
          periodKey: row.periodKey,
          botOwner: row.botOwner,
        });
        const added = countNewlyEnqueuedRun(result);
        if (added > 0) {
          enqueued += added;
          counts.invoked += added;
          invokesLeft -= added;
          firmInvokesToday += added;
        } else if (result && !result.created) {
          counts.skipped_idempotent += 1;
        }
        if (invokesLeft <= 0) break;
      }
      if (invokesLeft <= 0) break;
    }
    if (invokesLeft <= 0) break;
  }

  return { ok: true as const, enqueued, periodKey, counts };
}

export async function listFirmIdsWithAcceptedRoutines(limit: number): Promise<string[]> {
  const db = admin();
  const firms = new Set<string>();
  const pageSize = 100;
  for (let offset = 0; firms.size < limit; offset += pageSize) {
    const res = await (db
      .from("client_artifacts")
      .select("meta")
      .or(imRoutineMapArtifactFilter())
      .not("meta->>accepted_at", "is", null)
      .not("meta->>accepted_at", "eq", "")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1) as unknown as Promise<{ data: Row[] | null; error: DbError }>);
    if (res.error) throw new Error(res.error.message);
    const rows = res.data ?? [];
    for (const row of rows) {
      const meta = parseRoutineMapMeta(row.meta);
      if (!meta?.accepted_at || !meta.firm_id) continue;
      firms.add(meta.firm_id);
      if (firms.size >= limit) break;
    }
    if (rows.length < pageSize) break;
  }
  return [...firms].slice(0, limit);
}
