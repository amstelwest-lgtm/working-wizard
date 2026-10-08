/**
 * Dual-approval emails for practice access + firm staff invites.
 */

import { inviteSiteUrl, RESEND_SEND_TIMEOUT_MS } from "@/lib/client-invite-email";
import { CLASSIFICATION_LABELS, type PracticeClassification } from "@/lib/practice-access";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function accessApproveUrl(token: string): string {
  return `${inviteSiteUrl()}/access/${token}`;
}

/** Safe to show and log. Strips tokens and API keys from a Resend body. */
export function publicEmailError(status: number | null, raw: string): string {
  let detail = raw.replace(/\s+/g, " ").trim();
  if (detail.startsWith("{") || detail.startsWith("[")) {
    try {
      const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim()) detail = parsed.message.trim();
      else if (typeof parsed.error === "string" && parsed.error.trim()) detail = parsed.error.trim();
    } catch {
      /* keep the text */
    }
  }
  detail = detail
    .replace(/re_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 180);
  if (status) {
    const prefix = `Resend ${status}`;
    if (!detail || detail === prefix || detail.startsWith(`${prefix}:`)) return detail || prefix;
    return `${prefix}: ${detail}`;
  }
  return detail || "Email send failed";
}

export async function sendAccessEmail(opts: {
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
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  try {
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
      signal: AbortSignal.timeout(RESEND_SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = publicEmailError(res.status, body);
      console.error("sendAccessEmail failed", { status: res.status, message: error });
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const error =
      name === "TimeoutError" || name === "AbortError"
        ? "Email send timed out"
        : publicEmailError(null, err instanceof Error ? err.message : String(err));
    console.error("sendAccessEmail failed", { status: null, message: error });
    return { ok: false, error };
  }
}

export function accessRequestEmail(opts: {
  recipientName: string;
  actorName: string;
  memberName: string;
  memberEmail: string;
  clientName: string;
  firmName: string;
  classification: PracticeClassification;
  approveUrl: string;
  side: "accountant" | "owner";
}): { subject: string; html: string; text: string } {
  const role = CLASSIFICATION_LABELS[opts.classification];
  const who =
    opts.side === "owner"
      ? `Your accountant wants ${opts.memberName} (${opts.memberEmail}) to work on ${opts.clientName} as ${role}.`
      : `${opts.actorName} asked you to approve ${opts.memberName} (${opts.memberEmail}) on ${opts.clientName} as ${role}.`;
  const subject =
    opts.side === "owner"
      ? `Approve accountant access · ${opts.clientName}`
      : `Approve team access · ${opts.clientName}`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
  <p>Hi ${escapeHtml(opts.recipientName || "there")},</p>
  <p>${escapeHtml(who)}</p>
  <p>Both a practice approver and the business owner must confirm before this person can open the books. Cap: 12 practice users per client.</p>
  <p><a href="${escapeHtml(opts.approveUrl)}" style="color:#b8860b">Approve or decline this access</a></p>
  <p style="color:#94a3b8;font-size:12px">${escapeHtml(opts.firmName)} · Milōn</p>
  </body></html>`;
  const text = `${who}\n\nApprove or decline: ${opts.approveUrl}\n`;
  return { subject, html, text };
}

export function accessGrantedEmail(opts: {
  recipientName: string;
  actorName: string;
  memberName: string;
  memberEmail: string;
  clientName: string;
  firmName: string;
  classification: PracticeClassification;
}): { subject: string; html: string; text: string } {
  const role = CLASSIFICATION_LABELS[opts.classification];
  const subject = `${opts.memberName} now has access to ${opts.clientName}`;
  const who = `${opts.firmName} assigned ${opts.memberName} (${opts.memberEmail}) to ${opts.clientName} as ${role}.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
  <p>Hi ${escapeHtml(opts.recipientName || "there")},</p>
  <p>${escapeHtml(who)}</p>
  <p>You already approved this practice. This is a notice, not a request. You can revoke this person — or disconnect the firm — from Settings.</p>
  <p style="color:#94a3b8;font-size:12px">${escapeHtml(opts.actorName)} · ${escapeHtml(opts.firmName)} · Milōn</p>
  </body></html>`;
  const text = `${who}\n\nThis is a notice, not a request. Revoke access from Settings if needed.\n`;
  return { subject, html, text };
}

export function firmInviteEmail(opts: {
  recipientName: string;
  firmName: string;
  inviterName: string;
  roleLabel: string;
  url: string;
}): { subject: string; html: string; text: string } {
  const subject = `Join ${opts.firmName} on Milōn`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
  <p>Hi ${escapeHtml(opts.recipientName || "there")},</p>
  <p><strong>${escapeHtml(opts.inviterName)}</strong> invited you to the ${escapeHtml(opts.firmName)} practice as ${escapeHtml(opts.roleLabel)}.</p>
  <p>You will see the client files a firm admin assigns to you. The business owner already approved this practice.</p>
  <p><a href="${escapeHtml(opts.url)}" style="color:#b8860b">Accept this invitation</a></p>
  </body></html>`;
  const text = `${opts.inviterName} invited you to ${opts.firmName} as ${opts.roleLabel}.\n\nAccept: ${opts.url}\n`;
  return { subject, html, text };
}
