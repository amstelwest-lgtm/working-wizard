/**
 * One notice to the firm owner when a client finishes a document link.
 * The client is never a recipient. No attachments. Nothing is logged.
 */
import { clientAgentInviteFrom } from "@/lib/client-agent-invite-mail";
import { RESEND_SEND_TIMEOUT_MS } from "@/lib/client-invite-email";

export type ClientAgentDoneEmail = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Subject, HTML, and plain text. Counts are document counts. */
export function renderClientAgentDoneEmail(input: {
  clientName: string;
  received: number;
  missing: number;
  notes: readonly string[];
  link: string;
}): ClientAgentDoneEmail {
  const clientName = clean(input.clientName) || "Your client";
  const received = Math.max(0, Math.floor(input.received));
  const missing = Math.max(0, Math.floor(input.missing));
  const notes = input.notes.map((note) => clean(note)).filter((note) => note.length > 0);
  const link = input.link.trim();
  const noteText = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "None.";
  const subject = `Documents from ${clientName}`;
  const text = [
    `${clientName} has sent their documents.`,
    "",
    `Received: ${received}`,
    `Missing: ${missing}`,
    "",
    "Notes:",
    noteText,
    "",
    "Open the client page:",
    link,
  ].join("\n");
  const noteHtml =
    notes.length > 0
      ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
      : "<p>None.</p>";
  const html = [
    `<p>${escapeHtml(clientName)} has sent their documents.</p>`,
    `<p>Received: ${received}<br>Missing: ${missing}</p>`,
    "<p>Notes:</p>",
    noteHtml,
    `<p><a href="${escapeHtml(link)}">Open the client page</a></p>`,
  ].join("");
  return { subject, html, text };
}

export type ClientAgentDoneSendResult = { ok: true } | { ok: false; reason: "not_configured" | "failed" };

/** One Resend call to the firm owner. Pass fetchImpl in tests. */
export async function sendClientAgentDone(input: {
  practiceName: string;
  to: string;
  clientName: string;
  received: number;
  missing: number;
  notes: readonly string[];
  link: string;
  idempotencyKey: string;
  apiKey?: string | null;
  fromEmail?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ClientAgentDoneSendResult> {
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const mail = renderClientAgentDoneEmail({
    clientName: input.clientName,
    received: input.received,
    missing: input.missing,
    notes: input.notes,
    link: input.link,
  });
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: clientAgentInviteFrom(input.practiceName, input.fromEmail),
        to: [input.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tags: [{ name: "kind", value: "send_agent_done" }],
      }),
      signal: AbortSignal.timeout(RESEND_SEND_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: "failed" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
