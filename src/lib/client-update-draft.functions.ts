/**
 * Approve sends one client update through Resend. Dismiss sends nothing.
 * Auto-send is not implemented. Nothing is posted to a ledger.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CLIENT_UPDATE_DRAFT_KIND,
  clientUpdateIdempotencyKey,
  dismissClientUpdatePatch,
  planClientUpdateSend,
  publicSendError,
  readClientUpdateAudit,
  sentClientUpdatePatch,
} from "@/lib/client-update-draft";

const SEND_TIMEOUT_MS = 7_000;

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Query = PromiseLike<DbResult<Row | null>> & {
  eq: (column: string, value: string) => Query;
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

function evidenceOf(row: Row): Record<string, unknown> {
  const evidence = row.evidence;
  return evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? (evidence as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function relationMissing(message: string): boolean {
  return /does not exist|schema cache|Could not find the table/i.test(message);
}

const SEND_REFUSAL: Record<string, string> = {
  auto_send_off: "Auto-send is off. Nothing was sent.",
  approval_required: "A named accountant has to approve this before it is sent.",
  practice_name: "The practice needs a name before this can be sent.",
  reply_to: "Your email is missing, so nothing was sent.",
  recipient: "This client has no email address.",
  branded: "Remove the product name from the subject and message before sending.",
  empty: "Add a subject and a message before sending.",
};

export const reviewClientUpdateDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        findingId: z.string().uuid(),
        action: z.enum(["approve", "dismiss"]),
        subject: z.string().max(300).optional(),
        body: z.string().max(8000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    const found = await admin()
      .from("agent_findings")
      .select("id, client_id, kind, status, title, detail, evidence, dismissed_reason")
      .eq("id", data.findingId)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    if (!found.data?.id || typeof found.data.client_id !== "string") throw new Error("Draft not found");
    if (found.data.kind !== CLIENT_UPDATE_DRAFT_KIND) throw new Error("That finding is not a client update");

    const access = await (context.supabase as unknown as AccessClient).rpc("has_client_access", {
      _user_id: userId,
      _client_id: found.data.client_id,
    });
    if (access.error) throw new Error(access.error.message);
    if (!access.data) throw new Error("You do not have access to this client");

    const evidence = evidenceOf(found.data);
    const audit = readClientUpdateAudit(evidence);
    if (data.action === "dismiss") {
      if (audit || found.data.status === "dismissed" || textOf(found.data.dismissed_reason)) {
        if (audit) throw new Error("This update was already sent.");
        return { ok: true as const, status: "dismissed" as const };
      }
      const updated = await admin().from("agent_findings").update(dismissClientUpdatePatch(evidence)).eq("id", data.findingId);
      if (updated.error) throw new Error(updated.error.message);
      return { ok: true as const, status: "dismissed" as const };
    }

    if (audit) {
      return { ok: true as const, status: "already_sent" as const, resendMessageId: audit.resendMessageId };
    }
    if (found.data.status === "dismissed" || textOf(found.data.dismissed_reason)) {
      throw new Error("This update was dismissed.");
    }

    const client = await admin()
      .from("clients")
      .select("id, contact_email, firm_id")
      .eq("id", found.data.client_id)
      .maybeSingle();
    if (client.error) throw new Error(client.error.message);
    const firmId = textOf(client.data?.firm_id);
    if (!firmId) throw new Error("This client is not with a practice.");
    const firm = await admin().from("firms").select("id, name, owner_user_id").eq("id", firmId).maybeSingle();
    if (firm.error) throw new Error(firm.error.message);
    const member = await admin()
      .from("firm_memberships")
      .select("user_id")
      .eq("firm_id", firmId)
      .eq("user_id", userId)
      .maybeSingle();
    if (member.error) throw new Error(member.error.message);
    const accountant = textOf(firm.data?.owner_user_id) === userId || Boolean(member.data?.user_id);
    if (!accountant) throw new Error("Only an accountant at this practice can send this.");

    const profile = await admin().from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    const approverName = textOf(profile.data?.full_name);
    const claimsEmail = textOf((context.claims as { email?: string } | null)?.email);
    const accountantEmail = textOf(profile.data?.email) || claimsEmail;
    const subject = (data.subject ?? textOf(found.data.title)).trim();
    const body = (data.body ?? textOf(found.data.detail)).trim();
    const approvedAt = new Date().toISOString();
    const planned = planClientUpdateSend({
      approval: approverName ? { approverName, approvedAt } : null,
      practiceName: textOf(firm.data?.name),
      accountantEmail,
      to: textOf(client.data?.contact_email),
      subject,
      body,
      fromEmailRaw: process.env.RESEND_FROM_EMAIL,
    });
    if (!planned.send) throw new Error(SEND_REFUSAL[planned.reason] ?? "Nothing was sent.");

    const suppressed = await admin()
      .from("suppressed_emails")
      .select("email")
      .eq("email", planned.payload.to[0])
      .maybeSingle();
    if (suppressed.error && !relationMissing(suppressed.error.message)) {
      throw new Error("Could not verify the suppression list, so nothing was sent.");
    }
    if (suppressed.data?.email) throw new Error("This address is on the suppression list, so nothing was sent.");

    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new Error("Sending is not configured, so nothing was sent.");

    const resendBody = JSON.stringify(planned.payload);
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": clientUpdateIdempotencyKey(data.findingId, planned.payload.text),
        },
        body: resendBody,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Email send timed out, so it was not logged as sent.");
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(publicSendError(res.status, errText));
    }
    let resendMessageId = "";
    try {
      const payload = (await res.json()) as { id?: string };
      resendMessageId = textOf(payload.id);
    } catch {
      resendMessageId = "";
    }
    if (!resendMessageId) {
      throw new Error("The send did not return a message id, so it was not logged. Send the same text again to reuse the original.");
    }

    const patch = sentClientUpdatePatch({
      evidence,
      userId,
      approverName,
      approvedAt,
      resendMessageId,
      finalText: planned.payload.text,
      subject: planned.payload.subject,
    });
    const updated = await admin().from("agent_findings").update(patch).eq("id", data.findingId);
    if (updated.error) {
      throw new Error(`Sent (${resendMessageId}) but the audit did not save. Do not send it again.`);
    }
    return { ok: true as const, status: "sent" as const, resendMessageId };
  });
