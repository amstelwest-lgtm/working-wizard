/**
 * Lead alert mail for /try and /talk.
 * One sender. Callers inject delivery so tests never hit Resend.
 * No @/ imports: the prospect edge function imports this file from Deno.
 */
export const TEAM_ALERT_TO = "amstel.west@gmail.com";
export const TEAM_ALERT_FROM = "Milōn <team@milonfinance.com>";

export type AlertKind = "demo_view" | "trial_start";

export type Mail = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mailShell(subject: string, lines: string[], idempotencyKey: string): Mail {
  const text = [subject, "", ...lines].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;color:#102A43;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px">
    <p style="margin:0;font-weight:700;letter-spacing:-0.03em">Milōn</p>
    <h1 style="margin:18px 0 0;font-size:22px;line-height:1.3">${escapeHtml(subject)}</h1>
    ${lines.map((line) => `<p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#3D5270">${escapeHtml(line)}</p>`).join("")}
  </div>
</body></html>`;
  return {
    to: TEAM_ALERT_TO,
    from: TEAM_ALERT_FROM,
    subject,
    html,
    text,
    idempotencyKey,
  };
}

export function demoViewMail(input: { country: string; when: string; visitor: string }): Mail {
  return mailShell(
    "New sample view on /try",
    [
      "A visitor opened the sample for the first time.",
      `Country: ${input.country}`,
      `When: ${input.when}`,
    ],
    `try-demo-view-${input.visitor}`,
  );
}

export function trialStartMail(input: {
  name: string;
  email: string;
  country: string;
  agent?: string;
  ref?: string;
}): Mail {
  const lines = [
    input.agent ? "A visitor started a one-agent sample." : "A visitor started the sample.",
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Country: ${input.country}`,
  ];
  if (input.agent) lines.push(`Agent: ${input.agent}`);
  if (input.ref) lines.push(`Ref: ${input.ref}`);
  return mailShell(
    input.agent ? "Trial started on /talk" : "Trial started on /try",
    lines,
    `try-trial-start-${input.email}`,
  );
}

export async function sendTeamMail(
  mail: Mail,
  deps: { apiKey: string; fetchImpl: typeof fetch },
): Promise<{ ok: true } | { ok: false; skipped?: boolean; error: string }> {
  const apiKey = deps.apiKey.trim();
  if (!apiKey) return { ok: false, skipped: true, error: "RESEND_API_KEY not configured" };
  try {
    const res = await deps.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": mail.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: mail.from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Email send failed" };
  }
}

export async function deliverLeadAlert(input: {
  kind: AlertKind;
  dedupeKey: string;
  mail: Mail;
  claim: (kind: AlertKind, dedupeKey: string) => Promise<boolean>;
  send: (mail: Mail) => Promise<{ ok: boolean }>;
}): Promise<{ deduped: boolean; sent: boolean }> {
  const fresh = await input.claim(input.kind, input.dedupeKey);
  if (!fresh) return { deduped: true, sent: false };
  const sent = await input.send(input.mail);
  return { deduped: false, sent: sent.ok };
}
