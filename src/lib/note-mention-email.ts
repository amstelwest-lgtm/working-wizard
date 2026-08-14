/**
 * Send note-mention emails via Resend when configured.
 * Prefer direct Resend (no queue dependency). Falls back to enqueue RPC when
 * Resend key is missing but service-role + queue exist.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import type { NoteMention } from "@/lib/notes.functions";

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
