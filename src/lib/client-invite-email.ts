/**
 * Owner-handoff invite email: Claude-drafted when possible, template fallback,
 * sent via Resend. Always returns a paste-ready message for Outlook/Gmail.
 */

import { callClaudeMessages, parseClaudeJson } from "@/lib/claude-messages";

export type InviteDraftInput = {
  clientName: string;
  clientCode: string | null;
  inviteUrl: string;
  firmName: string;
  accountantName: string;
  accountantEmail: string | null;
};

export type InviteDraft = {
  subject: string;
  body: string;
  draftedBy: "claude" | "template";
};

export function inviteSiteUrl(): string {
  return (process.env.SITE_URL || process.env.VITE_APP_URL || "https://milon.co.za").replace(
    /\/$/,
    "",
  );
}

export function invitePasteText(subject: string, body: string): string {
  return `Subject: ${subject}\n\n${body}`.trim();
}

function signOff(input: InviteDraftInput): string {
  const name = input.accountantName.trim() || "Your accountant";
  const firm = input.firmName.trim();
  return firm ? `${name}\n${firm}` : name;
}

export function templateInviteDraft(input: InviteDraftInput): InviteDraft {
  const codeLine = input.clientCode ? `\nYour client code: ${input.clientCode}\n` : "\n";
  const from = input.accountantName.trim() || "your accountant";
  const firm = input.firmName.trim();
  const fromBit = firm ? `${from} at ${firm}` : from;
  const subject = `${input.clientName} — your MILŌN workspace is ready`;
  const body = `Hi,

${fromBit} has set up a MILŌN workspace for ${input.clientName} — one score for the health of the business, a 13-week cash view, and a short list of what to do next. You and your accountant see the same numbers.
${codeLine}
Claim your workspace here (the link is yours and expires in 14 days):

${input.inviteUrl}

It takes a couple of minutes to create your login. If you were not expecting this, you can ignore it.

${signOff(input)}`;
  return { subject, body, draftedBy: "template" };
}

export async function draftOwnerInviteEmail(input: InviteDraftInput): Promise<InviteDraft> {
  const fallback = templateInviteDraft(input);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const prompt = `You write a short email from a South African accountant to their SME client, inviting them to claim a MILŌN workspace.

Rules:
- Warm, calm, professional. No hype, no emojis, no "excited to partner", no sales pitch.
- Plain text only. South African English (organisation, not organization) is fine but keep it simple.
- Body under 140 words.
- MUST include this exact URL on its own line, unchanged: ${input.inviteUrl}
- ${input.clientCode ? `MUST mention the client code ${input.clientCode} once.` : "No client code."}
- Sign off as ${input.accountantName || "the accountant"}${input.firmName ? `, ${input.firmName}` : ""}.
- Do not invent extra links, prices, or product claims.

Context:
- Business: ${input.clientName}
- Firm: ${input.firmName || "the practice"}
- Accountant: ${input.accountantName || "the accountant"}

Return ONLY JSON: {"subject":"...","body":"..."}
The body must already be signed off and ready to paste into email.`;

  try {
    const raw = await callClaudeMessages({
      content: [{ type: "text", text: prompt }],
      maxTokens: 700,
      timeoutMs: 18_000,
    });
    const parsed = parseClaudeJson<{ subject?: string; body?: string }>(raw);
    const subject = String(parsed.subject ?? "").trim();
    const body = String(parsed.body ?? "").trim();
    if (!subject || !body) return fallback;
    if (!body.includes(input.inviteUrl)) {
      return {
        subject,
        body: `${body}\n\n${input.inviteUrl}`,
        draftedBy: "claude",
      };
    }
    return { subject, body, draftedBy: "claude" };
  } catch {
    return fallback;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function inviteEmailHtml(body: string): string {
  const linked = escapeHtml(body).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#ac8400;word-break:break-all">$1</a>',
  );
  return `<!doctype html><html><body style="font-family:Georgia,serif;color:#1b1608;line-height:1.55;max-width:560px">
  <p style="font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#ac8400;margin:0 0 18px">MILŌN</p>
  <div style="white-space:pre-wrap;font-size:15px">${linked}</div>
  </body></html>`;
}

export async function sendInviteViaResend(opts: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string | null;
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
      from: `MILŌN <${fromAddr}>`,
      to: [opts.to],
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      subject: opts.subject,
      html: inviteEmailHtml(opts.body),
      text: opts.body,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}
