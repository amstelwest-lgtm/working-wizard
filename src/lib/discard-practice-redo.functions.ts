/**
 * Retire the in-progress practice redo. The confirmed workflow rows stay active.
 * Firm members have no update policy on private brain rules, so this checks
 * the firm and then writes with the service role. It is not a new table or RPC.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SETUP_PARTNER_INTERVIEW_EVENT, SETUP_PARTNER_INTERVIEW_TASK } from "@/lib/firm-interview-draft";

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  is: (column: string, value: null) => Filter;
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

export const discardPracticeRedo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ firmId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const retired = await admin()
      .from("milon_brain_rules")
      .update({ status: "retired" })
      .eq("firm_id", data.firmId)
      .is("client_id", null)
      .eq("task_type", SETUP_PARTNER_INTERVIEW_TASK)
      .eq("source_event", SETUP_PARTNER_INTERVIEW_EVENT)
      .eq("status", "active");
    if (retired.error) throw new Error(retired.error.message);
    return { ok: true as const };
  });
