/**
 * Thin runner for accepted IM routines — loads maps/actions/runs and enqueues draft runs.
 * No SQL changes. Callable on demand; Vercel cron calls /api/im-routine-cron.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mergeRoutineSettingsMeta, parseRoutineMapMeta } from "@/lib/client-routines";
import {
  ROUTINE_AUTO_SEND_UNLOCK,
  readRoutineAutoSend,
  routineAutoSendBlocked,
  routineAutoSendEligible,
  withRoutineAutoSend,
  type RoutineAutoSendState,
} from "@/lib/routine-auto-send";
import {
  assertClientBelongsToFirm,
  loadImRoutineScheduleContext,
  runImRoutineSchedulerCore,
} from "@/lib/im-routine-scheduler.service";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  select: (columns: string) => Filter;
  maybeSingle: () => Promise<DbResult<Row | null>>;
};

type Admin = {
  from: (table: string) => {
    select: (columns: string) => Filter;
    update: (row: Row) => Filter;
  };
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

export const loadClientImRoutineScheduleContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    const access = await (context.supabase as { rpc: (fn: string, args: Record<string, string>) => Promise<{ data: unknown; error: DbError }> }).rpc(
      "has_client_access",
      { _user_id: userId, _client_id: data.clientId },
    );
    if (access.error) throw new Error(access.error.message);
    if (!access.data) throw new Error("You do not have access to this client");
    const scheduleContext = await loadImRoutineScheduleContext(data.clientId);
    return { ok: true as const, scheduleContext };
  });

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
  if (data.clientId) await assertClientBelongsToFirm(data.clientId, data.firmId);
    const result = await runImRoutineSchedulerCore({
      firmId: data.firmId,
      clientId: data.clientId,
    });
    return { ok: result.ok, enqueued: result.enqueued, periodKey: result.periodKey };
  });

export const saveClientRoutineSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firmId: z.string().uuid(),
        clientId: z.string().uuid(),
        artifactId: z.string().uuid(),
        schedule: z.unknown(),
        action: z.unknown(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    await assertClientBelongsToFirm(data.clientId, data.firmId);
    const db = admin();
    const existing = await db
      .from("client_artifacts")
      .select("id, meta")
      .eq("id", data.artifactId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("Routine map was not found");
    const next = mergeRoutineSettingsMeta(existing.data.meta, {
      schedule: data.schedule,
      action: data.action,
    });
    if (!next) throw new Error("That schedule or action cannot be saved");
    const updated = await db
      .from("client_artifacts")
      .update({ meta: next })
      .eq("id", data.artifactId)
      .eq("client_id", data.clientId)
      .select("id, meta")
      .maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    const parsed = parseRoutineMapMeta(updated.data?.meta ?? next);
    if (!parsed?.schedule || !parsed.action) throw new Error("Saved routine settings could not be read back");
    return { ok: true as const, schedule: parsed.schedule, action: parsed.action };
  });

export const setClientRoutineAutoSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firmId: z.string().uuid(),
        clientId: z.string().uuid(),
        artifactId: z.string().uuid(),
        on: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    await assertClientBelongsToFirm(data.clientId, data.firmId);
    const db = admin();
    const existing = await db
      .from("client_artifacts")
      .select("id, meta")
      .eq("id", data.artifactId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data?.meta || typeof existing.data.meta !== "object" || Array.isArray(existing.data.meta)) {
      throw new Error("Routine map was not found");
    }
    const meta = existing.data.meta as Record<string, unknown>;
    if (routineAutoSendBlocked(meta) || !routineAutoSendEligible(meta)) {
      if (data.on) throw new Error("Auto-send is not available for this routine.");
      const cleared = { ...meta };
      delete cleared.autoSend;
      const updated = await db
        .from("client_artifacts")
        .update({ meta: cleared })
        .eq("id", data.artifactId)
        .eq("client_id", data.clientId)
        .select("id")
        .maybeSingle();
      if (updated.error) throw new Error(updated.error.message);
      return { ok: true as const, autoSend: readRoutineAutoSend(cleared) };
    }
    const current = readRoutineAutoSend(meta);
    let next: RoutineAutoSendState;
    if (!data.on) {
      next = { ...current, on: false };
    } else {
      if (current.clean < ROUTINE_AUTO_SEND_UNLOCK) {
        throw new Error("Auto-send unlocks after 3 clean approvals. Nothing was sent.");
      }
      const profile = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();
      if (profile.error) throw new Error(profile.error.message);
      const byName = typeof profile.data?.full_name === "string" ? profile.data.full_name.replace(/\s+/g, " ").trim() : "";
      if (!byName || byName.includes("@")) throw new Error("Auto-send needs your name, not an email address.");
      next = { ...current, on: true, byName, byUserId: userId, at: new Date().toISOString() };
    }
    const saved = withRoutineAutoSend(meta, next);
    const updated = await db
      .from("client_artifacts")
      .update({ meta: saved })
      .eq("id", data.artifactId)
      .eq("client_id", data.clientId)
      .select("id")
      .maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    return { ok: true as const, autoSend: readRoutineAutoSend(saved) };
  });
