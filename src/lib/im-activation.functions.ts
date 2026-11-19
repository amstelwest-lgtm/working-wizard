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
import { replayImplementationPlan } from "@/lib/im-replay";
import { currentQuarterLabel, defaultTargetDate } from "@/lib/action-plan-counts";
import {
  activationActionDrafts,
  activationActionMoveKey,
  activationArtifactKey,
  activationRunInputs,
  routineMapArtifactMeta,
  IM_ACTIVATION_SOURCE,
  countNewlyEnqueuedRun,
  type DraftRunEnqueue,
} from "@/lib/im-activation-persist";
import { planActivationAccept } from "@/lib/im-activation-accept";
import { imRoutinePeriodKey, scheduledRunInputs } from "@/lib/im-routine-schedule";
import { SETUP_PARTNER_SOURCE_EVENT, SETUP_PARTNER_TASK_WORKFLOW } from "@/lib/setup-partner";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55 } from "@/lib/claude-request";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  in: (column: string, values: string[]) => Filter;
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
    insert: (row: Row | Row[]) => InsertFilter;
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
  const listed = await db.from("clients").select("id, name").eq("firm_id", firmId).order("created_at", { ascending: true }).limit(40);
  if (listed.error) throw new Error(listed.error.message);
  const pilots: ImPilotClient[] = [];
  for (const row of listed.data ?? []) {
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "Client";
    if (!id) continue;
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

async function ensureActivePlan(clientId: string): Promise<string> {
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
  if (typeof found.data?.id === "string") return found.data.id;
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
    .eq("kind", "routine_map")
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
  actionItemId: string;
  periodKey?: string;
}): Promise<DraftRunEnqueue | null> {
  const decision = handoffDecision(input.agent);
  if (!decision.ok) return null;
  const db = admin();
  const setting = await db.from("agent_settings").select("value").eq("key", decision.settingKey).maybeSingle();
  if (setting.error || !runnerEnabled(setting.data?.value)) return null;

  const periodKey = input.periodKey ?? imRoutinePeriodKey();
  const inputs = scheduledRunInputs(input.actionItemId, periodKey);
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
    action_item_id: input.actionItemId,
    attempt: 1,
    summary: "Implementation Manager activation — draft only.",
    trace: [
      {
        tool: "activation",
        label: "Queued from Implementation Manager activation",
        status: "queued",
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
});

export const acceptImActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => acceptSchema.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const rules = await activePlanRules(data.firmId);
    const replay = replayImplementationPlan({ confirmRules: rules, meta: {} });
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
    let wrote = 0;
    let enqueued = 0;
    const now = new Date().toISOString();

    for (const pilot of pilots) {
      await assertClientAccess(context.supabase as never, userId, pilot.id);
      const planId = await ensureActivePlan(pilot.id);
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
          const meta = routineMapArtifactMeta({
            firmId: data.firmId,
            clientId: pilot.id,
            map,
            hoursSavedPerRun: hours,
            acceptedAt: now,
          });
          const inserted = await db.from("client_artifacts").insert({
            client_id: pilot.id,
            kind: "routine_map",
            meta,
            visibility: "shared",
          }).select("id").maybeSingle();
          if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);
          if (!inserted.error) {
            wrote += 1;
            existing.artifactKeys.add(plan.artifactKey);
          }
        }

        const maxSeqRow = await db
          .from("action_items")
          .select("seq")
          .eq("plan_id", planId)
          .order("seq", { ascending: false })
          .limit(1)
          .maybeSingle();
        const seqStart = ((maxSeqRow.data?.seq as number | undefined) ?? 0) + 1;
        const drafts = activationActionDrafts({
          firmId: data.firmId,
          clientId: pilot.id,
          planId,
          map,
          seqStart,
        }).filter((row) => plan.actionKeys.includes(row.source_move_key));

        const actionIdByKey = new Map<string, string>();
        for (const draft of drafts) {
          const inserted = await db.from("action_items").insert(draft).select("id, source_move_key").maybeSingle();
          if (inserted.error) {
            if (inserted.error.code === "23505") {
              const found = await db
                .from("action_items")
                .select("id, source_move_key")
                .eq("client_id", pilot.id)
                .eq("source_move_key", draft.source_move_key)
                .maybeSingle();
              if (typeof found.data?.id === "string" && typeof found.data.source_move_key === "string") {
                actionIdByKey.set(found.data.source_move_key, found.data.id);
              }
              continue;
            }
            throw new Error(inserted.error.message);
          }
          if (typeof inserted.data?.id === "string" && typeof inserted.data.source_move_key === "string") {
            actionIdByKey.set(inserted.data.source_move_key, inserted.data.id);
            existing.actionKeys.add(inserted.data.source_move_key);
            wrote += 1;
          }
        }

        for (const row of plan.enqueue) {
          const actionItemId =
            actionIdByKey.get(row.actionMoveKey) ??
            (await db
              .from("action_items")
              .select("id")
              .eq("client_id", pilot.id)
              .eq("source_move_key", row.actionMoveKey)
              .maybeSingle()
              .then((res) => (typeof res.data?.id === "string" ? res.data.id : null)));
          if (!actionItemId) continue;
          const run = await enqueueDraftRun({
            agent: row.agent,
            clientId: pilot.id,
            firmId: data.firmId,
            actionItemId,
          });
          enqueued += countNewlyEnqueuedRun(run);
        }
      }
    }

    return { ok: true as const, wrote, enqueued };
  });