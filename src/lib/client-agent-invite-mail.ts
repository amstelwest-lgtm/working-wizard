/**
 * Sends the document-list invite. Called only from an explicit mint.
 * Does not log the recipient, the given name, the link, or the body.
 */
import { inviteFromAddress, RESEND_SEND_TIMEOUT_MS } from "@/lib/client-invite-email";
import { renderClientAgentInviteEmail } from "@/lib/client-agent-invite-email";

export function clientAgentInviteFrom(practiceName: string, fromRaw?: string | null): string {
  const address = inviteFromAddress(fromRaw);
  const name = practiceName.replace(/[\r\n<>"]/g, "").trim() || "Your accountant";
  return `${name} <${address}>`;
}

export type ClientAgentInviteSendResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "failed" };

/** One Resend call. Pass fetchImpl in tests. No network when the key is missing. */
export async function sendClientAgentInvite(input: {
  practiceName: string;
  to: string;
  firstName?: string | null;
  link: string;
  expiresAt: string;
  idempotencyKey: string;
  apiKey?: string | null;
  fromEmail?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ClientAgentInviteSendResult> {
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const mail = renderClientAgentInviteEmail({
    practiceName: input.practiceName,
    link: input.link,
    expiresAt: input.expiresAt,
    firstName: input.firstName,
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
      }),
      signal: AbortSignal.timeout(RESEND_SEND_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: "failed" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
