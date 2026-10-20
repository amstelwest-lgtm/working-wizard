/**
 * Lead alerts and call booking for /try.
 * Mail is built in trial-lead-alert.ts so /talk can send the same alert.
 * Sending is injected so tests never hit Resend.
 */
import { readGoogleCalendarConfig, type GoogleCalendarConfig } from "@/lib/google-calendar";
import { formatSlotClock24, isOfferedSlot, safeTimeZone } from "@/lib/trial-call-slots";
import {
  deliverLeadAlert,
  demoViewMail,
  mailShell,
  sendTeamMail,
  TEAM_ALERT_FROM,
  TEAM_ALERT_TO,
  trialStartMail,
  type AlertKind,
  type Mail,
} from "@/lib/trial-lead-alert";

export {
  deliverLeadAlert,
  demoViewMail,
  sendTeamMail,
  TEAM_ALERT_FROM,
  TEAM_ALERT_TO,
  trialStartMail,
};
export type { AlertKind, Mail };

export const TRIAL_CALLS_PER_IP_PER_DAY = 3;

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
