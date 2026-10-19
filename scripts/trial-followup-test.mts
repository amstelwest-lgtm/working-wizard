/**
 * Sample pack, call slots, lead alerts, and the outreach Starter link.
 * No Resend call and no Google call leave this file.
 * Run: pnpm test:trial-followup
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { firmSignupHref } from "../src/lib/firm-signup-copy";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_TOKEN_URL,
  HELLO_CALENDAR_ATTENDEE,
  bookGoogleMeet,
  exchangeGoogleAuthCode,
  googleConsentUrl,
  readGoogleCalendarConfig,
  type GoogleCalendarConfig,
} from "../src/lib/google-calendar";
import { SAMPLE_BUSINESS_NAME } from "../src/lib/sample-business";
import { TrySchedule } from "../src/components/try-schedule";
import {
  CALL_CLOSE_MINUTES,
  CALL_OPEN_MINUTES,
  callSlots,
  formatSlotButton,
  formatSlotClock24,
  formatSlotZoneLong,
  isOfferedSlot,
  marketFallbackZone,
  marketFallbackZoneLabel,
  slotClockLead,
  visitorTimeZone,
} from "../src/lib/trial-call-slots";
import {
  TEAM_ALERT_FROM,
  TEAM_ALERT_TO,
  arrangeTrialCall,
  callRateAllowed,
  deliverLeadAlert,
  demoViewMail,
  sendTeamMail,
  trialStartMail,
  validateCallRequest,
  type CallDraft,
  type Mail,
} from "../src/lib/trial-followup";
import { buildSampleAdvisoryPack } from "../src/lib/trial-sample-pack";
import { buildTrialBoard } from "../src/lib/trial-demo";
import { TrySignoffMark } from "../src/components/try-signoff";
import {
  TRY_OUTREACH_INCENTIVES,
  TRY_OUTREACH_INCENTIVES_KICKER,
  TRY_OUTREACH_SIGNUP_URL,
  TRY_OUTREACH_TEXT,
} from "../emails/try-outreach";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const root = resolve(".");
const us = buildTrialBoard("US");
const pack = buildSampleAdvisoryPack(us);
assert(pack.stamp === "SAMPLE", "the pack is stamped SAMPLE");
assert(pack.clientName === SAMPLE_BUSINESS_NAME, "the pack names Harbor & Pine");
assert(pack.clientName === "Harbor & Pine Supply Co.", "the sample company name is unchanged");
assert(pack.title === "Advisory pack", "the pack title is Advisory pack");
assert(
  pack.sections.some((section) => section.title === "Moves"),
  "the pack has moves",
);
const packText = JSON.stringify(pack);
assert(!packText.includes("ZAR"), "US pack copy has no ZAR");
assert(!/rand /.test(packText), "US pack copy has no rand");
assert(!packText.includes("South Africa"), "US pack copy has no country name");
assert(!packText.includes("R299"), "US pack copy has no rand price");
assert(!/R\s?\d/.test(packText), "US pack copy has no rand amount");

const mondayMorning = new Date("2026-10-19T12:00:00.000Z");
const mondaySlots = callSlots(mondayMorning);
assert(mondaySlots.length === 55, `five weekdays of half hours, got ${mondaySlots.length}`);
assert(
  mondaySlots[0]?.start.toISOString() === "2026-10-19T14:30:00.000Z",
  "first slot is 16:30 SAST",
);
assert(
  mondaySlots[10]?.start.toISOString() === "2026-10-19T19:30:00.000Z",
  "last Monday slot starts at 21:30 SAST",
);
assert(
  mondaySlots[10]?.end.toISOString() === "2026-10-19T20:00:00.000Z",
  "last Monday slot ends at 22:00 SAST",
);
assert(
  !mondaySlots.some((slot) => slot.start.toISOString() === "2026-10-19T14:00:00.000Z"),
  "16:00 SAST is before the window",
);
assert(
  !mondaySlots.some((slot) => slot.start.toISOString().startsWith("2026-10-24")),
  "Saturday is closed",
);
assert(
  !mondaySlots.some((slot) => slot.start.toISOString().startsWith("2026-10-26")),
  "the sixth weekday is not offered yet",
);
assert(CALL_OPEN_MINUTES === 16 * 60 + 30 && CALL_CLOSE_MINUTES === 22 * 60, "window constants");

const lateMonday = new Date("2026-10-19T19:40:00.000Z");
const afterClose = callSlots(lateMonday);
assert(
  afterClose[0]?.start.toISOString() === "2026-10-20T14:30:00.000Z",
  "a closed Monday rolls to Tuesday 16:30 SAST",
);
assert(
  afterClose.some((slot) => slot.start.toISOString().startsWith("2026-10-26")),
  "the next Monday is included once today is closed",
);
assert(isOfferedSlot("2026-10-19T14:30:00.000Z", mondayMorning), "an offered slot matches");
assert(!isOfferedSlot("2026-10-19T14:00:00.000Z", mondayMorning), "an off-window slot is rejected");
assert(
  formatSlotClock24(mondaySlots[0]!.start, "Africa/Johannesburg") === "16:30",
  "Johannesburg clock shows 16:30",
);
assert(
  formatSlotClock24(mondaySlots[0]!.start, "America/New_York") === "10:30",
  "a US visitor sees 10:30",
);
assert(visitorTimeZone("America/New_York") === "America/New_York", "a US clock stays local");
assert(
  visitorTimeZone("America/Los_Angeles") === "America/Los_Angeles",
  "a Pacific clock stays local on the US sample",
);
assert(
  visitorTimeZone("Africa/Johannesburg") === "Africa/Johannesburg",
  "a Johannesburg clock stays the visitor zone on every sample",
);
assert(visitorTimeZone("Not/A Zone") === null, "an unreadable zone is not treated as local");
assert(marketFallbackZone("US") === "America/New_York", "a failed read falls back to US Eastern");
assert(
  marketFallbackZone("ZA") === "Africa/Johannesburg",
  "a failed read on the ZA sample falls back to Johannesburg",
);
assert(marketFallbackZoneLabel("US") === "US Eastern Time", "the US fallback is named explicitly");
assert(
  marketFallbackZoneLabel("ZA") === "South Africa time",
  "the ZA fallback is named explicitly",
);
assert(
  !marketFallbackZoneLabel("US").includes("your local time") &&
    !marketFallbackZoneLabel("ZA").includes("your local time"),
  "a fallback never claims to be the visitor's local time",
);
assert(
  slotClockLead({
    local: false,
    zone: "America/New_York",
    when: mondaySlots[0]!.start,
    market: "US",
  }) === "Pick a time. Shown in US Eastern Time.",
  "a failed US detection says US Eastern Time",
);
assert(
  slotClockLead({
    local: true,
    zone: "Africa/Johannesburg",
    when: mondaySlots[0]!.start,
    market: "US",
  }).includes("your local time"),
  "a detected zone may say your local time",
);
assert(
  formatSlotButton(mondaySlots[0]!.start, "America/New_York") === "10:30 AM EDT",
  "a US slot is labelled in local time",
);
assert(
  formatSlotZoneLong(mondaySlots[0]!.start, "America/New_York") === "Eastern Time",
  "the US lead names Eastern Time",
);
assert(
  formatSlotZoneLong(mondaySlots[0]!.start, "Africa/Johannesburg") === "South Africa Standard Time",
  "Johannesburg's readable name comes from the clock",
);
assert(
  formatSlotButton(mondaySlots[0]!.start, "Africa/Johannesburg") === "4:30 PM SAST",
  "a Johannesburg slot is labelled SAST",
);
const usSchedule = renderToStaticMarkup(
  createElement(TrySchedule, {
    now: mondayMorning,
    timeZone: "America/New_York",
    market: "US",
  }),
);
assert(usSchedule.includes("10:30 AM EDT"), "US slots render in Eastern time");
assert(usSchedule.includes("Eastern Time"), "US slots name the local zone");
assert(!usSchedule.includes("Johannesburg"), "US slots are not labelled Johannesburg");
assert(!usSchedule.includes("SAST"), "US slots are not labelled SAST");
const usFromJohannesburg = renderToStaticMarkup(
  createElement(TrySchedule, {
    now: mondayMorning,
    timeZone: "Africa/Johannesburg",
    market: "US",
  }),
);
assert(
  usFromJohannesburg.includes("4:30 PM SAST") && usFromJohannesburg.includes("your local time"),
  "market=us from a Johannesburg clock shows that clock",
);
assert(!usFromJohannesburg.includes("EDT"), "a Johannesburg clock is not labelled EDT");
assert(
  !usFromJohannesburg.includes("Eastern Time"),
  "a Johannesburg clock is not labelled Eastern Time",
);
const pendingSchedule = renderToStaticMarkup(createElement(TrySchedule, { market: "US" }));
assert(pendingSchedule.includes("Pick a time."), "the server lead is neutral");
assert(!pendingSchedule.includes("your local time"), "the server lead does not claim a local zone");
assert(
  !pendingSchedule.includes("EDT") && !pendingSchedule.includes("SAST"),
  "the server paints no slot clocks",
);
assert(pendingSchedule.includes("Loading times"), "slot clocks wait until the zone is known");
const zaSchedule = renderToStaticMarkup(
  createElement(TrySchedule, {
    now: mondayMorning,
    timeZone: "Africa/Johannesburg",
    market: "ZA",
  }),
);
assert(zaSchedule.includes("16:30 SAST"), "ZA slots render in local SAST");

const draft: CallDraft = {
  name: "Ada Firm",
  email: "ada@example.com",
  country: "US",
  start: mondaySlots[0]!.start,
  end: mondaySlots[0]!.end,
  timeZone: "America/New_York",
  ipHash: "hash",
};

const gate = validateCallRequest({
  name: " Ada  Firm ",
  email: "Ada@Example.com",
  consent: true,
  start: mondaySlots[0]!.start.toISOString(),
  timeZone: "America/New_York",
  now: mondayMorning,
});
assert(gate.ok === true && gate.ok && gate.email === "ada@example.com", "email is normalised");
assert(
  validateCallRequest({
    name: "Ada",
    email: "ada@example.com",
    consent: true,
    honeypot: "bot",
    start: mondaySlots[0]!.start.toISOString(),
    now: mondayMorning,
  }).ok === false,
  "honeypot stays silent",
);

const config: GoogleCalendarConfig = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  calendarId: "hello@milonfinance.com",
};
assert(readGoogleCalendarConfig({}) === null, "missing calendar env does not book");
assert(
  readGoogleCalendarConfig({
    GOOGLE_CALENDAR_CLIENT_ID: "client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
    GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh",
  }) === null,
  "a missing calendar id does not book",
);
assert(
  readGoogleCalendarConfig({
    GOOGLE_CALENDAR_CLIENT_ID: "client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
    GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh",
    GOOGLE_CALENDAR_ID: "primary",
  })?.calendarId === "primary",
  "all four calendar env vars enable booking",
);

const sent: Mail[] = [];
const saved: { status: string; meetUrl: string | null }[] = [];
let booked = 0;
const fallback = await arrangeTrialCall({
  env: {},
  draft,
  save: async (row) => {
    saved.push({ status: row.status, meetUrl: row.meetUrl });
    return true;
  },
  book: async () => {
    booked += 1;
    return { ok: false };
  },
  send: async (mail) => {
    sent.push(mail);
    return { ok: true };
  },
});
assert(fallback.ok && fallback.status === "saved", "missing calendar env saves the request");
assert(booked === 0, "missing calendar env does not call Google");
assert(sent.length === 1, "missing calendar env emails the founder");
assert(sent[0]?.to === TEAM_ALERT_TO && sent[0]?.to === "amstel.west@gmail.com", "alert recipient");
assert(
  sent[0]?.from === TEAM_ALERT_FROM && sent[0]?.from.includes("team@milonfinance.com"),
  "from team@",
);
assert(saved[0]?.status === "saved" && saved[0]?.meetUrl == null, "saved row has no Meet link");

sent.length = 0;
saved.length = 0;
const bookedCall = await arrangeTrialCall({
  env: {
    GOOGLE_CALENDAR_CLIENT_ID: "client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
    GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh",
    GOOGLE_CALENDAR_ID: "primary",
  },
  draft,
  save: async (row) => {
    saved.push({ status: row.status, meetUrl: row.meetUrl });
    return true;
  },
  book: async (_active, next) => {
    assert(next.email === "ada@example.com", "the booking uses the visitor email");
    return { ok: true, eventId: "evt", meetUrl: "https://meet.google.com/abc-defg-hij" };
  },
  send: async (mail) => {
    sent.push(mail);
    return { ok: true };
  },
});
assert(bookedCall.ok && bookedCall.status === "booked", "configured calendar books the call");
assert(
  bookedCall.ok && bookedCall.status === "booked" && bookedCall.meetUrl.includes("meet.google.com"),
  "a Meet link comes back",
);
assert(sent.length === 0, "a booked call does not also email the founder");
assert(saved[0]?.status === "booked", "the saved row is booked");

sent.length = 0;
const failedBook = await arrangeTrialCall({
  env: {
    GOOGLE_CALENDAR_CLIENT_ID: "client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
    GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh",
    GOOGLE_CALENDAR_ID: "primary",
  },
  draft,
  save: async () => true,
  book: async () => {
    throw new Error("calendar down");
  },
  send: async (mail) => {
    sent.push(mail);
    return { ok: true };
  },
});
assert(failedBook.ok && failedBook.status === "saved", "a calendar failure saves the request");
assert(
  sent.length === 1 && sent[0]?.to === "amstel.west@gmail.com",
  "a calendar failure emails the founder",
);

const seen = new Set<string>();
let alertSends = 0;
const firstView = await deliverLeadAlert({
  kind: "demo_view",
  dedupeKey: "visitor-1",
  mail: demoViewMail({ country: "US", when: "2026-10-19T12:00:00.000Z", visitor: "visitor-1" }),
  claim: async (kind, key) => {
    const id = `${kind}:${key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  },
  send: async () => {
    alertSends += 1;
    return { ok: true };
  },
});
const secondView = await deliverLeadAlert({
  kind: "demo_view",
  dedupeKey: "visitor-1",
  mail: demoViewMail({ country: "US", when: "2026-10-19T13:00:00.000Z", visitor: "visitor-1" }),
  claim: async (kind, key) => !seen.has(`${kind}:${key}`),
  send: async () => {
    alertSends += 1;
    return { ok: true };
  },
});
assert(firstView.sent && !firstView.deduped, "the first demo view alerts");
assert(secondView.deduped && !secondView.sent, "the same visitor does not alert twice");
assert(alertSends === 1, "one demo-view email");

const startMail = trialStartMail({ name: "Ada Firm", email: "ada@example.com", country: "US" });
const started = await deliverLeadAlert({
  kind: "trial_start",
  dedupeKey: "ada@example.com",
  mail: startMail,
  claim: async (kind, key) => {
    const id = `${kind}:${key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  },
  send: async () => {
    alertSends += 1;
    return { ok: true };
  },
});
const startedAgain = await deliverLeadAlert({
  kind: "trial_start",
  dedupeKey: "ada@example.com",
  mail: startMail,
  claim: async (kind, key) => !seen.has(`${kind}:${key}`),
  send: async () => {
    alertSends += 1;
    return { ok: true };
  },
});
assert(started.sent, "trial start alerts");
assert(startedAgain.deduped && !startedAgain.sent, "the same email does not start twice");
assert(alertSends === 2, "demo view and trial start are separate alerts");
assert(startMail.to === "amstel.west@gmail.com", "trial start goes to the founder");
assert(startMail.from.includes("team@milonfinance.com"), "trial start is from team@");

let fetchCalls = 0;
const skipped = await sendTeamMail(startMail, {
  apiKey: "",
  fetchImpl: async () => {
    fetchCalls += 1;
    throw new Error("Resend must not be called");
  },
});
assert(skipped.ok === false && skipped.skipped === true, "a missing key does not send");
assert(fetchCalls === 0, "tests do not call Resend");

const resendBodies: string[] = [];
const sentMail = await sendTeamMail(startMail, {
  apiKey: "re_test_only",
  fetchImpl: async (input, init) => {
    assert(String(input) === "https://api.resend.com/emails", "mail goes to Resend");
    resendBodies.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  },
});
assert(sentMail.ok, "a configured key posts the mail");
assert(resendBodies[0]?.includes("team@milonfinance.com"), "the Resend payload is from team@");
assert(resendBodies[0]?.includes("amstel.west@gmail.com"), "the Resend payload is to the founder");
assert(!resendBodies[0]?.includes("re_test_only"), "the api key stays out of the body");

const consent = googleConsentUrl({ clientId: "client", redirectUri: "http://127.0.0.1:8787" });
assert(consent.includes("access_type=offline"), "consent asks for offline access");
assert(consent.includes("prompt=consent"), "consent forces a refresh token");
assert(
  consent.includes(encodeURIComponent(GOOGLE_CALENDAR_SCOPE)),
  "consent scope is calendar events",
);
assert(!consent.includes("calendar/v3"), "consent does not insert an event");

let tokenGrant = "";
const exchanged = await exchangeGoogleAuthCode({
  clientId: "client",
  clientSecret: "secret",
  code: "code",
  redirectUri: "http://127.0.0.1:8787",
  fetchImpl: async (input, init) => {
    assert(String(input) === GOOGLE_TOKEN_URL, "code exchange uses the token endpoint");
    tokenGrant = String(init?.body ?? "");
    return new Response(JSON.stringify({ refresh_token: "refresh", access_token: "access" }), {
      status: 200,
    });
  },
});
assert(exchanged.refreshToken === "refresh", "the consent exchange returns a refresh token");
assert(tokenGrant.includes("grant_type=authorization_code"), "the grant is an authorization code");

const googleCalls: { url: string; body: string }[] = [];
const meet = await bookGoogleMeet({
  config,
  fetchImpl: async (input, init) => {
    const url = String(input);
    googleCalls.push({ url, body: String(init?.body ?? "") });
    if (url === GOOGLE_TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "ya29.test" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ id: "evt-1", hangoutLink: "https://meet.google.com/abc-defg-hij" }),
      { status: 200 },
    );
  },
  booking: {
    summary: "Milōn sample call — Ada Firm",
    description: "Sample call",
    start: draft.start,
    end: draft.end,
    attendeeEmail: draft.email,
    requestId: "req-1",
  },
});
assert(meet.ok && meet.meetUrl.includes("meet.google.com"), "booking reads the Meet link");
assert(googleCalls[1]?.url.includes("conferenceDataVersion=1"), "booking asks for Meet");
assert(googleCalls[1]?.body.includes(HELLO_CALENDAR_ATTENDEE), "the event invites hello@");
assert(googleCalls[1]?.body.includes("ada@example.com"), "the event invites the visitor");

const noMeet = await bookGoogleMeet({
  config,
  fetchImpl: async (input) => {
    if (String(input) === GOOGLE_TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "ya29.test" }), { status: 200 });
    }
    return new Response("no", { status: 500 });
  },
  booking: {
    summary: "Milōn sample call",
    description: "Sample call",
    start: draft.start,
    end: draft.end,
    attendeeEmail: draft.email,
    requestId: "req-2",
  },
});
assert(!noMeet.ok, "a failed insert does not pretend to book");

assert(callRateAllowed(2) && !callRateAllowed(3), "three calls a day is the cap");

const open = renderToStaticMarkup(createElement(TrySignoffMark, { signed: false }));
const signed = renderToStaticMarkup(createElement(TrySignoffMark, { signed: true }));
assert(open.includes("Sign off") && open.includes("try-signoff-arrow"), "Sign off has an arrow");
assert(open.includes(">Sign off<"), "the button starts as Sign off");
assert(!open.includes("Approved by you"), "there is no approval stamp before the click");
assert(!signed.includes("Approved by you"), "signing does not stamp Approved by you");
assert(signed.includes(">Signed off<"), "the button reads Signed off");
assert(signed.includes("try-signature-stroke"), "signing draws the signature");
assert(signed.includes("try-signoff-btn"), "the sign-off button stays on the page");

const signoffSource = readFileSync(join(root, "src/components/try-signoff.tsx"), "utf8");
assert(!signoffSource.includes("createServerFn"), "demo sign-off has no server function");
assert(!signoffSource.includes("supabase"), "demo sign-off does not write");
assert(!signoffSource.includes("fetch("), "demo sign-off does not send");

const starter = `https://www.milonfinance.com${firmSignupHref("starter")}&utm_source=email`;
assert(TRY_OUTREACH_SIGNUP_URL === starter, "the outreach trial link is accountant Starter");
assert(!TRY_OUTREACH_SIGNUP_URL.includes("plan=solo"), "the outreach trial link is not Solo");
assert(
  TRY_OUTREACH_SIGNUP_URL.includes("plan=starter"),
  "the outreach trial link sets plan=starter",
);
assert(TRY_OUTREACH_TEXT.includes(TRY_OUTREACH_INCENTIVES_KICKER), "the text attributes the tests");
for (const line of TRY_OUTREACH_INCENTIVES) {
  assert(TRY_OUTREACH_TEXT.includes(line), `the text includes ${line}`);
}

const authScript = readFileSync(join(root, "scripts/google-calendar-auth.mts"), "utf8");
assert(authScript.includes("googleConsentUrl"), "the auth script prints the consent URL");
assert(!authScript.includes("api.resend.com"), "the auth script does not send mail");
assert(!authScript.includes("/events"), "the auth script does not insert an event");

const sql = readFileSync(
  join(root, "supabase/migrations/20261019120000_trial_calls_and_alerts.sql"),
  "utf8",
);
assert(
  sql.includes("trial_lead_alerts") && sql.includes("trial_call_requests"),
  "migration adds both tables",
);
assert(sql.includes("UNIQUE (kind, dedupe_key)"), "alerts are deduped in the database");
assert(/enable row level security/i.test(sql), "RLS is on");
assert(!/create\s+policy/i.test(sql), "no anon policy");
assert(
  /revoke all on table public\.trial_lead_alerts from public, anon, authenticated/i.test(sql),
  "anon cannot read alerts",
);
assert(sql.includes("team@") === false, "the migration does not store a mailbox");

const clientFiles = [
  "src/components/try-demo.tsx",
  "src/components/try-signoff.tsx",
  "src/components/try-schedule.tsx",
  "src/components/try-sample-pack.tsx",
  "src/lib/trial-sample-pack.ts",
  "src/lib/trial-call-slots.ts",
  "src/styles/try.css",
];
const banned = ["ZAR", "rand ", "South Africa", "South African", "R299", "R2,837"];
for (const file of clientFiles) {
  const text = readFileSync(join(root, file), "utf8");
  for (const needle of banned) {
    assert(!text.includes(needle), `${file} contains ${needle}`);
  }
}

console.log("trial-followup: ok");
