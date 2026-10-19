/**
 * Lead alerts and call booking for /try.
 * Mail is built here. Sending is injected so tests never hit Resend.
 */
import { readGoogleCalendarConfig, type GoogleCalendarConfig } from "@/lib/google-calendar";
import { formatSlotClock24, isOfferedSlot, safeTimeZone } from "@/lib/trial-call-slots";

export const TEAM_ALERT_TO = "amstel.west@gmail.com";
export const TEAM_ALERT_FROM = "Milōn <team@milonfinance.com>";
export const TRIAL_CALLS_PER_IP_PER_DAY = 3;

export type AlertKind = "demo_view" | "trial_start";

export type Mail = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type CallDraft = {
  name: string;
  email: string;
  country: "US" | "ZA";
  start: Date;
  end: Date;
  timeZone: string;
  ipHash: string;
};

export function callRateAllowed(countToday: number): boolean {
  return countToday < TRIAL_CALLS_PER_IP_PER_DAY;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mailShell(subject: string, lines: string[], idempotencyKey: string): Mail {
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

export function trialStartMail(input: { name: string; email: string; country: string }): Mail {
  return mailShell(
    "Trial started on /try",
    [
      "A visitor started the sample.",
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      `Country: ${input.country}`,
    ],
    `try-trial-start-${input.email}`,
  );
}

export function callSavedMail(draft: CallDraft): Mail {
  const zone = safeTimeZone(draft.timeZone);
  return mailShell(
    "Call request from the sample",
    [
      "Calendar booking is not configured, so this request was saved.",
      `Name: ${draft.name}`,
      `Email: ${draft.email}`,
      `Country: ${draft.country}`,
      `Visitor time (${zone}): ${formatSlotClock24(draft.start, zone)}`,
      `SAST: ${formatSlotClock24(draft.start, "Africa/Johannesburg")}`,
      `Start: ${draft.start.toISOString()}`,
    ],
    `try-call-${draft.email}-${draft.start.toISOString()}`,
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

export function validateCallRequest(input: {
  name: string;
  email: string;
  consent: boolean;
  honeypot?: string;
  start: string;
  timeZone?: string;
  now: Date;
}):
  | { ok: true; name: string; email: string; start: Date; end: Date; timeZone: string }
  | { ok: false; silent: true }
  | { ok: false; error: string } {
  if ((input.honeypot ?? "").length > 0) return { ok: false, silent: true };
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) return { ok: false, error: "Add your name." };
  const email = input.email.trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Add a valid email." };
  }
  if (input.consent !== true) return { ok: false, error: "Tick the box to continue." };
  const slot = isOfferedSlot(input.start, input.now);
  if (!slot) return { ok: false, error: "Pick a time from the list." };
  return {
    ok: true,
    name,
    email,
    start: slot.start,
    end: slot.end,
    timeZone: safeTimeZone(input.timeZone),
  };
}

export async function arrangeTrialCall(input: {
  env: Record<string, string | undefined>;
  draft: CallDraft;
  save: (row: {
    draft: CallDraft;
    status: "saved" | "booked";
    meetUrl: string | null;
    calendarEventId: string | null;
  }) => Promise<boolean>;
  book: (
    config: GoogleCalendarConfig,
    draft: CallDraft,
  ) => Promise<{ ok: true; eventId: string; meetUrl: string } | { ok: false }>;
  send: (mail: Mail) => Promise<{ ok: boolean }>;
}): Promise<
  | { ok: true; status: "booked"; meetUrl: string }
  | { ok: true; status: "saved" }
  | { ok: false; error: string }
> {
  const config = readGoogleCalendarConfig(input.env);
  let booked: { eventId: string; meetUrl: string } | null = null;
  if (config) {
    try {
      const result = await input.book(config, input.draft);
      if (result.ok && result.meetUrl.trim()) {
        booked = { eventId: result.eventId, meetUrl: result.meetUrl };
      }
    } catch {
      booked = null;
    }
  }
  const saved = await input.save({
    draft: input.draft,
    status: booked ? "booked" : "saved",
    meetUrl: booked?.meetUrl ?? null,
    calendarEventId: booked?.eventId ?? null,
  });
  if (!saved) return { ok: false, error: "We couldn't save that time. Try again." };
  if (booked) return { ok: true, status: "booked", meetUrl: booked.meetUrl };
  await input.send(callSavedMail(input.draft));
  return { ok: true, status: "saved" };
}
