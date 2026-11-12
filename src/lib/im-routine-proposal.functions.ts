/**
 * Persist routine proposals as agent_findings.
 * The run is skipped. This file does not enqueue or schedule.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  IM_ROUTINE_KIND,
  routineFindingInsert,
  routineIdempotencyKey,
  routineProposals,
  routineRunInsert,
  type RoutineProposal,
} from "@/lib/im-routine-proposal";

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Filter = {
  eq: (column: string, value: string) => Filter;
  order: (column: string, options: { ascending: boolean }) => Filter;
  limit: (count: number) => Filter;
  maybeSingle: () => Promise<DbResult<Row | null>>;
};

type Admin = {
  from: (table: string) => {
    select: (columns: string) => Filter;
    insert: (row: Row) => {
      select: (columns: string) => {
        maybeSingle: () => Promise<DbResult<Row | null>>;
      };
    };
  };
};

const stepSchema = z.object({
  step: z.string().min(1).max(500),
  step_type: z.string().min(1).max(80),
  capability: z.string().min(1).max(80),
  covers: z.string().min(1).max(200),
  bucket: z.enum(["covered", "client_setup", "product_gap", "bespoke"]),
  fit_note: z.string().max(500),
  effort: z.enum(["S", "M", "L"]),
  dedupe_key: z.string().min(1).max(120),
});

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

async function anchorClient(firmId: string): Promise<string | null> {
  const found = await admin()
    .from("clients")
    .select("id")
    .eq("firm_id", firmId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  return typeof found.data?.id === "string" ? found.data.id : null;
}

async function existingRun(proposal: RoutineProposal, clientId: string): Promise<string | null> {
  const key = routineIdempotencyKey(clientId, proposal.dedupeKey);
  const found = await admin()
    .from("agent_runs")
    .select("id")
    .eq("agent", proposal.agent)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  return typeof found.data?.id === "string" ? found.data.id : null;
}

async function existingFinding(runId: string): Promise<string | null> {
  const found = await admin()
    .from("agent_findings")
    .select("id")
    .eq("run_id", runId)
    .eq("kind", IM_ROUTINE_KIND)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  return typeof found.data?.id === "string" ? found.data.id : null;
}

async function storeOne(proposal: RoutineProposal, clientId: string, firmId: string): Promise<void> {
  let runId = await existingRun(proposal, clientId);
  if (!runId) {
    const inserted = await admin()
      .from("agent_runs")
      .insert(routineRunInsert({ proposal, clientId, firmId, finishedAt: new Date().toISOString() }))
      .select("id")
      .maybeSingle();
    if (inserted.error) {
      runId = await existingRun(proposal, clientId);
      if (!runId) throw new Error(inserted.error.message);
    } else if (typeof inserted.data?.id === "string") {
      runId = inserted.data.id;
    }
  }
  if (!runId) throw new Error("Could not store the routine proposal");
  if (await existingFinding(runId)) return;
  const finding = await admin()
    .from("agent_findings")
    .insert(routineFindingInsert({ proposal, clientId, runId }))
    .select("id")
    .maybeSingle();
  if (finding.error && !(await existingFinding(runId))) throw new Error(finding.error.message);
}

export const saveImRoutineProposals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firmId: z.string().uuid(),
        steps: z.array(stepSchema).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const proposals = routineProposals(data.steps);
    if (proposals.length === 0) return { ok: true as const, stored: 0, clientId: null };
    const clientId = await anchorClient(data.firmId);
    if (!clientId) {
      return { ok: false as const, error: "Add a client before these proposals can be stored." };
    }
    for (const proposal of proposals) {
      await storeOne(proposal, clientId, data.firmId);
    }
    return { ok: true as const, stored: proposals.length, clientId };
  });
