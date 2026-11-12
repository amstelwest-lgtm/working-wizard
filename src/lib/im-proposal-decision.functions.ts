/**
 * Read and decide Implementation Manager proposals.
 * Writes agent_findings only. Does not enqueue and does not edit brain rules.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  IM_PROPOSAL_KINDS,
  approveFindingPatch,
  dismissFindingPatch,
  isImProposalKind,
} from "@/lib/im-proposal-decision";

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Query = PromiseLike<DbResult<Row[] | null>> & {
  eq: (column: string, value: string) => Query;
  in: (column: string, values: readonly string[]) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<DbResult<Row | null>>;
};

type Admin = {
  from: (table: string) => {
    select: (columns: string) => Query;
    update: (row: Row) => { eq: (column: string, value: string) => Promise<DbResult<null>> };
  };
};

type AccessClient = {
  rpc: (
    fn: string,
    args: Record<string, string>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
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

function evidenceOf(row: Row): Record<string, unknown> {
  const evidence = row.evidence;
  return evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? (evidence as Record<string, unknown>)
    : {};
}

function costLabelOf(evidence: Record<string, unknown>): string | null {
  return typeof evidence.costLabel === "string" && evidence.costLabel.trim() ? evidence.costLabel : null;
}

function costUsdOf(evidence: Record<string, unknown>): number | null {
  const figures = evidence.figures;
  if (!figures || typeof figures !== "object" || Array.isArray(figures)) return null;
  const value = (figures as Record<string, unknown>).estimatedCostUsd;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ImProposalRow = {
  id: string;
  title: string;
  detail: string;
  kind: string;
  decision: string | null;
  costLabel: string | null;
  estimatedCostUsd: number | null;
  model: string | null;
};

function toProposalRow(row: Row): ImProposalRow | null {
  if (typeof row.id !== "string" || typeof row.kind !== "string" || !isImProposalKind(row.kind)) return null;
  const evidence = evidenceOf(row);
  const decision =
    typeof evidence.decision === "string"
      ? evidence.decision
      : row.status === "dismissed"
        ? "dismissed"
        : null;
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "Proposal",
    detail: typeof row.detail === "string" ? row.detail : "",
    kind: row.kind,
    decision,
    costLabel: costLabelOf(evidence),
    estimatedCostUsd: costUsdOf(evidence),
    model: typeof evidence.model === "string" ? evidence.model : null,
  };
}

export const listImProposals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ firmId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    await assertFirmAccess(userId, data.firmId);
    const clients = await admin().from("clients").select("id").eq("firm_id", data.firmId).limit(50);
    if (clients.error) throw new Error(clients.error.message);
    const ids = (clients.data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");
    if (ids.length === 0) return { proposals: [] as ImProposalRow[] };
    const findings = await admin()
      .from("agent_findings")
      .select("id, title, detail, kind, status, evidence, approved_by")
      .in("client_id", ids)
      .in("kind", IM_PROPOSAL_KINDS)
      .limit(40);
    if (findings.error) throw new Error(findings.error.message);
    return {
      proposals: (findings.data ?? []).map(toProposalRow).filter((row): row is ImProposalRow => row !== null),
    };
  });

export const decideImProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        findingId: z.string().uuid(),
        decision: z.enum(["approve", "dismiss"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    const found = await admin()
      .from("agent_findings")
      .select("id, client_id, kind, status, evidence, approved_by")
      .eq("id", data.findingId)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    if (!found.data?.id || typeof found.data.client_id !== "string") throw new Error("Proposal not found");
    if (typeof found.data.kind !== "string" || !isImProposalKind(found.data.kind)) {
      throw new Error("That finding is not a proposal");
    }
    const access = await (context.supabase as unknown as AccessClient).rpc("has_client_access", {
      _user_id: userId,
      _client_id: found.data.client_id,
    });
    if (access.error) throw new Error(access.error.message);
    if (!access.data) throw new Error("You do not have access to this client");

    const evidence = evidenceOf(found.data);
    if (typeof evidence.decision === "string" || found.data.status === "dismissed" || found.data.approved_by) {
      return { ok: true as const, decision: typeof evidence.decision === "string" ? evidence.decision : "approved" };
    }
    const patch =
      data.decision === "approve"
        ? approveFindingPatch({ userId, now: new Date().toISOString(), evidence })
        : dismissFindingPatch(evidence);
    const updated = await admin().from("agent_findings").update(patch).eq("id", data.findingId);
    if (updated.error) throw new Error(updated.error.message);
    return { ok: true as const, decision: data.decision === "approve" ? "approved" : "dismissed" };
  });
