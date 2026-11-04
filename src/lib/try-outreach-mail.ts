/**
 * Warm demo outreach to the visitor after the /try gate. Renders emails/try-outreach.tsx.
 */
import { createElement } from "react";
import { render } from "@react-email/render";
import TryOutreachEmail, {
  TRY_OUTREACH_HEADERS,
  TRY_OUTREACH_SUBJECT,
  TRY_OUTREACH_TEXT,
} from "../../emails/try-outreach";
import { TEAM_ALERT_FROM, type Mail } from "@/lib/trial-lead-alert";

let cachedBody: Promise<{ html: string; text: string }> | null = null;

export async function renderTryOutreachEmail(): Promise<{ html: string; text: string }> {
  if (!cachedBody) {
    cachedBody = render(createElement(TryOutreachEmail), { pretty: true }).then((html) => ({
      html: html.replace(/<link\b[^>]*rel="preload"[^>]*>\s*/g, ""),
      text: TRY_OUTREACH_TEXT,
    }));
  }
  return cachedBody;
}

export function tryOutreachVisitorMail(
  email: string,
  body: { html: string; text: string },
): Mail {
  return {
    to: email,
    from: TEAM_ALERT_FROM,
    subject: TRY_OUTREACH_SUBJECT,
    html: body.html,
    text: body.text,
    idempotencyKey: `try-outreach-visitor-${email}`.slice(0, 256),
    headers: { ...TRY_OUTREACH_HEADERS },
  };
}

/** Dedupe key for trial_lead_alerts — separate from the internal trial_start alert. */
export function tryOutreachAlertDedupeKey(email: string): string {
  return `outreach:${email}`;
}
