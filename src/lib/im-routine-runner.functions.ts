/**
 * Thin runner for accepted IM routines — loads maps/actions/runs and enqueues draft runs.
 * No SQL changes. Callable on demand; Vercel cron calls /api/im-routine-cron.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  maybeSingle: () => Promise<DbResult<Row | null>>;
};

type Admin = {
  from: (table: string) => {
    select: (columns: string) => Filter;
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