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
  clientUpdateSendLocked,
  dismissClientUpdatePatch,
  planClientUpdateSend,
  publicSendError,
  readClientUpdateAudit,
  sentClientUpdatePatch,
} from "@/lib/client-update-draft";
import { imRoutineMapArtifactFilter } from "@/lib/im-activation-persist";
import {
  nextRoutineAutoSend,
  readRoutineAutoSend,
  routineAutoSendDue,
  routineAutoSendEligible,
  routineFromMoveKey,
  withRoutineAutoSend,
} from "@/lib/routine-auto-send";

const SEND_TIMEOUT_MS = 7_000;

type Row = Record<string, unknown>;
type DbError = { message: string } | null;
type DbResult<T> = { data: T; error: DbError };

type Query = PromiseLike<DbResult<Row | Row[] | null>> & {
  eq: (column: string, value: string) => Query;
  or: (filters: string) => Query;
  contains: (column: string, value: Record<string, unknown>) => Query;
  gte: (column: string, value: string) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<DbResult<Row | null>>;
};

type Admin = {
  from: (table: string) => {
    select: (columns: string) => Query;
    update: (row: Row) => Query;
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
      .select("id, client_id, run_id, kind, status, title, detail, evidence, dismissed_reason, created_at")
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
    if (clientUpdateSendLocked(evidence)) {
      if (data.action === "dismiss" || !audit) {
        throw new Error("This update was already sent. It will not be sent again.");
      }
      return { ok: true as const, status: "already_sent" as const, resendMessageId: audit.resendMessageId };
    }
    if (data.action === "dismiss") {
      if (audit || found.data.status === "dismissed" || textOf(found.data.dismissed_reason)) {
        if (audit) throw new Error("This update was already sent.");
        return { ok: true as const, status: "dismissed" as const };
      }
      const updated = await admin().from("agent_findings").update(dismissClientUpdatePatch(evidence)).eq("id", data.findingId);
      if (updated.error) throw new Error(updated.error.message);
      return { ok: true as const, status: "dismissed" as const };
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

    const reserved = await reserveClientUpdateSend(data.findingId, evidence);
    if (reserved.error) throw new Error("Could not reserve the send, so nothing was sent.");

    const resendBody = JSON.stringify(planned.payload);
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": clientUpdateIdempotencyKey(data.findingId),
        },
        body: resendBody,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      throw new Error("Email send timed out. It will not be sent again.");
    }
    if (!res.ok) {
      await clearClientUpdateSendReserve(data.findingId, evidence);
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
      throw new Error("The send did not return a message id, so it was not logged. It will not be sent again.");
    }

    const routineArtifactId = await routineArtifactIdForFinding(found.data);
    const patch = sentClientUpdatePatch({
      evidence,
      userId,
      approverName,
      approvedAt,
      resendMessageId,
      finalText: planned.payload.text,
      subject: planned.payload.subject,
      routineArtifactId,
    });
    const updated = await admin().from("agent_findings").update(patch).eq("id", data.findingId);
    if (updated.error) {
      throw new Error(`Sent (${resendMessageId}) but the audit did not save. Do not send it again.`);
    }
    await noteClientUpdateApproval({
      clientId: textOf(found.data.client_id),
      artifactId: routineArtifactId,
      subject,
      body,
      storedTitle: textOf(found.data.title),
      storedDetail: textOf(found.data.detail),
    });
    return { ok: true as const, status: "sent" as const, resendMessageId };
  });

function keptFigures(evidence: Record<string, unknown>): Record<string, unknown> {
  const figures = evidence.figures;
  if (figures && typeof figures === "object" && !Array.isArray(figures) && Object.keys(figures).length > 0) {
    return figures as Record<string, unknown>;
  }
  return { sources: 1 };
}

function reserveClientUpdateSend(findingId: string, evidence: Record<string, unknown>) {
  return admin()
    .from("agent_findings")
    .update({ evidence: { ...evidence, figures: keptFigures(evidence), sending: true } })
    .eq("id", findingId);
}

function clearClientUpdateSendReserve(findingId: string, evidence: Record<string, unknown>) {
  return admin()
    .from("agent_findings")
    .update({ evidence: { ...evidence, figures: keptFigures(evidence), sending: false } })
    .eq("id", findingId);
}

function sameCopy(left: string, right: string): boolean {
  return left.replace(/\s+/g, " ").trim() === right.replace(/\s+/g, " ").trim();
}

async function routineArtifactIdForFinding(finding: Row): Promise<string | null> {
  const evidence = evidenceOf(finding);
  const stamped = textOf(evidence.routineArtifactId);
  if (stamped) return stamped;
  const runId = textOf(finding.run_id);
  const clientId = textOf(finding.client_id);
  if (!runId || !clientId) return null;
  const run = await admin().from("agent_runs").select("action_item_id").eq("id", runId).maybeSingle();
  if (run.error || !run.data) return null;
  const actionItemId = textOf(run.data.action_item_id);
  if (!actionItemId) return null;
  const action = await admin()
    .from("action_items")
    .select("source_move_key")
    .eq("id", actionItemId)
    .maybeSingle();
  if (action.error || !action.data) return null;
  const routine = routineFromMoveKey(textOf(action.data.source_move_key));
  if (!routine) return null;
  const maps = (await admin()
    .from("client_artifacts")
    .select("id, meta")
    .eq("client_id", clientId)
    .or(imRoutineMapArtifactFilter())
    .limit(12)) as DbResult<Row[] | null>;
  if (maps.error) return null;
  const match = (maps.data ?? []).find((row) => {
    const meta = evidenceOf(row);
    return meta.routine === routine && routineAutoSendEligible(meta);
  });
  return match ? textOf(match.id) || null : null;
}

/** Clean approvals advance the streak. An edit clears it and turns the flag off. Reaching 3 does not send. */
async function noteClientUpdateApproval(input: {
  clientId: string;
  artifactId: string | null;
  subject: string;
  body: string;
  storedTitle: string;
  storedDetail: string;
}): Promise<void> {
  if (!input.artifactId || !input.clientId) return;
  const found = await admin()
    .from("client_artifacts")
    .select("id, meta")
    .eq("id", input.artifactId)
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (found.error || !found.data) return;
  const meta = evidenceOf(found.data);
  if (!routineAutoSendEligible(meta)) return;
  const clean = sameCopy(input.subject, input.storedTitle) && sameCopy(input.body, input.storedDetail);
  const next = withRoutineAutoSend(meta, nextRoutineAutoSend(readRoutineAutoSend(meta), clean ? "clean" : "edit"));
  await admin().from("client_artifacts").update({ meta: next }).eq("id", input.artifactId).eq("client_id", input.clientId);
}

async function deliverOptedInClientUpdate(finding: Row): Promise<boolean> {
  const findingId = textOf(finding.id);
  const clientId = textOf(finding.client_id);
  const evidence = evidenceOf(finding);
  if (!findingId || !clientId || clientUpdateSendLocked(evidence)) return false;
  if (finding.status === "dismissed" || textOf(finding.dismissed_reason)) return false;
  const artifactId = await routineArtifactIdForFinding(finding);
  if (!artifactId) return false;
  const map = await admin()
    .from("client_artifacts")
    .select("id, meta")
    .eq("id", artifactId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (map.error || !map.data) return false;
  const meta = evidenceOf(map.data);
  if (!routineAutoSendDue(meta, textOf(finding.created_at))) return false;
  const state = readRoutineAutoSend(meta);
  const userId = state.byUserId ?? "";
  const approverName = state.byName ?? "";
  const client = await admin().from("clients").select("id, contact_email, firm_id").eq("id", clientId).maybeSingle();
  if (client.error) return false;
  const firmId = textOf(client.data?.firm_id);
  if (!firmId) return false;
  const firm = await admin().from("firms").select("id, name, owner_user_id").eq("id", firmId).maybeSingle();
  if (firm.error) return false;
  const member = await admin()
    .from("firm_memberships")
    .select("user_id")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .maybeSingle();
  if (member.error) return false;
  const accountant = textOf(firm.data?.owner_user_id) === userId || Boolean(member.data?.user_id);
  if (!accountant) return false;
  const profile = await admin().from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  if (profile.error) return false;
  const accountantEmail = textOf(profile.data?.email);
  const approvedAt = new Date().toISOString();
  const subject = textOf(finding.title);
  const body = textOf(finding.detail);
  const planned = planClientUpdateSend({
    approval: approverName ? { approverName, approvedAt } : null,
    requestedAutoSend: state.on === true,
    routineOptIn: state.on === true,
    practiceName: textOf(firm.data?.name),
    accountantEmail,
    to: textOf(client.data?.contact_email),
    subject,
    body,
    fromEmailRaw: process.env.RESEND_FROM_EMAIL,
  });
  if (!planned.send) return false;
  const suppressed = await admin()
    .from("suppressed_emails")
    .select("email")
    .eq("email", planned.payload.to[0])
    .maybeSingle();
  if (suppressed.error && !relationMissing(suppressed.error.message)) return false;
  if (suppressed.data?.email) return false;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;
  const reserved = await reserveClientUpdateSend(findingId, evidence);
  if (reserved.error) return false;
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": clientUpdateIdempotencyKey(findingId),
      },
      body: JSON.stringify(planned.payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return false;
  }
  if (!res.ok) {
    await clearClientUpdateSendReserve(findingId, evidence);
    return false;
  }
  let resendMessageId = "";
  try {
    const payload = (await res.json()) as { id?: string };
    resendMessageId = textOf(payload.id);
  } catch {
    resendMessageId = "";
  }
  if (!resendMessageId) return false;
  const patch = sentClientUpdatePatch({
    evidence,
    userId,
    approverName,
    approvedAt,
    resendMessageId,
    finalText: planned.payload.text,
    subject: planned.payload.subject,
    routineArtifactId: artifactId,
  });
  const updated = await admin().from("agent_findings").update(patch).eq("id", findingId);
  return !updated.error;
}

/** Sends client updates whose routine flag is already on. Reaching 3 does not call this. */
export async function flushOptedInClientUpdates(clientId: string): Promise<number> {
  const listed = (await admin()
    .from("agent_findings")
    .select("id, client_id, run_id, kind, status, title, detail, evidence, dismissed_reason, created_at")
    .eq("client_id", clientId)
    .eq("kind", CLIENT_UPDATE_DRAFT_KIND)
    .order("created_at", { ascending: false })
    .limit(20)) as DbResult<Row[] | null>;
  if (listed.error) return 0;
  let sent = 0;
  for (const row of listed.data ?? []) {
    if (row.kind !== CLIENT_UPDATE_DRAFT_KIND) continue;
    try {
      if (await deliverOptedInClientUpdate(row)) sent += 1;
    } catch {
      /* one draft must not stop the routine pass */
    }
  }
  return sent;
}

/** A Resend bounce clears the streak and turns the flag off. */
export async function resetClientUpdateOnBounce(messageId: string): Promise<void> {
  const id = messageId.trim();
  if (!id) return;
  const listed = (await admin()
    .from("agent_findings")
    .select("id, client_id, evidence")
    .eq("kind", CLIENT_UPDATE_DRAFT_KIND)
    .contains("evidence", { audit: { resendMessageId: id } })
    .limit(5)) as DbResult<Row[] | null>;
  if (listed.error) return;
  for (const row of listed.data ?? []) {
    const evidence = evidenceOf(row);
    const audit = readClientUpdateAudit(evidence);
    if (!audit || audit.resendMessageId !== id) continue;
    const artifactId = textOf(evidence.routineArtifactId);
    const clientId = textOf(row.client_id);
    if (!artifactId || !clientId) continue;
    const map = await admin()
      .from("client_artifacts")
      .select("id, meta")
      .eq("id", artifactId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (map.error || !map.data) continue;
    const meta = evidenceOf(map.data);
    if (!routineAutoSendEligible(meta) && !readRoutineAutoSend(meta).on && readRoutineAutoSend(meta).clean === 0) {
      continue;
    }
    const next = withRoutineAutoSend(meta, nextRoutineAutoSend(readRoutineAutoSend(meta), "bounce"));
    await admin().from("client_artifacts").update({ meta: next }).eq("id", artifactId).eq("client_id", clientId);
  }
}
