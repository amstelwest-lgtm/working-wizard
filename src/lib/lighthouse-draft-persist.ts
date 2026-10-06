/**
 * Shared pending-draft write for the review inbox.
 *
 * Chat and the existing draft composer both land here. Status is hardcoded
 * to "draft". This module does not approve, schedule, or send.
 */

import { assertChatMutationAllowed } from "@/lib/lighthouse-agent-chat";
import { assertColdDraftOpen } from "@/lib/lighthouse-agent";

export type PendingDraftWrite = {
  leadId: string;
  stepNo: number;
  angle: string;
  subject: string;
  body: string;
  createdBy: string;
  /** Chat passes "draft". Anything else is refused before a write. */
  action?: string;
};

export type PendingDraftRow = {
  lead_id: string;
  step_no: number;
  angle: string;
  subject: string;
  body: string;
  status: "draft";
  scheduled_for: string;
  created_by: string;
  error: null;
};

export function pendingDraftPayload(write: PendingDraftWrite, now = new Date()): PendingDraftRow {
  assertChatMutationAllowed(write.action ?? "draft");
  const step = Math.min(8, Math.max(1, Math.trunc(write.stepNo) || 1));
  return {
    lead_id: write.leadId,
    step_no: step,
    angle: write.angle || "observation",
    subject: write.subject.trim(),
    body: write.body.trim(),
    status: "draft",
    scheduled_for: now.toISOString().slice(0, 10),
    created_by: write.createdBy,
    error: null,
  };
}

type TouchAdmin = {
  from: (table: string) => any;
};

/**
 * Insert or update a lighthouse_touches row as pending review.
 * Chat sets `refuseLocked` so an approved or sent step is not rewritten.
 * The composer leaves it off and can still replace a step with a new draft.
 */
async function heldLeadForDraft(
  admin: TouchAdmin,
  leadId: string,
): Promise<void> {
  const { data, error } = await admin
    .from("milon_ops_leads")
    .select("company, name, email, conversation_held")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message ?? "Could not read the lead.");
  const lead = data as {
    company?: string | null;
    name?: string | null;
    email?: string | null;
    conversation_held?: boolean | null;
  } | null;
  if (!lead) return;
  assertColdDraftOpen({
    conversationHeld: Boolean(lead.conversation_held),
    company: lead.company ?? null,
    name: lead.name ?? null,
    email: lead.email ?? null,
  });
}

export async function persistPendingLighthouseDraft(
  admin: TouchAdmin,
  write: PendingDraftWrite,
  now = new Date(),
  opts?: { refuseLocked?: boolean },
): Promise<{ touchId: string; status: "draft" }> {
  const row = pendingDraftPayload(write, now);
  if (row.status !== "draft") {
    throw new Error("Lighthouse chat cannot send, approve, or schedule.");
  }

  await heldLeadForDraft(admin, write.leadId);

  const { data: existing, error: readErr } = await admin
    .from("lighthouse_touches")
    .select("id, status, sent_at")
    .eq("lead_id", write.leadId)
    .eq("step_no", row.step_no)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message ?? "Could not read the draft.");

  const prior = existing as { id?: string; status?: string; sent_at?: string | null } | null;
  if (
    opts?.refuseLocked &&
    (prior?.sent_at || prior?.status === "sent" || prior?.status === "approved")
  ) {
    throw new Error("That step is already approved or sent. Chat will not change it.");
  }

  if (prior?.id) {
    const { error } = await admin
      .from("lighthouse_touches")
      .update({
        subject: row.subject,
        body: row.body,
        angle: row.angle,
        status: "draft",
        error: null,
      })
      .eq("id", prior.id);
    if (error) throw new Error(error.message ?? "Could not update the draft.");
    return { touchId: String(prior.id), status: "draft" };
  }

  const { data: inserted, error } = await admin
    .from("lighthouse_touches")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message ?? "Could not save the draft.");
  const touchId = String((inserted as { id?: string } | null)?.id ?? "");
  if (!touchId) throw new Error("Draft save did not return an id.");
  return { touchId, status: "draft" };
}
