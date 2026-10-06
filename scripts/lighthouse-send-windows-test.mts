/**
 * E17 send windows: Tue–Thu 08:00–10:00 local, ET / PT / SAST.
 * Run: pnpm test:lighthouse-send-windows
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LIGHTHOUSE_SENDER_NAME } from "../src/lib/lighthouse-sender";
import {
  formatOpsCount,
  formatOpsPercent,
  formatUsageMetric,
  firmCardTitle,
  geoWindowLine,
  isDryRunCohortName,
  nextUpAction,
  zoneClocks,
} from "../src/lib/lighthouse-agent";
import { pilotFlagWiring } from "../src/lib/ops-pilot-flags";
import { disambiguateGrantLabel } from "../src/lib/lighthouse-access.functions";
import {
  isSendWindowOpen,
  nextWindowLine,
  nextWindowStart,
  resolveRecipientZone,
  sendBlockedReason,
  sendWindowStatus,
  US_TIME_ZONES,
  SA_TIME_ZONE,
} from "../src/lib/lighthouse-send-windows";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ET = US_TIME_ZONES.ET;
const PT = US_TIME_ZONES.PT;
const SAST = SA_TIME_ZONE;

function at(iso: string) {
  return new Date(iso);
}

assert(isSendWindowOpen(at("2026-10-06T12:00:00.000Z"), ET), "Tue 08:00 ET is inside the window");
assert(isSendWindowOpen(at("2026-10-06T13:59:00.000Z"), ET), "Tue 09:59 ET is inside the window");
assert(!isSendWindowOpen(at("2026-10-06T14:00:00.000Z"), ET), "Tue 10:00 ET is outside the window");
assert(!isSendWindowOpen(at("2026-10-06T11:59:00.000Z"), ET), "Tue 07:59 ET is outside the window");
assert(isSendWindowOpen(at("2026-10-07T12:30:00.000Z"), ET), "Wed 08:30 ET is inside the window");
assert(isSendWindowOpen(at("2026-10-08T13:00:00.000Z"), ET), "Thu 09:00 ET is inside the window");
assert(!isSendWindowOpen(at("2026-10-05T13:00:00.000Z"), ET), "Mon ET is outside the Tue–Thu rule");
assert(!isSendWindowOpen(at("2026-10-09T13:00:00.000Z"), ET), "Fri ET is outside the Tue–Thu rule");
assert(!isSendWindowOpen(at("2026-10-10T13:00:00.000Z"), ET), "Sat ET is outside the Tue–Thu rule");
assert(!isSendWindowOpen(at("2026-10-11T13:00:00.000Z"), ET), "Sun ET is outside the Tue–Thu rule");

assert(isSendWindowOpen(at("2026-10-06T15:00:00.000Z"), PT), "Tue 08:00 PT is inside the window");
assert(!isSendWindowOpen(at("2026-10-06T14:00:00.000Z"), PT), "Tue 07:00 PT is outside the window");
assert(isSendWindowOpen(at("2026-10-07T15:30:00.000Z"), PT), "Wed 08:30 PT is inside the window");
assert(!isSendWindowOpen(at("2026-10-08T17:00:00.000Z"), PT), "Thu 10:00 PT is outside the window");
assert(!isSendWindowOpen(at("2026-10-09T16:00:00.000Z"), PT), "Fri PT is outside the Tue–Thu rule");

assert(isSendWindowOpen(at("2026-10-06T06:00:00.000Z"), SAST), "Tue 08:00 SAST is inside the window");
assert(isSendWindowOpen(at("2026-10-06T07:59:00.000Z"), SAST), "Tue 09:59 SAST is inside the window");
assert(!isSendWindowOpen(at("2026-10-06T08:00:00.000Z"), SAST), "Tue 10:00 SAST is outside the window");
assert(!isSendWindowOpen(at("2026-10-05T07:00:00.000Z"), SAST), "Mon SAST is outside the Tue–Thu rule");
assert(!isSendWindowOpen(at("2026-10-10T07:00:00.000Z"), SAST), "Sat SAST is outside the Tue–Thu rule");

const earlyEt = sendWindowStatus({ timezone: ET }, at("2026-10-06T11:00:00.000Z"));
assert(!earlyEt.open, "before 08:00 ET is closed");
assert(
  earlyEt.nextOpensAt === "2026-10-06T12:00:00.000Z",
  "next ET window is the same Tuesday at 08:00",
);

const afterThu = nextWindowStart(at("2026-10-08T14:00:00.000Z"), ET);
assert(afterThu.toISOString() === "2026-10-13T12:00:00.000Z", "Thu 10:00 ET rolls to next Tuesday");

const fridayPt = sendBlockedReason({ timezone: PT }, at("2026-10-09T16:00:00.000Z"));
assert(Boolean(fridayPt && fridayPt.includes("Send blocked")), "Send now is blocked on Friday PT");

const openSa = sendBlockedReason({ timezone: SAST }, at("2026-10-06T06:30:00.000Z"));
assert(openSa === null, "Send now is allowed inside the SAST window");

assert(resolveRecipientZone({ country: "US" }).zone === "ET", "US with no state defaults to ET");
assert(resolveRecipientZone({ country: "US", state: "CA" }).zone === "PT", "California is PT");
assert(resolveRecipientZone({ country: "US", state: "Texas" }).zone === "CT", "Texas is CT");
assert(resolveRecipientZone({ city: "Cape Town" }).zone === "SAST", "a SA city uses Johannesburg");
assert(resolveRecipientZone({ email: "ada@firm.co.za" }).zone === "SAST", ".co.za is SAST");
assert(
  resolveRecipientZone({ timezone: "Africa/Johannesburg" }).timeZone === SAST,
  "an explicit Johannesburg timezone wins",
);

const unknown = sendBlockedReason({ city: "Paris" }, at("2026-10-06T12:00:00.000Z"));
assert(Boolean(unknown), "an unclassified place cannot send");

assert(LIGHTHOUSE_SENDER_NAME === "The MILŌN Team", "signer is The MILŌN Team");
assert(formatOpsCount(0) === "0", "a zero count is 0");
assert(formatOpsPercent(0) === "0%", "a zero rate is 0%");
assert(formatUsageMetric(0, 0) === "0", "a zero usage pair is 0, not 00u");
assert(
  firmCardTitle({ name: "team", company: "Acme Plumbing", email: "team@acme.com" }) ===
    "Acme Plumbing",
  "a mailbox local-part yields the firm name",
);
assert(isDryRunCohortName("Milōn Dry Run"), "a dry-run cohort still wears the badge");
assert(
  firmCardTitle({
    name: "Janet Killingsworth",
    company: "Milōn Dry Run",
    email: "janet@firm.com",
  }) === "Milōn Dry Run",
  "the company name stays the label, including a dry-run cohort",
);
assert(
  firmCardTitle({ name: "team", company: "Milōn Dry Run", email: "team@trymilon.com" }) ===
    "Milōn Dry Run",
  "a generic mailbox under a firm name yields the firm",
);
assert(
  nextWindowLine({
    open: false,
    zone: null,
    nextLabel: "Set US or South Africa",
    countdownLabel: "—",
  }) === null,
  "an unset place hides the filler window line",
);
assert(
  nextWindowLine({
    open: false,
    zone: "ET",
    nextLabel: "Tue 08:00 ET",
    countdownLabel: "17h 0m",
  }) === "Next window Tue 08:00 ET (17h 0m)",
  "a closed window shows the real next opening",
);
assert(
  firmCardTitle({ name: "team", company: "", email: "team@trymilon.com" }) === "Trymilon",
  "with no firm or contact, the card uses the email domain",
);
assert(
  firmCardTitle({ name: "theoamstel123", email: "theoamstel123@gmail.com" }) ===
    "theoamstel123@gmail.com",
  "a consumer mailbox falls back to the raw email",
);
assert(pilotFlagWiring("signup_open") === "Not wired yet", "unreadable pilot knobs are not live");
assert(
  disambiguateGrantLabel({
    name: "My practice",
    ownerEmail: "ada@firm.co.za",
    createdAt: "2026-01-02T00:00:00.000Z",
    id: "abcdef12-3456-7890-abcd-ef1234567890",
  }).includes("ada@firm.co.za"),
  "duplicate practice names keep the owner email",
);

const fns = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
assert(fns.includes("next.auto_send = false"), "auto_send stays false");
assert(fns.includes("sendBlockedReason"), "the send path enforces the window");
assert(
  fns.includes("if (windowBlock) throw new Error(windowBlock)"),
  "server-side sendBlockedReason check still throws before send",
);
assert(fns.includes(LIGHTHOUSE_SENDER_NAME) || fns.includes("LIGHTHOUSE_SENDER_NAME"), "send module keeps the team signer");

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert((panel.match(/preview: true/g) ?? []).length >= 2, "preview flag exists in inbox and drawer");
assert(panel.includes("Preview send"), "Preview send is offered when the window is closed");
assert(
  panel.includes("Preview only — send window closed:"),
  "preview dialog names the closed-window reason",
);
assert(
  /disabled=\{Boolean\(confirmSend\.preview\)\}[\s\S]{0,1600}Confirm send/.test(panel),
  "Confirm send is disabled when preview",
);
assert(
  /if \(confirmSend\.preview\) return;[\s\S]{0,800}sendTouch\(/.test(panel),
  "preview onClick returns before sendTouch",
);
const tueMidday = at("2026-10-06T13:00:00.000Z");
const tueLine = geoWindowLine(zoneClocks([], tueMidday));
assert(tueLine.startsWith("US Open · SA opens in "), `Tue 09:00 ET window line: ${tueLine}`);
assert(/17h/.test(tueLine), `SA countdown from 13:00Z: ${tueLine}`);
assert(
  geoWindowLine([
    {
      zone: "ET",
      geo: "US",
      open: true,
      nextLabel: "Tue 08:00 ET",
      countdownLabel: "open",
      due: 1,
      dueNow: 1,
    },
    {
      zone: "SAST",
      geo: "SA",
      open: false,
      nextLabel: "Wed 08:00 SAST",
      countdownLabel: "17h 0m",
      due: 0,
      dueNow: 0,
    },
  ]) === "US Open · SA opens in 17h 0m",
  "the mix line names an open US window and the SA countdown",
);

const twoDrafts = nextUpAction({
  inbox: [
    {
      touchId: "t1",
      leadId: "a",
      title: "Acme",
      subject: "Hi",
      angle: "observation",
      status: "draft",
    },
    {
      touchId: "t2",
      leadId: "b",
      title: "Cape",
      subject: "Hi",
      angle: "value",
      status: "draft",
    },
  ],
  queue: [
    {
      leadId: "a",
      title: "Acme Plumbing",
      email: null,
      zone: "ET",
      geo: "US",
      open: true,
      nextLabel: "Tue 08:00 ET",
      countdownLabel: "open",
      stepNo: 1,
    },
  ],
  hasFirms: true,
});
assert(
  twoDrafts.label === "Review 2 drafts" && twoDrafts.touchId === "t1" && twoDrafts.kind === "review",
  "pending drafts are the single next action",
);
assert(
  nextUpAction({
    inbox: [
      {
        touchId: "t1",
        leadId: "a",
        title: "Acme",
        subject: "Hi",
        angle: "observation",
        status: "draft",
      },
    ],
    queue: [],
    hasFirms: true,
  }).label === "Review 1 draft",
  "one pending draft stays singular",
);
assert(
  nextUpAction({
    inbox: [
      {
        touchId: "t9",
        leadId: "a",
        title: "Acme",
        subject: "Hi",
        angle: "observation",
        status: "approved",
      },
    ],
    queue: [],
    hasFirms: true,
  }).label === "Open approved draft",
  "an approved draft opens the inbox and does not send",
);
assert(
  nextUpAction({
    inbox: [],
    queue: [
      {
        leadId: "late",
        title: "Late Co",
        email: null,
        zone: "ET",
        geo: "US",
        open: false,
        nextLabel: "Tue 08:00 ET",
        countdownLabel: "2h 0m",
        stepNo: 2,
      },
      {
        leadId: "now",
        title: "Acme Plumbing",
        email: null,
        zone: "ET",
        geo: "US",
        open: true,
        nextLabel: "Tue 08:00 ET",
        countdownLabel: "open",
        stepNo: 1,
      },
    ],
    hasFirms: true,
  }).label === "Follow up with Acme Plumbing",
  "the next action follows the firm whose window is open",
);
assert(
  nextUpAction({ inbox: [], queue: [], hasFirms: false }).label === "Import cohort",
  "an empty book imports a cohort",
);
assert(
  nextUpAction({ inbox: [], queue: [], hasFirms: true }).label === "Run plan (dry-run)",
  "firms with nothing due run a dry-run plan",
);

assert(
  panel.includes("disabled={!window?.open || Boolean(heldColdReason)}"),
  "inbox Send now stays disabled outside the window and when a call is held",
);
assert(
  panel.includes(
    "disabled={sending || !approved || !windowStatus.open || lead.doNotContact || Boolean(heldColdReason)}",
  ),
  "drawer Send now stays disabled outside the window and when a call is held",
);

console.log("lighthouse send windows ok");
