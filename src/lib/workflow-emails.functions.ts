/**
 * Workflow email engine (P1.3).
 *
 * `runWorkflow` is called by the Next Step card after it syncs data requests.
 * It gathers facts, asks the pure planner what is due, drops anything the log
 * already shows as sent, resolves recipients through the `workflow_recipients`
 * RPC, sends via Resend and records every attempt. Idempotent by construction:
 * the partial unique index on the log makes a second identical send a no-op
 * even under concurrent page loads.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdvisorySnapshot, type LooseSb } from "@/lib/advisory-state.functions";
import { closingBalancesFromCashflow, type SavedCashflowLike } from "@/lib/cash-runway";
import { inviteSiteUrl } from "@/lib/client-invite-email";
import { sendAccessEmail } from "@/lib/practice-access-email";
import {
  dropAlreadySent,
  planWorkflowEmails,
  renderWorkflowEmail,
  type WorkflowEmailIntent,
  type WorkflowEmailKind,
  type WorkflowFacts,
  type WorkflowRecipientRole,
} from "@/lib/workflow-emails";

const PRE_DATA = new Set(["onboarding", "context_collection", "financial_data_collection"]);

function isMissingWorkflowRelation(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : "";
  return (
    /workflow_(email_log|recipients)/.test(msg) &&
    /does not exist|schema cache|could not find/i.test(msg)
  );
}

export async function gatherWorkflowFacts(
  sb: LooseSb,
  userId: string,
  clientId: string,
  now: string,
): Promise<WorkflowFacts> {
  const snapshot = await loadAdvisorySnapshot(sb, userId, { clientId, eventLimit: 0 });
  const [clientRes, packRes, restartRes] = await Promise.all([
    sb
      .from("clients")
      .select("name, firm_id, cashflow, last_forecast_at")
      .eq("id", clientId)
      .maybeSingle(),
    sb
      .from("advisory_packs")
      .select("id, version, status, requires_review, reviewed_at, review_note, delivered_at")
      .eq("client_id", clientId)
      .neq("status", "superseded")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("advisory_events")
      .select("id, created_at")
      .eq("client_id", clientId)
      .eq("event", "cycle.restarted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (clientRes.error) throw new Error(clientRes.error.message);
  const client = clientRes.data as {
    name: string;
    firm_id: string | null;
    cashflow: SavedCashflowLike | null;
    last_forecast_at: string | null;
  } | null;
  if (!client) throw new Error("Client not found");

  let firmName: string | null = null;
  if (client.firm_id) {
    const { data: firm } = await sb
      .from("firms")
      .select("name")
      .eq("id", client.firm_id)
      .maybeSingle();
    firmName = (firm as { name?: string } | null)?.name ?? null;
  }

  const pack = packRes.error ? null : (packRes.data as Record<string, unknown> | null);
  const okStatus = ["draft", "in_review", "changes_requested", "approved", "rejected"];
  const closings = closingBalancesFromCashflow(client.cashflow);
  const restart = restartRes.error
    ? null
    : (restartRes.data as { id: number | string; created_at: string } | null);

  return {
    clientId,
    clientName: client.name,
    hasFirm: client.firm_id !== null,
    firmName,
    pack:
      pack && okStatus.includes(String(pack.status))
        ? {
            id: String(pack.id),
            version: Number(pack.version ?? 0),
            status: String(pack.status) as NonNullable<WorkflowFacts["pack"]>["status"],
            requiresReview: pack.requires_review === true,
            reviewedAt: (pack.reviewed_at as string | null) ?? null,
            reviewNote: (pack.review_note as string | null) ?? null,
            deliveredAt: (pack.delivered_at as string | null) ?? null,
          }
        : null,
    forecast:
      closings && client.last_forecast_at
        ? { lastForecastAt: client.last_forecast_at, closings }
        : null,
    lastRestart: restart ? { eventId: restart.id, at: restart.created_at } : null,
    pastDataCollection: !PRE_DATA.has(snapshot.state),
    now,
  };
}

export type RunWorkflowResult = {
  migrated: boolean;
  planned: number;
  sent: number;
  skipped: Array<{ kind: WorkflowEmailKind; reason: string }>;
};

type Recipient = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: WorkflowRecipientRole;
};

export const runWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        now: z.string().datetime().optional(),
        /** Plan and log but never call Resend (tests / previews). */
        dryRun: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RunWorkflowResult> => {
    const sb = context.supabase as unknown as LooseSb;
    const now = data.now ?? new Date().toISOString();
    const facts = await gatherWorkflowFacts(sb, context.userId, data.clientId, now);
    const intents = planWorkflowEmails(facts);
    if (intents.length === 0) return { migrated: true, planned: 0, sent: 0, skipped: [] };

    const { data: recRows, error: recErr } = await sb.rpc("workflow_recipients", {
      p_client_id: data.clientId,
    });
    if (recErr) {
      if (isMissingWorkflowRelation(recErr))
        return { migrated: false, planned: intents.length, sent: 0, skipped: [] };
      throw new Error(recErr.message);
    }
    const recipients = ((recRows ?? []) as Recipient[]).filter(
      (r) => r.email && r.email.includes("@"),
    );

    // Fan out: one row per (intent, matching recipient).
    const fanned = intents.flatMap((intent: WorkflowEmailIntent) =>
      recipients
        .filter((r) => r.role === intent.audience)
        .map((r) => ({ ...intent, email: r.email, recipient: r })),
    );
    const skipped: RunWorkflowResult["skipped"] = [];
    for (const intent of intents) {
      if (!recipients.some((r) => r.role === intent.audience)) {
        skipped.push({
          kind: intent.kind,
          reason: `no ${intent.audience} recipient with an email`,
        });
      }
    }
    if (fanned.length === 0) return { migrated: true, planned: intents.length, sent: 0, skipped };

    const { data: logRows, error: logErr } = await sb
      .from("workflow_email_log")
      .select("kind, ref_key, recipient_email, status")
      .eq("client_id", data.clientId)
      .in("kind", Array.from(new Set(fanned.map((f) => f.kind))))
      .eq("status", "sent");
    if (logErr) {
      if (isMissingWorkflowRelation(logErr))
        return { migrated: false, planned: intents.length, sent: 0, skipped };
      throw new Error(logErr.message);
    }
    const due = dropAlreadySent(fanned, (logRows ?? []) as Parameters<typeof dropAlreadySent>[1]);

    let sent = 0;
    const siteUrl = inviteSiteUrl();
    for (const d of due) {
      const mail = renderWorkflowEmail({
        intent: d,
        clientId: data.clientId,
        clientName: facts.clientName,
        recipientName: d.recipient.full_name,
        siteUrl,
      });
      let status: "sent" | "failed" | "skipped" = "sent";
      let error: string | null = null;
      if (data.dryRun) {
        status = "skipped";
        error = "dry run";
      } else {
        const res = await sendAccessEmail({
          to: d.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          idempotencyKey: `workflow:${data.clientId}:${d.kind}:${d.refKey}:${d.email}`.slice(
            0,
            256,
          ),
        });
        if (!res.ok) {
          status = "failed";
          error = res.error;
        }
      }
      const { error: insErr } = await sb.from("workflow_email_log").insert({
        client_id: data.clientId,
        kind: d.kind,
        ref_key: d.refKey,
        recipient_user_id: d.recipient.user_id,
        recipient_email: d.email,
        recipient_role: d.audience,
        status,
        subject: mail.subject,
        error,
        triggered_by: context.userId,
      });
      // A unique-violation here means a concurrent run already sent it: fine.
      if (insErr && !/duplicate key|unique/i.test(insErr.message ?? "")) {
        throw new Error(insErr.message);
      }
      if (status === "sent" && !insErr) sent += 1;
      if (status === "failed") skipped.push({ kind: d.kind, reason: error ?? "send failed" });
    }
    return { migrated: true, planned: intents.length, sent, skipped };
  });
