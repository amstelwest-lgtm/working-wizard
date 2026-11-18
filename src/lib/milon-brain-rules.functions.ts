/**
 * Firm brain rules for the per-bot Rules tab. Retire/edit use service role after
 * access checks — private rows have no firm-member update policy.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { brainRuleTaskTypesForTab, clipMilonBrainRuleText, type BotRulesTab } from "./milon-brain-rules.ts";

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  is: (column: string, value: null) => Filter;
  in: (column: string, values: string[]) => Filter;
  order: (column: string, options: { ascending: boolean }) => Filter;
  limit: (count: number) => { maybeSingle: () => Promise<DbResult<Row | null>> };
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

async function assertClientInFirm(clientId: string, firmId: string): Promise<void> {
  const db = admin();
  const client = await db.from("clients").select("firm_id").eq("id", clientId).maybeSingle();
  if (client.error) throw new Error(client.error.message);
  if (client.data?.firm_id !== firmId) throw new Error("Client is not in this firm");
}

export const listBotBrainRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firmId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
        tab: z.enum(["financial_manager", "analyst", "advisor", "implementation_manager"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    if (data.clientId) await assertClientInFirm(data.clientId, data.firmId);
    const taskTypes = [...brainRuleTaskTypesForTab(data.tab as BotRulesTab)];
    const { data: rows, error } = await context.supabase
      .from("milon_brain_rules")
      .select("id, rule_text, task_type, client_id, created_at")
      .eq("firm_id", data.firmId)
      .eq("status", "active")
      .eq("layer", "private")
      .in("task_type", taskTypes)
      .order("created_at", { ascending: false })
      .limit(120);
    if (error) throw new Error(error.message);
    const filtered = (rows ?? []).filter((row) => {
      const clientId = row.client_id as string | null;
      if (!data.clientId) return true;
      return clientId == null || clientId === data.clientId;
    });
    return filtered.map((row) => ({
      id: row.id as string,
      rule_text: row.rule_text as string,
      task_type: row.task_type as string,
      client_id: (row.client_id as string | null) ?? null,
      created_at: row.created_at as string,
    }));
  });

export const retireBotBrainRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ firmId: z.string().uuid(), ruleId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const retired = await admin()
      .from("milon_brain_rules")
      .update({ status: "retired" })
      .eq("id", data.ruleId)
      .eq("firm_id", data.firmId)
      .eq("status", "active")
      .eq("layer", "private");
    if ((retired as unknown as { error: DbError }).error) {
      throw new Error((retired as unknown as { error: DbError }).error?.message ?? "Could not retire the rule");
    }
    return { ok: true as const };
  });

export const editBotBrainRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ firmId: z.string().uuid(), ruleId: z.string().uuid(), ruleText: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const rule_text = clipMilonBrainRuleText(data.ruleText);
    const updated = await admin()
      .from("milon_brain_rules")
      .update({ rule_text })
      .eq("id", data.ruleId)
      .eq("firm_id", data.firmId)
      .eq("status", "active")
      .eq("layer", "private");
    if ((updated as unknown as { error: DbError }).error) {
      throw new Error((updated as unknown as { error: DbError }).error?.message ?? "Could not update the rule");
    }
    return { ok: true as const, rule_text };
  });
