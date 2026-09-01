/**
 * Send note-mention emails via Resend when configured.
 * Prefer direct Resend (no queue dependency). Falls back to enqueue RPC when
 * Resend key is missing but service-role + queue exist.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import type { NoteMention } from "@/lib/notes.functions";
import { clientNoteProfileUrl, lighthouseItInboxUrl } from "@/lib/client-note-link";
import { inviteSiteUrl } from "@/lib/client-invite-email";
import { ownerEmailAllowlist } from "@/lib/owner-ops.guard";

export type MentionMailContext = {
  authorName: string;
  clientName: string;
  noteText: string;
  tabLabel: string;
  noteId: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(ctx: MentionMailContext, recipientName: string): string {
  const preview = escapeHtml(ctx.noteText.slice(0, 500));
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
  <p>Hi ${escapeHtml(recipientName || "there")},</p>
  <p><strong>${escapeHtml(ctx.authorName)}</strong> mentioned you on a note
  for <strong>${escapeHtml(ctx.clientName)}</strong>${
    ctx.tabLabel ? ` (${escapeHtml(ctx.tabLabel)})` : ""
  }.</p>
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;background:#f8fafc;margin:16px 0;white-space:pre-wrap">${preview}</div>
  <p style="color:#64748b;font-size:13px">Log in to Milōn to view the note. Only people tagged with @ are emailed.</p>
  <p style="color:#94a3b8;font-size:12px">— The Milōn team</p>
  </body></html>`;
}

async function sendViaResend(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromRaw = process.env.RESEND_FROM_EMAIL || "noreply@milon.co.za";
  const fromAddr = fromRaw.includes("<")
    ? fromRaw.replace(/^.*<([^>]+)>.*$/, "$1").trim()
    : fromRaw.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": opts.idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({
      from: `Milōn <${fromAddr}>`,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Notify each unique mention. Returns per-recipient outcomes for honest UI toasts.
 */
export async function dispatchNoteMentionEmails(
  mentions: NoteMention[],
  ctx: MentionMailContext,
): Promise<{ sent: string[]; failed: Array<{ email: string; error: string }> }> {
  const unique = new Map(
    mentions
      .filter((m) => m.email && m.email.includes("@"))
      .map((m) => [m.email.toLowerCase(), m]),
  );

  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];

  for (const m of unique.values()) {
    const subject = `${ctx.authorName} mentioned you on ${ctx.clientName}`;
    const html = buildHtml(ctx, m.name);
    const text = `${ctx.authorName} mentioned you on ${ctx.clientName}:\n\n${ctx.noteText}`;
    const idempotencyKey = `note-mention-${ctx.noteId}-${m.userId || m.email}`;

    const direct = await sendViaResend({
      to: m.email,
      subject,
      html,
      text,
      idempotencyKey,
    });

    if (direct.ok) {
      sent.push(m.email);
      continue;
    }

    // Fallback: enqueue via service-role if Resend key missing but queue works.
    const admin = getSupabaseAdminOrNull();
    if (!admin) {
      failed.push({ email: m.email, error: direct.error });
      continue;
    }

    try {
      const messageId = crypto.randomUUID();
      const { error } = await (admin as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>;
      }).rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          message_id: messageId,
          to: m.email,
          from: `Milōn <noreply@milon.co.za>`,
          sender_domain: "notify.milon.co.za",
          subject,
          html,
          text,
          purpose: "transactional",
          label: "note-mention",
          idempotency_key: idempotencyKey,
          queued_at: new Date().toISOString(),
        },
      });
      if (error) {
        failed.push({
          email: m.email,
          error: `${direct.error}; enqueue: ${error.message}`,
        });
      } else {
        sent.push(m.email);
      }
    } catch (e) {
      failed.push({
        email: m.email,
        error: e instanceof Error ? e.message : direct.error,
      });
    }
  }

  return { sent, failed };
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type ItQueryMailContext = {
  authorName: string;
  clientName: string;
  clientId: string;
  noteText: string;
  tabLabel: string;
  noteId: string;
};

function buildItHtml(ctx: ItQueryMailContext, profileUrl: string, inboxUrl: string): string {
  const preview = escapeHtml(ctx.noteText.slice(0, 500));
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
  <p>A note on <strong>${escapeHtml(ctx.clientName)}</strong> was tagged for Milōn IT${
    ctx.tabLabel ? ` (${escapeHtml(ctx.tabLabel)})` : ""
  }.</p>
  <p><strong>${escapeHtml(ctx.authorName)}</strong> wrote:</p>
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;background:#f8fafc;margin:16px 0;white-space:pre-wrap">${preview}</div>
  <p><a href="${escapeHtml(inboxUrl)}" style="color:#b8860b">Open in your Lighthouse IT queries inbox</a></p>
  <p><a href="${escapeHtml(profileUrl)}" style="color:#b8860b">Open this note on the customer profile</a></p>
  <p style="color:#94a3b8;font-size:12px">Every Milōn IT team member receives this note in the same Lighthouse inbox.</p>
  </body></html>`;
}

async function loadItNotifyEmails(): Promise<string[]> {
  const admin = getSupabaseAdminOrNull() as unknown as {
    from: (t: string) => {
      select: (c: string) => Promise<{ data: Array<{ email: string }> | null }>;
    };
  } | null;
  const fromList: string[] = [];
  if (admin) {
    try {
      const { data } = await admin.from("milon_it_members").select("email");
      for (const row of data ?? []) {
        const email = (row.email ?? "").trim().toLowerCase();
        if (email.includes("@")) fromList.push(email);
      }
    } catch {
      /* table may not exist yet */
    }
  }
  if (fromList.length === 0) return ownerEmailAllowlist();
  return [...new Set(fromList)];
}

/**
 * Notify the Milōn IT team (or platform owner if the team list is empty).
 */
export async function dispatchMilonItQueryEmails(
  ctx: ItQueryMailContext,
): Promise<{ sent: string[]; failed: Array<{ email: string; error: string }> }> {
  const recipients = await loadItNotifyEmails();
  const origin = inviteSiteUrl();
  const profileUrl = clientNoteProfileUrl(origin, ctx.clientId, ctx.noteId, ctx.tabLabel);
  const inboxUrl = lighthouseItInboxUrl(origin);
  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];

  for (const email of recipients) {
    const subject = `Milōn IT query · ${ctx.clientName}`;
    const html = buildItHtml(ctx, profileUrl, inboxUrl);
    const text = `${ctx.authorName} tagged a note for Milōn IT on ${ctx.clientName}:\n\n${ctx.noteText}\n\nInbox: ${inboxUrl}\nOpen note: ${profileUrl}`;
    const idempotencyKey = `note-it-${ctx.noteId}-${email}`;
    const direct = await sendViaResend({
      to: email,
      subject,
      html,
      text,
      idempotencyKey,
    });
    if (direct.ok) {
      sent.push(email);
      continue;
    }
    failed.push({ email, error: direct.error });
  }

  return { sent, failed };
}
