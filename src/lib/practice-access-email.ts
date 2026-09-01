/**
 * Dual-approval emails for practice access + firm staff invites.
 */

import { inviteSiteUrl } from "@/lib/client-invite-email";
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
  <p>You will only see clients you are assigned to, after both the practice and the business owner approve each file.</p>
  <p><a href="${escapeHtml(opts.url)}" style="color:#b8860b">Accept this invitation</a></p>
  </body></html>`;
  const text = `${opts.inviterName} invited you to ${opts.firmName} as ${opts.roleLabel}.\n\nAccept: ${opts.url}\n`;
  return { subject, html, text };
}
