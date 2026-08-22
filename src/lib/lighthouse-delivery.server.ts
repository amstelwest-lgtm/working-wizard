/**
 * Apply Resend delivery events to Lighthouse leads.
 * Shared by the webhook so bounce, engagement and inbound stay consistent.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { missingRelation, type LooseAdmin } from "@/lib/owner-ops.guard";

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

export function extractEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const value = (angled?.[1] ?? raw).trim().toLowerCase();
  return value.includes("@") ? value : null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const STAGE_RANK: Record<string, number> = {
  sourced: 0,
  researched: 1,
  contacted: 2,
  nurture: 2,
  replied: 3,
  meeting: 4,
  trial: 5,
  activated: 6,
  won: 7,
  lost: -1,
};

function canAdvance(current: string, target: string): boolean {
  const from = STAGE_RANK[current] ?? 0;
  const to = STAGE_RANK[target] ?? 0;
  return from >= 0 && to > from;
}

async function findLeads(
  client: LooseAdmin,
  opts: { email?: string | null; messageId?: string | null },
): Promise<{ leadIds: string[]; touchId: string | null }> {
  const leadIds: string[] = [];
  let touchId: string | null = null;
  const messageId = (opts.messageId ?? "").trim();
  const email = (opts.email ?? "").trim().toLowerCase();

  if (messageId) {
    const { data: touch } = await client
      .from("lighthouse_touches")
      .select("id, lead_id")
      .eq("provider_message_id", messageId)
      .maybeSingle();
    const row = touch as { id?: string; lead_id?: string } | null;
    if (row?.id) touchId = row.id;
    if (row?.lead_id) leadIds.push(row.lead_id);
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
  }

  return { leadIds, touchId };
}

async function pauseSequence(client: LooseAdmin, leadIds: string[], skipDrafts: boolean) {
  for (const leadId of leadIds) {
    await client.from("milon_ops_leads").update({ next_touch_on: null }).eq("id", leadId);
    if (skipDrafts) {
      await client
        .from("lighthouse_touches")
        .update({
          status: "skipped",
          error: "Sequence paused — they already engaged.",
        })
        .eq("lead_id", leadId)
        .in("status", ["draft", "approved"]);
    }
  }
}

async function advanceLeads(client: LooseAdmin, leadIds: string[], target: string, extra: Record<string, unknown> = {}) {
  for (const leadId of leadIds) {
    const { data: row } = await client
      .from("milon_ops_leads")
      .select("id, stage, do_not_contact")
      .eq("id", leadId)
      .maybeSingle();
    const lead = row as { stage?: string; do_not_contact?: boolean } | null;
    if (!lead || lead.do_not_contact) continue;
    if (!canAdvance(String(lead.stage ?? "sourced"), target)) continue;
    await client
      .from("milon_ops_leads")
      .update({
        stage: target,
        next_touch_on: null,
        ...extra,
      })
      .eq("id", leadId);
  }
}

async function bookingUrl(client: LooseAdmin): Promise<string> {
  const { data } = await client.from("milon_ops_settings").select("value").eq("key", "lighthouse").maybeSingle();
  const raw = (data as { value?: Record<string, unknown> } | null)?.value ?? {};
  return String(raw.booking_url ?? "").trim();
}

function classifyClick(url: string, booking: string): "trial" | "booking" | "unsubscribe" | "other" {
  const lower = url.toLowerCase();
  if (
    lower.includes("/unsubscribe") ||
    lower.includes("/lh/unsubscribe") ||
    lower.includes("list-unsubscribe")
  ) {
    return "unsubscribe";
  }
  if (lower.includes("lh=") || lower.includes("/?lh=") || lower.includes("#register")) {
    return "trial";
  }
  if (booking) {
    try {
      const a = new URL(booking);
      const b = new URL(url);
      if (a.host === b.host && b.pathname.startsWith(a.pathname.replace(/\/$/, ""))) {
        return "booking";
      }
    } catch {
      if (lower.includes(booking.toLowerCase())) return "booking";
    }
  }
  return "other";
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

  const { leadIds, touchId } = await findLeads(client, { email, messageId });

  if (touchId) {
    await client
      .from("lighthouse_touches")
      .update({
        status: "failed",
        error: `Resend ${reasonLabel}`,
      })
      .eq("id", touchId);
  }

  if (email) {
    await client.from("suppressed_emails").upsert(
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

/** Resend accepted the mail at the recipient's server. */
export async function applyLighthouseDelivered(opts: {
  email?: string | null;
  messageId?: string | null;
}): Promise<{ ok: boolean; leadsTouched: number }> {
  const client = admin();
  if (!client) return { ok: false, leadsTouched: 0 };

  const { leadIds, touchId } = await findLeads(client, opts);
  const now = new Date().toISOString();
  if (touchId) {
    const { error } = await client
      .from("lighthouse_touches")
      .update({ delivered_at: now })
      .eq("id", touchId)
      .is("delivered_at", null);
    if (error && missingRelation(error.message ?? "")) {
      console.error("lighthouse.delivered_schema", error.message);
    }
  }

  console.log("lighthouse.delivered", {
    email_redacted: opts.email ? redact(opts.email) : null,
    message_id: opts.messageId ?? null,
    leads: leadIds.length,
  });
  return { ok: true, leadsTouched: leadIds.length };
}

/** They clicked a link in a Lighthouse email. */
export async function applyLighthouseClicked(opts: {
  email?: string | null;
  messageId?: string | null;
  url?: string | null;
}): Promise<{ ok: boolean; leadsTouched: number; kind: string }> {
  const client = admin();
  if (!client) return { ok: false, leadsTouched: 0, kind: "other" };

  const url = (opts.url ?? "").trim();
  const { leadIds, touchId } = await findLeads(client, opts);
  const now = new Date().toISOString();
  const booking = await bookingUrl(client);
  const kind = url ? classifyClick(url, booking) : "other";

  if (kind === "unsubscribe") {
    return { ok: true, leadsTouched: 0, kind };
  }

  if (touchId) {
    await client
      .from("lighthouse_touches")
      .update({
        clicked_at: now,
        last_clicked_url: url || null,
      })
      .eq("id", touchId);
  }

  for (const leadId of leadIds) {
    await client
      .from("milon_ops_leads")
      .update({
        last_clicked_at: now,
        last_clicked_url: url || null,
      })
      .eq("id", leadId);
  }

  if (kind === "trial") {
    await advanceLeads(client, leadIds, "trial", { trial_clicked_at: now });
    await pauseSequence(client, leadIds, true);
  } else if (kind === "booking") {
    await advanceLeads(client, leadIds, "meeting");
    await pauseSequence(client, leadIds, true);
  } else {
    // Genuine click — hold the next cold step; don't skip drafts they may still want.
    await pauseSequence(client, leadIds, false);
  }

  console.log("lighthouse.clicked", {
    kind,
    email_redacted: opts.email ? redact(opts.email ?? "") : null,
    message_id: opts.messageId ?? null,
    leads: leadIds.length,
  });
  return { ok: true, leadsTouched: leadIds.length, kind };
}

async function fetchReceivedBody(emailId: string): Promise<{ subject: string | null; text: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !emailId) return { subject: null, text: null };
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { subject: null, text: null };
    const body = (await res.json()) as { subject?: string; text?: string | null; html?: string | null };
    const text = (body.text ?? "").trim() || (body.html ? htmlToText(body.html) : "");
    return { subject: body.subject ?? null, text: text.slice(0, 8000) || null };
  } catch {
    return { subject: null, text: null };
  }
}

/** Someone replied into the Resend inbound mailbox. */
export async function applyLighthouseInbound(opts: {
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  emailId?: string | null;
}): Promise<{ ok: boolean; leadsTouched: number }> {
  const client = admin();
  if (!client) return { ok: false, leadsTouched: 0 };

  const from = extractEmail(opts.from);
  if (!from) return { ok: true, leadsTouched: 0 };
  if (from.endsWith("@milon.co.za") || from.endsWith("@resend.dev")) {
    return { ok: true, leadsTouched: 0 };
  }

  const { leadIds } = await findLeads(client, { email: from });
  if (leadIds.length === 0) {
    console.log("lighthouse.inbound_unmatched", { from_redacted: redact(from) });
    return { ok: true, leadsTouched: 0 };
  }

  const fetched = opts.emailId ? await fetchReceivedBody(opts.emailId) : { subject: null, text: null };
  const subject = (fetched.subject ?? opts.subject ?? "").trim() || null;
  const text = fetched.text;
  const now = new Date().toISOString();

  for (const leadId of leadIds) {
    const { data: existing } = await client
      .from("lighthouse_inbound")
      .select("id")
      .eq("provider_email_id", opts.emailId ?? "")
      .maybeSingle();
    if (!existing && opts.emailId) {
      const { error } = await client.from("lighthouse_inbound").insert({
        lead_id: leadId,
        provider_email_id: opts.emailId,
        from_email: from,
        subject,
        body: text,
        received_at: now,
      });
      if (error && !missingRelation(error.message ?? "")) {
        console.error("lighthouse.inbound_insert", error.message);
      }
    } else if (!opts.emailId) {
      await client.from("lighthouse_inbound").insert({
        lead_id: leadId,
        from_email: from,
        subject,
        body: text,
        received_at: now,
      });
    }

    await client.from("milon_ops_leads").update({ last_inbound_at: now }).eq("id", leadId);
  }

  await advanceLeads(client, leadIds, "replied", { replied_at: now });
  await pauseSequence(client, leadIds, true);

  console.log("lighthouse.inbound", {
    from_redacted: redact(from),
    email_id: opts.emailId ?? null,
    leads: leadIds.length,
  });
  return { ok: true, leadsTouched: leadIds.length };
}
