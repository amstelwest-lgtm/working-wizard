/**
 * Approve one agent_send_draft.
 * The only send is mintClientAgentSend. This file does not insert a send row
 * and does not call the mailer itself.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { agentSendApproval, readAgentSendDraft } from "@/lib/agent-send-draft";
import { mintClientAgentSend } from "@/lib/client-agent-send.functions";

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
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

export const approveAgentSendDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        findingId: z.string().uuid(),
        recipientEmail: z.string().max(200),
        recipientFirstName: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) return { ok: false as const, reason: "needs_named_accountant" as const };

    const db = admin();
    const profile = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    const approverName = typeof profile.data?.full_name === "string" ? profile.data.full_name : "";

    const found = await db
      .from("agent_findings")
      .select("id, client_id, kind, evidence, status")
      .eq("id", data.findingId)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    const row = found.data;
    const clientId = typeof row?.client_id === "string" ? row.client_id : "";
    if (!row || !clientId || row.kind !== "agent_send_draft") {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (row.status === "dismissed") return { ok: false as const, reason: "already_sent" as const };

    const draft = readAgentSendDraft({ clientId, evidence: row.evidence });
    if (!draft) {
      const evidence =
        row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
          ? (row.evidence as Record<string, unknown>)
          : null;
      if (evidence?.sent === true || evidence?.minted === true) {
        return {
          ok: true as const,
          already: true,
          sendId: typeof evidence.send_id === "string" ? evidence.send_id : null,
        };
      }
      return { ok: false as const, reason: "not_found" as const };
    }

    const plan = agentSendApproval({
      draft,
      approverName,
      recipientEmail: data.recipientEmail,
      recipientFirstName: data.recipientFirstName,
    });
    if (!plan.ok) return plan;

    const minted = await mintClientAgentSend({ data: plan.mint });
    if (!minted.ok && minted.reason !== "already_open") return minted;
    const sendId = minted.sendId;
    const prior =
      row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : {};
    const now = new Date().toISOString();
    const updated = await db
      .from("agent_findings")
      .update({
        approved_by: userId,
        approved_at: now,
        evidence: {
          ...prior,
          figures:
            prior.figures && typeof prior.figures === "object" && !Array.isArray(prior.figures)
              ? prior.figures
              : { checklistCount: draft.checklist.length },
          draft: false,
          sent: true,
          minted: true,
          decision: "approved",
          approverId: userId,
          approverName: plan.approverName,
          send_id: sendId,
        },
      })
      .eq("id", data.findingId)
      .select("id")
      .maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    return { ok: true as const, already: !minted.ok, sendId, approverName: plan.approverName };
  });
