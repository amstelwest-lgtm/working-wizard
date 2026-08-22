/**
 * Apply a bounce / complaint / unsubscribe event to Lighthouse leads.
 * Shared by the Resend webhook so opt-out and suppression stay consistent.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import type { LooseAdmin } from "@/lib/owner-ops.guard";

export type DeliveryEventReason = "bounce" | "complaint" | "unsubscribe" | "failed";

function admin(): LooseAdmin | null {
  const client = getSupabaseAdminOrNull();
  return client ? (client as unknown as LooseAdmin) : null;
}

function redact(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

/**
 * Stop every Lighthouse sequence for this address and suppress platform-wide.
 * Idempotent — safe for webhook retries.
 */
export async function applyLighthouseDeliveryEvent(opts: {
  email?: string | null;
  messageId?: string | null;
  reason: DeliveryEventReason;
}): Promise<{ ok: boolean; leadsTouched: number }> {
  const client = admin();
  if (!client) return { ok: false, leadsTouched: 0 };

  const email = (opts.email ?? "").trim().toLowerCase();
  const messageId = (opts.messageId ?? "").trim();
  const now = new Date().toISOString();
  const reasonLabel =
    opts.reason === "bounce"
      ? "hard bounce"
      : opts.reason === "complaint"
        ? "spam complaint"
        : opts.reason === "failed"
          ? "delivery failed"
          : "unsubscribed";

  let leadIds: string[] = [];

  if (messageId) {
    const { data: touch } = await client
      .from("lighthouse_touches")
      .select("id, lead_id")
      .eq("provider_message_id", messageId)
      .maybeSingle();
    const row = touch as { id?: string; lead_id?: string } | null;
    if (row?.lead_id) leadIds = [row.lead_id];
    if (row?.id) {
      await client
        .from("lighthouse_touches")
        .update({
          status: opts.reason === "complaint" ? "failed" : "failed",
          error: `Resend ${reasonLabel}`,
        })
        .eq("id", row.id);
    }
  }

  if (email) {
    const { data: leads } = await client
      .from("milon_ops_leads")
      .select("id")
      .ilike("email", email)
      .limit(50);
    for (const l of (leads ?? []) as Array<{ id: string }>) {
      if (!leadIds.includes(l.id)) leadIds.push(l.id);
    }

    await client
      .from("suppressed_emails")
      .upsert(
        { email, reason: opts.reason === "failed" ? "bounce" : opts.reason },
        { onConflict: "email" },
      );
  }

  for (const leadId of leadIds) {
    await client
      .from("milon_ops_leads")
      .update({
        do_not_contact: true,
        optout_at: now,
        optout_source: opts.reason,
        next_touch_on: null,
        lost_reason: reasonLabel,
        stage: "lost",
      })
      .eq("id", leadId);

    await client
      .from("lighthouse_touches")
      .update({
        status: "skipped",
        error: `Sequence stopped — ${reasonLabel}.`,
      })
      .eq("lead_id", leadId)
      .in("status", ["draft", "approved"]);
  }

  console.log("lighthouse.delivery_event", {
    reason: opts.reason,
    email_redacted: email ? redact(email) : null,
    message_id: messageId || null,
    leads: leadIds.length,
  });

  return { ok: true, leadsTouched: leadIds.length };
}
