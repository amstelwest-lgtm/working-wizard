/**
 * Implementation Manager activation — persist backlog and enqueue draft runs.
 * Uses existing tables only. Service role writes agent_runs after has_client_access.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { agentIdempotencyKey, agentInputHash } from "@/lib/agent-bus";
import { handoffDecision, runnerEnabled, AGENT_RUNNERS } from "@/lib/owner-handoff";
import { buildActivationPlan, type ImPilotClient } from "@/lib/im-activation-planner";
import { imRoutineRunnerAgentForStep } from "@/lib/im-activation-triggers";
import { replayImplementationPlan } from "@/lib/im-replay";
import { currentQuarterLabel, defaultTargetDate } from "@/lib/action-plan-counts";
import {
  activationActionDrafts,
  activationArtifactKey,
  assertImActivationArtifactKinds,
  imRoutineMapArtifactFilter,
  routineMapArtifactInsert,
  IM_ACTIVATION_SOURCE,
  countNewlyEnqueuedRun,
  type DraftRunEnqueue,
  type ImActivationActionDraft,
} from "@/lib/im-activation-persist";
import { planActivationAccept } from "@/lib/im-activation-accept";
import { imRoutinePeriodKey, scheduledRunInputs } from "@/lib/im-routine-schedule";
import { SETUP_PARTNER_SOURCE_EVENT, SETUP_PARTNER_TASK_WORKFLOW } from "@/lib/setup-partner";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55 } from "@/lib/claude-request";
import { imOpusAttemptModels, imOpusFallbackModel } from "@/lib/im-opus-model";
import { stampPlanActions, type PlanClient } from "@/lib/im-plan-actions";
import {
  applyOpusIntegrationPlan,
  buildIntegrationPlanTable,
  integrationPlanOpusBody,
  plainWorkflowText,
  playsForPlan,
  type IntegrationPlanRow,
} from "@/lib/im-integration-plan";
import {
  draftDeepLink,
  emptyImSetupHold,
  imResetAllowed,
  imSetupHoldRuleText,
  isImSampleClient,
  parseImSetupHold,
  pilotFromPlanRows,
  queuedRunningLines,
  planRowKey,
  presentRunningLines,
  routineLabel,
  IM_SETUP_HOLD_EVENT,
  IM_SETUP_HOLD_TASK,
  type ImPilotRef,
  type ImRunningLine,
  type ImSetupHold,
} from "@/lib/im-setup-hold";
import type { SetupPartnerWorkflowMap } from "@/lib/setup-partner";

const ACTIVATION_RUN_SUMMARY = "Implementation Manager activation — draft only.";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  or: (filters: string) => Filter;
  in: (column: string, values: string[]) => Filter;
  is: (column: string, value: null) => Filter;
  order: (column: string, options: { ascending: boolean }) => Filter;
  limit: (count: number) => Filter;
  maybeSingle: () => Promise<DbResult<Row | null>>;
};

type InsertFilter = {
  select: (columns: string) => { maybeSingle: () => Promise<DbResult<Row | null>> };
};

type DeleteFilter = {
  eq: (column: string, value: string) => Promise<DbResult<null>>;
};

type UpdateFilter = {
  eq: (column: string, value: string) => Promise<DbResult<null>>;
};

type Admin = {
  from: (table: string) => {
    select: (columns: string) => Filter;
    insert: (row: Row | Row[]) => InsertFilter;
    update: (row: Row) => UpdateFilter;
    delete: () => DeleteFilter;
    upsert?: (row: Row, options: { onConflict: string }) => Promise<DbResult<null>>;
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: DbError }>;
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

async function assertClientAccess(
  userClient: { rpc: (fn: string, args: Record<string, string>) => Promise<{ data: unknown; error: DbError }> },
  userId: string,
  clientId: string,
): Promise<void> {
  const access = await userClient.rpc("has_client_access", { _user_id: userId, _client_id: clientId });
  if (access.error) throw new Error(access.error.message);
  if (!access.data) throw new Error("You do not have access to this client");
}

async function pilotBooks(clientId: string): Promise<{ hasLedger: boolean; hasUpload: boolean }> {
  const db = admin();
  const [xero, qbo, sage, uploads] = await Promise.all([
    db.from("xero_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("qbo_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("sage_connections").select("id").eq("client_id", clientId).limit(1).maybeSingle(),
    db.from("client_artifacts").select("id").eq("client_id", clientId).eq("kind", "upload").limit(1).maybeSingle(),
  ]);
  const hasLedger = Boolean(xero.data?.id || qbo.data?.id || sage.data?.id);
  const hasUpload = Boolean(uploads.data?.id);
  return { hasLedger, hasUpload };
}

async function loadPilots(firmId: string): Promise<ImPilotClient[]> {
  const db = admin();
  const listed = await db.from("clients").select("id, name, is_demo").eq("firm_id", firmId).order("created_at", { ascending: true }).limit(40);
  if (listed.error) throw new Error(listed.error.message);
  const pilots: ImPilotClient[] = [];
  for (const row of listed.data ?? []) {
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "Client";
    if (!id || isImSampleClient({ name, isDemo: row.is_demo === true })) continue;
    const books = await pilotBooks(id);
    pilots.push({ id, name, ...books });
  }
  return pilots;
}

async function activePlanRules(firmId: string) {
  const db = admin();
  const rules = await db
    .from("milon_brain_rules")
    .select("rule_text, client_id, source_event, status, task_type")
    .eq("firm_id", firmId)
    .is("client_id", null)
    .eq("source_event", SETUP_PARTNER_SOURCE_EVENT)
    .eq("status", "active")
    .eq("task_type", SETUP_PARTNER_TASK_WORKFLOW)
    .limit(200);
  if (rules.error) throw new Error(rules.error.message);
  return (rules.data ?? []).filter((row) => !row.client_id);
}

async function findActivePlanId(clientId: string): Promise<string | null> {
  const db = admin();
  const found = await db
    .from("action_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  return typeof found.data?.id === "string" ? found.data.id : null;
}

async function nextActionSeq(planId: string): Promise<number> {
  const db = admin();
  const maxSeqRow = await db
    .from("action_items")
    .select("seq")
    .eq("plan_id", planId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxSeqRow.error) throw new Error(maxSeqRow.error.message);
  return ((maxSeqRow.data?.seq as number | undefined) ?? 0) + 1;
}

async function insertActivePlan(clientId: string): Promise<string> {
  const db = admin();
  const created = await db
    .from("action_plans")
    .insert({
      client_id: clientId,
      period_label: currentQuarterLabel(),
      outcome_goal: "Implementation Manager pilots",
      target_date: defaultTargetDate(),
      is_active: true,
    })
    .select("id")
    .maybeSingle();
  if (created.error || typeof created.data?.id !== "string") {
    throw new Error(created.error?.message ?? "Could not open the action plan.");
  }
  return created.data.id;
}

type WrittenRow = {
  table: "action_plans" | "client_artifacts" | "action_items" | "agent_runs";
  id: string;
};

/** Delete only rows this click inserted, newest first, so a failed start leaves nothing behind. */
async function rollbackActivationWrites(rows: readonly WrittenRow[]): Promise<void> {
  const db = admin();
  for (const row of [...rows].reverse()) {
    const removed = await db.from(row.table).delete().eq("id", row.id);
    if (removed.error) console.warn("im_activation_rollback", row.table);
  }
}

async function existingActivationKeys(clientId: string, firmId: string) {
  const db = admin();
  const actions = await db
    .from("action_items")
    .select("source_move_key")
    .eq("client_id", clientId)
    .eq("driver_key", IM_ACTIVATION_SOURCE)
    .limit(200);
  if (actions.error) throw new Error(actions.error.message);
  const keys = new Set<string>();
  for (const row of actions.data ?? []) {
    if (typeof row.source_move_key === "string") keys.add(row.source_move_key);
  }
  const artifacts = await db
    .from("client_artifacts")
    .select("meta")
    .eq("client_id", clientId)
    .or(imRoutineMapArtifactFilter())
    .limit(20);
  if (artifacts.error) throw new Error(artifacts.error.message);
  const artifactKeys = new Set<string>();
  for (const row of artifacts.data ?? []) {
    const meta = row.meta;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const key = (meta as Record<string, unknown>).idempotency_key;
      if (typeof key === "string") artifactKeys.add(key);
      else if (typeof (meta as Record<string, unknown>).routine === "string") {
        artifactKeys.add(
          activationArtifactKey(firmId, clientId, (meta as Record<string, unknown>).routine as "document_chase" | "monthly_pack"),
        );
      }
    }
  }
  return { actionKeys: keys, artifactKeys };
}

async function enqueueDraftRun(input: {
  agent: "financial_manager" | "analyst" | "advisor";
  clientId: string;
  firmId: string;
  actionItemId?: string;
  periodKey?: string;
  /** Stable plan-row key. Same key never inserts a second run. */
  rowKey?: string;
}): Promise<DraftRunEnqueue | null> {
  const decision = handoffDecision(input.agent);
  if (!decision.ok) return null;
  const db = admin();
  const setting = await db.from("agent_settings").select("value").eq("key", decision.settingKey).maybeSingle();
  if (setting.error || !runnerEnabled(setting.data?.value)) return null;

  const periodKey = input.periodKey ?? imRoutinePeriodKey();
  const inputs = input.rowKey
    ? `im-plan-row:${input.firmId}:${input.clientId}:${input.rowKey}`
    : scheduledRunInputs(input.actionItemId ?? "", periodKey);
  const idempotencyKey = await agentIdempotencyKey({
    agent: input.agent,
    clientId: input.clientId,
    trigger: "on_demand",
    inputs,
  });
  const inputHash = await agentInputHash(inputs);
  const correlationId = crypto.randomUUID();
  const inserted = await db.from("agent_runs").insert({
    agent: input.agent,
    client_id: input.clientId,
    firm_id: input.firmId,
    trigger: "on_demand",
    audience: "accountant",
    idempotency_key: idempotencyKey,
    input_hash: inputHash,
    correlation_id: correlationId,
    status: "queued",
    ...(input.actionItemId ? { action_item_id: input.actionItemId } : {}),
    attempt: 1,
    summary: "Implementation Manager activation — draft only.",
    trace: [
      {
        tool: "activation",
        label: "Queued from Implementation Manager activation",
        status: "queued",
        im_row_key: input.rowKey ?? "",
        im_design_model: CLAUDE_OPUS_55,
        im_execution_model: CLAUDE_SONNET_55,
      },
    ],
  }).select("id").maybeSingle();
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
  if (invoke.error) console.warn("im_activation agent_invoke", invoke.error.message);
  return { runId, created: true };
}

export const loadImActivationContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ firmId: z.string().uuid(), country: z.enum(["US", "ZA"]).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const rules = await activePlanRules(data.firmId);
    const replay = replayImplementationPlan({ confirmRules: rules, meta: { country: data.country } });
    if (replay.status === "needs_questions") {
      return { ok: false as const, needsQuestions: replay.missingQuestions };
    }
    const pilots = await loadPilots(data.firmId);
    const activation = buildActivationPlan({
      plan: replay.plan,
      country: replay.country,
      pilots,
      manifest: replay.manifest,
    });
    return {
      ok: true as const,
      activation,
      pilots,
      country: replay.country,
    };
  });

const acceptSchema = z.object({
  firmId: z.string().uuid(),
  country: z.enum(["US", "ZA"]).optional(),
  pilotIds: z.array(z.string().uuid()).min(1).max(3),
  accepts: z.array(
    z.object({
      routine: z.enum([
        "document_chase",
        "monthly_pack",
        "cash_debtor_early_warning",
        "budget_actual_drift",
        "tax_deadline_watch",
      ]),
      accepted: z.boolean(),
      hoursSavedPerRun: z.number().positive().max(40).optional().nullable(),
    }),
  ),
  /** Start passes false and enqueues once per stored plan row instead. */
  enqueueRuns: z.boolean().optional(),
});

async function acceptImActivationHandler(
  data: z.infer<typeof acceptSchema>,
  context: {
    userId?: string | null;
    supabase: unknown;
  },
): Promise<{ ok: true; wrote: number; enqueued: number }> {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const rules = await activePlanRules(data.firmId);
    const replay = replayImplementationPlan({ confirmRules: rules, meta: { country: data.country } });
    if (replay.status === "needs_questions") throw new Error("Finish the Implementation Manager plan first.");
    const pilots = (await loadPilots(data.firmId)).filter((row) => data.pilotIds.includes(row.id));
    if (pilots.length < 1) throw new Error("Pick at least one pilot client.");
    const activation = buildActivationPlan({
      plan: replay.plan,
      country: replay.country,
      pilots,
      manifest: replay.manifest,
    });

  const acceptedRoutines = data.accepts.filter((row) => row.accepted);
  if (acceptedRoutines.length === 0) {
    return { ok: true as const, wrote: 0, enqueued: 0 };
  }

    const db = admin();
    const now = new Date().toISOString();
    const planIdByClient = new Map<string, string>();
    const plansToCreate: string[] = [];
    const artifacts: ReturnType<typeof routineMapArtifactInsert>[] = [];
    const actions: ImActivationActionDraft[] = [];
    const enqueues: Array<{
      agent: "financial_manager" | "analyst" | "advisor";
      clientId: string;
      actionMoveKey: string;
    }> = [];

    for (const pilot of pilots) {
      await assertClientAccess(context.supabase as never, userId, pilot.id);
      const existingPlanId = await findActivePlanId(pilot.id);
      let seq = 1;
      if (existingPlanId) {
        planIdByClient.set(pilot.id, existingPlanId);
        seq = await nextActionSeq(existingPlanId);
      } else if (!plansToCreate.includes(pilot.id)) {
        plansToCreate.push(pilot.id);
      }
      const existing = await existingActivationKeys(pilot.id, data.firmId);
      const books = { hasLedger: pilot.hasLedger, hasUpload: pilot.hasUpload };

      for (const acceptRow of acceptedRoutines) {
        const map = activation.routineMaps.find((row) => row.routine === acceptRow.routine);
        if (!map) continue;
        const hours =
          acceptRow.hoursSavedPerRun === undefined || acceptRow.hoursSavedPerRun === null
            ? null
            : acceptRow.hoursSavedPerRun;
        const plan = planActivationAccept({
          firmId: data.firmId,
          clientId: pilot.id,
          routine: acceptRow.routine,
          map,
          books,
          existingActionKeys: existing.actionKeys,
          existingArtifactKeys: existing.artifactKeys,
        });

        if (plan.writeArtifact) {
          artifacts.push(
            routineMapArtifactInsert({
              firmId: data.firmId,
              clientId: pilot.id,
              map,
              hoursSavedPerRun: hours,
              acceptedAt: now,
            }),
          );
          existing.artifactKeys.add(plan.artifactKey);
        }

        const drafts = activationActionDrafts({
          firmId: data.firmId,
          clientId: pilot.id,
          planId: existingPlanId ?? "",
          map,
          seqStart: seq,
        }).filter((row) => plan.actionKeys.includes(row.source_move_key));
        actions.push(...drafts);
        const usedSeq = drafts.reduce((max, row) => Math.max(max, row.seq), seq - 1);
        seq = usedSeq + 1;
        for (const draft of drafts) existing.actionKeys.add(draft.source_move_key);

        for (const row of plan.enqueue) {
          enqueues.push({
            agent: row.agent,
            clientId: pilot.id,
            actionMoveKey: row.actionMoveKey,
          });
        }
      }
    }

    assertImActivationArtifactKinds(artifacts.map((row) => row.kind));

    const written: WrittenRow[] = [];
    let wrote = 0;
    let enqueued = 0;
    try {
      for (const clientId of plansToCreate) {
        const id = await insertActivePlan(clientId);
        written.push({ table: "action_plans", id });
        planIdByClient.set(clientId, id);
      }
      for (const draft of actions) {
        if (draft.plan_id) continue;
        const id = planIdByClient.get(draft.client_id);
        if (!id) throw new Error("Could not open the action plan.");
        draft.plan_id = id;
      }

      for (const artifact of artifacts) {
        const inserted = await db.from("client_artifacts").insert(artifact).select("id").maybeSingle();
        if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);
        if (inserted.error) continue;
        if (typeof inserted.data?.id !== "string") throw new Error("Could not save the activation.");
        written.push({ table: "client_artifacts", id: inserted.data.id });
        wrote += 1;
      }

      const actionIdByKey = new Map<string, string>();
      for (const draft of actions) {
        const inserted = await db.from("action_items").insert(draft).select("id, source_move_key").maybeSingle();
        if (inserted.error) {
          if (inserted.error.code === "23505") {
            const found = await db
              .from("action_items")
              .select("id, source_move_key")
              .eq("client_id", draft.client_id)
              .eq("source_move_key", draft.source_move_key)
              .maybeSingle();
            if (typeof found.data?.id === "string" && typeof found.data.source_move_key === "string") {
              actionIdByKey.set(found.data.source_move_key, found.data.id);
            }
            continue;
          }
          throw new Error(inserted.error.message);
        }
        if (typeof inserted.data?.id !== "string" || typeof inserted.data.source_move_key !== "string") {
          throw new Error("Could not save the activation.");
        }
        actionIdByKey.set(inserted.data.source_move_key, inserted.data.id);
        written.push({ table: "action_items", id: inserted.data.id });
        wrote += 1;
      }

      if (data.enqueueRuns === false) {
        /* The caller enqueues one run per plan row. */
      } else for (const row of enqueues) {
        const actionItemId =
          actionIdByKey.get(row.actionMoveKey) ??
          (await db
            .from("action_items")
            .select("id")
            .eq("client_id", row.clientId)
            .eq("source_move_key", row.actionMoveKey)
            .maybeSingle()
            .then((res) => (typeof res.data?.id === "string" ? res.data.id : null)));
        if (!actionItemId) continue;
        const run = await enqueueDraftRun({
          agent: row.agent,
          clientId: row.clientId,
          firmId: data.firmId,
          actionItemId,
        });
        if (run?.created) written.push({ table: "agent_runs", id: run.runId });
        enqueued += countNewlyEnqueuedRun(run);
      }
    } catch (err) {
      await rollbackActivationWrites(written);
      throw err instanceof Error ? err : new Error("Could not start integration.");
    }

    return { ok: true as const, wrote, enqueued };
}

export const acceptImActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => acceptSchema.parse(input))
  .handler(async ({ data, context }) => acceptImActivationHandler(data, context));

function agentForPlanBot(bot: string): "financial_manager" | "analyst" | "advisor" {
  return imRoutineRunnerAgentForStep(bot) ?? "advisor";
}

function resolveStoredPilot(
  stored: ImPilotRef | null,
  pilots: readonly ImPilotClient[],
): ImPilotClient | null {
  if (!stored?.id) return null;
  const match = pilots.find((row) => row.id === stored.id);
  if (match) return { ...match, name: stored.name || match.name };
  return { id: stored.id, name: stored.name || "Client", hasLedger: false, hasUpload: false };
}

async function withDraftLinks(lines: readonly ImRunningLine[]): Promise<ImRunningLine[]> {
  const runIds = [...new Set(lines.map((line) => line.runId?.trim() ?? "").filter(Boolean))];
  if (!runIds.length) return lines.map((line) => ({ ...line, href: line.draftId ? draftDeepLink(line.clientId ?? "", line.draftId) : "" }));
  const db = admin();
  const found = (await db
    .from("agent_findings")
    .select("id, run_id")
    .in("run_id", runIds)
    .limit(40)) as unknown as { data: Row[] | null; error: DbError };
  const draftByRun = new Map<string, string>();
  if (!found.error) {
    for (const row of found.data ?? []) {
      const runId = typeof row.run_id === "string" ? row.run_id : "";
      const id = typeof row.id === "string" ? row.id : "";
      if (runId && id && !draftByRun.has(runId)) draftByRun.set(runId, id);
    }
  }
  return lines.map((line) => {
    const draftId = line.draftId?.trim() || (line.runId ? draftByRun.get(line.runId) ?? "" : "");
    const href = draftId ? draftDeepLink(line.clientId ?? "", draftId) : "";
    return { ...line, draftId, href };
  });
}

const startSchema = z.object({
  firmId: z.string().uuid(),
  country: z.enum(["US", "ZA"]).optional(),
});

/**
 * Accept every routine, pick up to 3 pilots, and enqueue draft runs now.
 * A second click reuses the same artifact keys, action move keys, and
 * agent_run idempotency keys, so it does not insert duplicates.
 */
export const startImIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const existing = (await readSetupHold(data.firmId)) ?? emptyImSetupHold();
    const storedPilot = existing.pilot?.id ? existing.pilot : pilotFromPlanRows(existing.rows);
    if (existing.started && storedPilot) {
      const lines = await withDraftLinks(presentRunningLines({ rows: existing.rows, lines: existing.lines, pilot: storedPilot }));
      return {
        ok: true as const,
        wrote: 0,
        enqueued: 0,
        runCount: lines.filter((line) => line.runId).length,
        pilotIds: storedPilot.id ? [storedPilot.id] : [],
        lines,
        started: true as const,
      };
    }
    const pilots = await loadPilots(data.firmId);
    const pilot = resolveStoredPilot(storedPilot, pilots);
    if (!pilot) throw new Error("Add a client, then start integration.");
    const rules = await activePlanRules(data.firmId);
    const replay = replayImplementationPlan({ confirmRules: rules, meta: { country: data.country } });
    if (replay.status === "needs_questions") throw new Error("Finish the Implementation Manager plan first.");
    const activation = buildActivationPlan({
      plan: replay.plan,
      country: replay.country,
      pilots: [pilot],
      manifest: replay.manifest,
    });
    const result = await acceptImActivationHandler(
      {
        firmId: data.firmId,
        country: data.country,
        pilotIds: [pilot.id],
        enqueueRuns: false,
        accepts: activation.routineMaps.map((map) => ({
          routine: map.routine,
          accepted: true,
          hoursSavedPerRun: null,
        })),
      },
      context,
    );
    const rows = existing.rows.length
      ? existing.rows
      : await planRowsForPilot({
          firmId: data.firmId,
          country: data.country,
          steps: replay.plan.steps.map((row) => ({ step: row.step, bucket: row.bucket })),
          pilot,
        });
    let enqueued = 0;
    const seeded: ImRunningLine[] = [];
    for (const row of rows) {
      const rowKey = planRowKey(row.playId);
      const run = await enqueueDraftRun({
        agent: agentForPlanBot(row.bot),
        clientId: pilot.id,
        firmId: data.firmId,
        rowKey,
      });
      if (run?.created) enqueued += 1;
      seeded.push({
        id: run?.runId || rowKey,
        bot: row.bot,
        status: "Draft queued",
        summary: "Draft for your review. Nothing has been sent.",
        href: "",
        clientName: pilot.name,
        clientId: pilot.id,
        routine: row.routine,
        rowKey,
        runId: run?.runId ?? "",
        draftId: "",
      });
    }
    const lines = await withDraftLinks(presentRunningLines({ rows, lines: seeded, pilot }));
    await writeSetupHold(data.firmId, userId, {
      pendingMap: null,
      rows,
      started: true,
      lines,
      pilot,
    });
    return {
      ...result,
      enqueued: result.enqueued + enqueued,
      runCount: lines.filter((line) => line.runId).length,
      pilotIds: [pilot.id],
      lines,
      started: true as const,
    };
  });

const BOT_LABEL: Record<string, string> = {
  financial_manager: "Financial Manager",
  analyst: "Analyst",
  advisor: "Advisor",
};

function activationRunStatus(status: string): string {
  if (status === "queued") return "Draft queued";
  if (status === "running") return "Running";
  if (status === "succeeded" || status === "completed") return "Done";
  if (status === "failed") return "Needs another look";
  return "Waiting";
}

async function readSetupHoldRow(firmId: string): Promise<{ id: string; hold: ImSetupHold } | null> {
  const db = admin();
  const listed = (await db
    .from("milon_brain_rules")
    .select("id, rule_text")
    .eq("firm_id", firmId)
    .is("client_id", null)
    .eq("source_event", IM_SETUP_HOLD_EVENT)
    .eq("status", "active")
    .eq("task_type", IM_SETUP_HOLD_TASK)
    .order("created_at", { ascending: false })
    .limit(1)) as unknown as { data: Row[] | null; error: DbError };
  if (listed.error) throw new Error(listed.error.message);
  const row = listed.data?.[0];
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    hold: parseImSetupHold(typeof row.rule_text === "string" ? row.rule_text : null) ?? emptyImSetupHold(),
  };
}

async function readSetupHold(firmId: string): Promise<ImSetupHold | null> {
  const row = await readSetupHoldRow(firmId);
  if (!row) return null;
  const hold = row.hold;
  if (!hold.pendingMap && hold.rows.length === 0 && !hold.started && hold.lines.length === 0) return null;
  return hold;
}

async function writeSetupHold(firmId: string, userId: string, hold: ImSetupHold): Promise<void> {
  const db = admin();
  const rule_text = imSetupHoldRuleText(hold);
  const existing = await readSetupHoldRow(firmId);
  if (existing) {
    const updated = await db.from("milon_brain_rules").update({ rule_text }).eq("id", existing.id);
    if (updated.error) throw new Error(updated.error.message);
    return;
  }
  const inserted = await db
    .from("milon_brain_rules")
    .insert({
      firm_id: firmId,
      client_id: null,
      task_type: IM_SETUP_HOLD_TASK,
      source_event: IM_SETUP_HOLD_EVENT,
      source_row_id: null,
      decision: "corrected",
      rule_text,
      approver_id: userId,
      layer: "private",
      status: "active",
    })
    .select("id")
    .maybeSingle();
  if (inserted.error) throw new Error(inserted.error.message);
}

async function planRowsForPilot(input: {
  firmId: string;
  country?: "US" | "ZA";
  interview?: string;
  map?: SetupPartnerWorkflowMap | null;
  steps?: { step: string; bucket?: string }[];
  pilot?: ImPilotRef | null;
}): Promise<IntegrationPlanRow[]> {
  const steps =
    input.steps ??
    (input.map?.todaysFlow ?? []).map((step) => ({ step }));
  const built = buildIntegrationPlanTable({
    steps,
    coverage: input.map?.milonCoverage ?? [],
    interview: input.interview,
    country: input.country,
  });
  const pilot = input.pilot?.id ? input.pilot : await firstPlanClient(input.firmId);
  return stampPlanActions(built, pilot);
}

async function loadActivationRuns(firmId: string): Promise<{
  runCount: number;
  lines: ImRunningLine[];
}> {
  const db = admin();
  const listed = (await db
    .from("agent_runs")
    .select("id, agent, status, client_id")
    .eq("firm_id", firmId)
    .eq("summary", ACTIVATION_RUN_SUMMARY)
    .order("queued_at", { ascending: false })
    .limit(12)) as unknown as { data: Row[] | null; error: DbError };
  if (listed.error) throw new Error(listed.error.message);
  const clientIds = [
    ...new Set(
      (listed.data ?? [])
        .map((row) => (typeof row.client_id === "string" ? row.client_id : ""))
        .filter(Boolean),
    ),
  ];
  const names = new Map<string, string>();
  if (clientIds.length) {
    const clients = (await db.from("clients").select("id, name").in("id", clientIds).limit(12)) as unknown as {
      data: Row[] | null;
      error: DbError;
    };
    if (!clients.error) {
      for (const row of clients.data ?? []) {
        if (typeof row.id === "string") names.set(row.id, typeof row.name === "string" ? row.name : "");
      }
    }
  }
  const lines = (listed.data ?? []).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    const agent = typeof row.agent === "string" ? row.agent : "";
    const status = typeof row.status === "string" ? row.status : "";
    const clientId = typeof row.client_id === "string" ? row.client_id : "";
    if (!id) return [];
    return [
      {
        id,
        bot: BOT_LABEL[agent] ?? "Milōn",
        status: activationRunStatus(status),
        summary: "Draft for your review. Nothing has been sent.",
        href: "",
        clientName: clientId ? (names.get(clientId) ?? "") : "",
        routine: routineLabel("monthly_pack"),
      },
    ];
  });
  return { runCount: lines.length, lines };
}

async function linesFromArtifacts(firmId: string): Promise<ImRunningLine[]> {
  const db = admin();
  const listed = (await db
    .from("clients")
    .select("id, name, is_demo")
    .eq("firm_id", firmId)
    .order("created_at", { ascending: true })
    .limit(40)) as unknown as { data: Row[] | null; error: DbError };
  if (listed.error) return [];
  const clients = (listed.data ?? []).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) return [];
    return [{ id, name: typeof row.name === "string" ? row.name : "", isDemo: row.is_demo === true }];
  });
  const real = clients.filter((row) => !isImSampleClient(row));
  const pool = real.length ? real : [];
  if (!pool.length) return [];
  const artifacts = (await db
    .from("client_artifacts")
    .select("client_id, meta")
    .in(
      "client_id",
      pool.map((row) => row.id),
    )
    .or(imRoutineMapArtifactFilter())
    .limit(20)) as unknown as { data: Row[] | null; error: DbError };
  if (artifacts.error || !artifacts.data?.length) return [];
  const names = new Map(pool.map((row) => [row.id, row.name]));
  const routines = artifacts.data.flatMap((row) => {
    const meta = row.meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
    const rec = meta as Record<string, unknown>;
    const routine = typeof rec.routine === "string" ? rec.routine : "";
    if (!routine) return [];
    const steps = Array.isArray(rec.steps) ? rec.steps : [];
    const first = steps[0];
    const bot =
      first && typeof first === "object" && !Array.isArray(first)
        ? String((first as Record<string, unknown>).botOwner ?? "")
        : "";
    return [{ routine, bot }];
  });
  const pilotId = typeof artifacts.data[0]?.client_id === "string" ? artifacts.data[0].client_id : pool[0]?.id ?? "";
  if (!pilotId) return [];
  return queuedRunningLines({
    pilot: { id: pilotId, name: names.get(pilotId) ?? "" },
    routines,
  });
}

export const loadImRunningState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ firmId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const hold = await readSetupHold(data.firmId);
    const pilot = hold?.pilot?.id ? hold.pilot : pilotFromPlanRows(hold?.rows ?? []);
    let lines = presentRunningLines({
      rows: hold?.rows ?? [],
      lines: hold?.lines ?? [],
      pilot,
    });
    let started = Boolean(hold?.started) || lines.length > 0;
    if (!lines.length) {
      const recovered = await linesFromArtifacts(data.firmId);
      if (recovered.length && !pilot) {
        started = true;
        lines = recovered;
      }
    }
    lines = await withDraftLinks(lines);
    const running = await loadActivationRuns(data.firmId);
    return { runCount: running.runCount, started: started || running.runCount > 0, lines };
  });

const resetSchema = z.object({ firmId: z.string().uuid() });

/** Clears the stored plan hold only. Runs and ledger rows stay. Test firm only. */
export const resetImSetupHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    if (!imResetAllowed(data.firmId)) throw new Error("Reset is not available for this practice.");
    await assertFirmAccess(userId, data.firmId);
    const existing = await readSetupHoldRow(data.firmId);
    if (!existing) return { ok: true as const, cleared: false };
    await writeSetupHold(data.firmId, userId, emptyImSetupHold());
    return { ok: true as const, cleared: true };
  });

const holdSchema = z.object({
  firmId: z.string().uuid(),
  clearMap: z.boolean().optional(),
  interview: z.string().max(8000).optional(),
  country: z.enum(["US", "ZA"]).optional(),
  pendingMap: z
    .object({
      todaysFlow: z.array(z.string().max(500)).max(40),
      milonCoverage: z
        .array(z.object({ agent: z.string().max(80), owns: z.string().max(400) }))
        .max(12),
      gaps: z.array(z.string().max(500)).max(20),
      checklist: z.array(z.string().max(500)).max(20),
    })
    .nullable()
    .optional(),
});

/** Save the unconfirmed map and the plan generated with it. Confirm clears the map. */
export const saveImSetupHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => holdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const existing = (await readSetupHold(data.firmId)) ?? emptyImSetupHold();
    if (data.clearMap) {
      await writeSetupHold(data.firmId, userId, { ...existing, pendingMap: null });
      return { ok: true as const };
    }
    const pendingMap = data.pendingMap ?? existing.pendingMap;
    const pilot = existing.pilot?.id ? existing.pilot : pilotFromPlanRows(existing.rows);
    const rows =
      pendingMap && !existing.started
        ? await planRowsForPilot({
            firmId: data.firmId,
            country: data.country,
            interview: data.interview,
            map: pendingMap,
            pilot,
          })
        : existing.rows;
    await writeSetupHold(data.firmId, userId, {
      ...existing,
      pendingMap,
      rows,
      pilot: pilot ?? pilotFromPlanRows(rows),
    });
    return { ok: true as const };
  });

const draftSchema = z.object({
  firmId: z.string().uuid(),
  country: z.enum(["US", "ZA"]).optional(),
  interview: z.string().max(8000).optional(),
  steps: z
    .array(
      z.object({
        step: z.string().max(500),
        bucket: z.string().max(40).optional(),
      }),
    )
    .max(40)
    .optional(),
  coverage: z
    .array(
      z.object({
        agent: z.string().max(80),
        owns: z.string().max(400),
      }),
    )
    .max(12)
    .optional(),
});

/** Rank catalogue plays with in-app Opus. Unknown play ids are rejected. */
export const draftImIntegrationPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => draftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const stored = await readSetupHold(data.firmId);
    if (stored?.rows.length) {
      return { rows: stored.rows, rejected: [] as string[], source: "stored" as const, model: null };
    }
    const country = data.country;
    const interview = data.interview?.trim() ?? "";
    const steps = data.steps ?? [];
    const plays = playsForPlan(country);
    const fallback = buildIntegrationPlanTable({
      steps,
      coverage: data.coverage ?? [],
      interview,
      country,
    });
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const client = await firstPlanClient(data.firmId);
    const withActions = (rows: IntegrationPlanRow[]) => stampPlanActions(rows, client);
    if (!apiKey || fallback.length === 0 || !interview) {
      return { rows: withActions(fallback), rejected: [] as string[], source: "fallback" as const, model: null };
    }
    const order = imOpusAttemptModels(CLAUDE_OPUS_55);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      let text = "";
      let served: string | null = null;
      for (let i = 0; i < order.length; i += 1) {
        const model = order[i];
        if (!model) break;
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(
            integrationPlanOpusBody({
              plays,
              interview,
              steps: steps.map((row) => plainWorkflowText(row.step)).filter(Boolean),
              country,
              model,
            }),
          ),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          const retry =
            i === 0
              ? imOpusFallbackModel({
                  attempted: model,
                  currentOpusId: CLAUDE_OPUS_55,
                  status: res.status,
                  body: errBody,
                })
              : null;
          if (retry) {
            console.info("im_opus_rejected", JSON.stringify({ surface: "im_integration_plan", model, status: res.status }));
            continue;
          }
          return { rows: withActions(fallback), rejected: [] as string[], source: "fallback" as const, model: null };
        }
        const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
        text = (json.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("")
          .trim();
        served = model;
        break;
      }
      if (!text || !served) {
        return { rows: withActions(fallback), rejected: [] as string[], source: "fallback" as const, model: served };
      }
      console.info("im_opus_served", JSON.stringify({ surface: "im_integration_plan", model: served }));
      const applied = applyOpusIntegrationPlan(text, fallback, { country, interview, plays });
      return { rows: withActions(applied.rows), rejected: applied.rejected, source: "opus" as const, model: served };
    } catch {
      return { rows: withActions(fallback), rejected: [] as string[], source: "fallback" as const, model: null };
    } finally {
      clearTimeout(timer);
    }
  });

async function firstPlanClient(firmId: string): Promise<PlanClient | null> {
  try {
    const listed = (await admin()
      .from("clients")
      .select("id, name, is_demo")
      .eq("firm_id", firmId)
      .order("created_at", { ascending: true })
      .limit(40)) as {
      data: { id?: string; name?: string; is_demo?: boolean | null }[] | null;
      error: { message: string } | null;
    };
    if (listed.error) return null;
    const rows = (listed.data ?? []).filter((row) => typeof row.id === "string");
    const row = rows.find((item) => !isImSampleClient({ name: item.name, isDemo: item.is_demo === true }));
    if (!row || typeof row.id !== "string") return null;
    return { id: row.id, name: typeof row.name === "string" ? row.name : "" };
  } catch {
    return null;
  }
}