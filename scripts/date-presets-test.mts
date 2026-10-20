/**
 * Calendar presets for ZA and US, and a source scan that keeps new date
 * bypasses out of the app and the edge functions.
 * Run: pnpm test:date-presets
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ZA_MARKET } from "../src/lib/market/resolve";
import { advisoryLegacyMismatchLine } from "../src/lib/advisory-signoff";
import { trialEndDateLabel } from "../src/lib/firm-client-cap";
import {
  formatCalendarDay,
  formatDateTime,
  formatMonthDay,
  formatMonthLabel,
  formatMonthRange,
  formatMonthYear,
  formatReviewDateTime,
  formatWeekHeader,
} from "../src/lib/market/format";
import { formatDecisionWhen, formatIssuedOn } from "../src/lib/source-documents-ui";
import {
  formatSlotButton,
  formatSlotClock,
  formatSlotDay,
  formatSlotZoneShort,
} from "../src/lib/trial-call-slots";
import { dataFreshnessLine } from "../src/lib/workflow-coach";
import { formatInviteExpiry } from "../src/routes/_authenticated/settings.team";

const US = { locale: "en-US", timezone: "America/New_York", currency: "USD" as const };

assert.equal(formatCalendarDay("2026-11-02", ZA_MARKET), "2 Nov 2026");
assert.equal(formatCalendarDay("2026-11-02", US), "Nov 2, 2026");
assert.equal(formatCalendarDay("2026-09-08", ZA_MARKET), "8 Sep 2026");
assert.equal(formatCalendarDay("2026-09-08", US), "Sep 8, 2026");
assert.equal(formatCalendarDay("not-a-date", ZA_MARKET), "—");
assert.doesNotMatch(formatCalendarDay("2026-09-08", ZA_MARKET), /Sept/);

assert.equal(formatWeekHeader("2026-10-19", ZA_MARKET), "19 Oct");
assert.equal(formatWeekHeader("2026-10-19", US), "Oct 19");
assert.equal(formatWeekHeader("2026-09-08", ZA_MARKET), "8 Sep");
assert.equal(formatWeekHeader("2026-09-08", US), "Sep 8");

assert.equal(formatMonthLabel("2026-10", ZA_MARKET), "Oct 26");
assert.equal(formatMonthLabel("2026-10", US), "Oct 26");
assert.equal(formatMonthLabel("2026-09", ZA_MARKET), "Sep 26");

assert.equal(formatMonthRange("2026-03", "2027-02"), "Mar 2026 \u2013 Feb 2027");
assert.equal(formatMonthRange("2026-01", "2026-09"), "Jan 2026 \u2013 Sep 2026");
assert.equal(formatMonthRange("2026-03", "2026-03"), "Mar 2026");
assert.equal(formatMonthYear("2026-10-19T12:00:00.000Z", "UTC"), "Oct 2026");
assert.equal(formatMonthYear("2026-09-08T12:00:00.000Z", "UTC"), "Sep 2026");

const zaClock = formatDateTime("2026-11-02T07:54:00.000Z", ZA_MARKET);
assert.equal(zaClock, "2 Nov 2026, 09:54 SAST", zaClock);
assert.doesNotMatch(zaClock, /Sept|AM|PM|UTC/);

const usClock = formatDateTime("2026-11-02T14:54:00.000Z", US);
assert.equal(usClock, "Nov 2, 2026, 9:54 AM ET", usClock);

const review = formatReviewDateTime("2026-10-07T22:14:47.000Z", US);
assert.equal(review, "Oct 7, 2026, 6:14 PM ET");

assert.equal(
  formatDateTime("2026-11-02T15:54:00.000Z", { locale: "en-US", timezone: "America/Chicago" }),
  "Nov 2, 2026, 9:54 AM CT",
);
assert.equal(
  formatDateTime("2026-11-02T16:54:00.000Z", { locale: "en-US", timezone: "America/Denver" }),
  "Nov 2, 2026, 9:54 AM MT",
);
assert.equal(
  formatDateTime("2026-11-02T16:54:00.000Z", { locale: "en-US", timezone: "America/Phoenix" }),
  "Nov 2, 2026, 9:54 AM MT",
);
assert.equal(
  formatDateTime("2026-11-02T17:54:00.000Z", { locale: "en-US", timezone: "America/Los_Angeles" }),
  "Nov 2, 2026, 9:54 AM PT",
);
assert.equal(
  formatDateTime("2026-10-07T22:14:00.000Z", { locale: "en-US", timezone: "America/Chicago" }),
  "Oct 7, 2026, 5:14 PM CT",
);
assert.equal(
  formatDateTime("2026-10-07T22:14:00.000Z", { locale: "en-US", timezone: "America/Detroit" }),
  "Oct 7, 2026, 6:14 PM ET",
);
assert.equal(
  formatDateTime("2026-11-02T18:54:00.000Z", { locale: "en-US", timezone: "America/Anchorage" }),
  "Nov 2, 2026, 9:54 AM AKT",
);
assert.equal(
  formatDateTime("2026-11-02T19:54:00.000Z", { locale: "en-US", timezone: "Pacific/Honolulu" }),
  "Nov 2, 2026, 9:54 AM HT",
);

const zaFirm = { locale: "en-ZA", timezone: "Africa/Johannesburg" };
assert.equal(trialEndDateLabel("2026-09-08T06:00:00.000Z", ZA_MARKET), "8 Sep 2026");
assert.equal(trialEndDateLabel("2026-09-08T06:00:00.000Z", US), "Sep 8, 2026");
assert.equal(trialEndDateLabel("2026-09-08T22:00:00.000Z", zaFirm), "9 Sep 2026");
assert.equal(trialEndDateLabel("2026-09-08T22:00:00.000Z", US), "Sep 8, 2026");
assert.doesNotMatch(trialEndDateLabel("2026-09-08T06:00:00.000Z", ZA_MARKET) ?? "", /Sept|08 Sep/);

assert.equal(formatIssuedOn("2026-09-08", ZA_MARKET), "8 Sep 2026");
assert.equal(formatIssuedOn("2026-09-08", US), "Sep 8, 2026");
assert.doesNotMatch(formatIssuedOn("2026-09-08", ZA_MARKET), /Sept/);
assert.equal(
  formatDecisionWhen("2026-09-08T04:00:00.000Z", "Africa/Johannesburg", ZA_MARKET),
  "8 Sep 2026, 06:00 SAST",
);
assert.equal(
  formatDecisionWhen("2026-09-08T04:00:00.000Z", "America/New_York", US),
  "Sep 8, 2026, 12:00 AM ET",
);

assert.equal(formatMonthDay("2026-10-08T12:19:00.000Z", ZA_MARKET), "8 Oct");
assert.equal(formatMonthDay("2026-10-08T12:19:00.000Z", US), "Oct 8");
assert.equal(
  advisoryLegacyMismatchLine({
    status: "in_review",
    version: 12,
    pageSignedAt: "2026-10-08T12:19:00.000Z",
    pageSignedBy: "James Fleming",
    pageFirmName: "Ben Accountants",
    market: ZA_MARKET,
  }),
  "Advisory signed off 8 Oct by James Fleming, but pack v12 isn't signed; sign off v12",
);
assert.equal(
  advisoryLegacyMismatchLine({
    status: "in_review",
    version: 12,
    pageSignedAt: "2026-10-08T12:19:00.000Z",
    pageSignedBy: "James Fleming",
    pageFirmName: "Ben Accountants",
    market: US,
  }),
  "Advisory signed off Oct 8 by James Fleming, but pack v12 isn't signed; sign off v12",
);

assert.equal(
  dataFreshnessLine({
    xero: {
      lastSyncedAt: "2026-09-01T14:00:00.000Z",
      syncStatus: "ok",
      periodLabel: "September 2026",
    },
    market: US,
  }),
  "Last sync Sep 1, 2026, 10:00 AM ET · Xero · September 2026",
);
assert.equal(
  dataFreshnessLine({
    xero: {
      lastSyncedAt: "2026-09-01T14:00:00.000Z",
      syncStatus: "ok",
      periodLabel: "September 2026",
    },
    market: ZA_MARKET,
  }),
  "Last sync 1 Sep 2026, 16:00 SAST · Xero · September 2026",
);

const slotInstant = new Date("2026-10-19T14:30:00.000Z");
assert.equal(formatSlotDay(slotInstant, "America/New_York", "US"), "Monday, Oct 19, 2026");
assert.equal(formatSlotDay(slotInstant, "Africa/Johannesburg", "ZA"), "Monday, 19 Oct 2026");
assert.equal(formatSlotClock(slotInstant, "America/New_York", "US"), "10:30 AM");
assert.equal(formatSlotClock(slotInstant, "Africa/Johannesburg", "ZA"), "16:30");
assert.equal(formatSlotZoneShort(slotInstant, "America/New_York"), "ET");
assert.equal(formatSlotZoneShort(slotInstant, "America/Chicago"), "CT");
assert.equal(formatSlotZoneShort(slotInstant, "America/Denver"), "MT");
assert.equal(formatSlotZoneShort(slotInstant, "America/Los_Angeles"), "PT");
assert.equal(formatSlotZoneShort(slotInstant, "America/Anchorage"), "AKT");
assert.equal(formatSlotZoneShort(slotInstant, "Pacific/Honolulu"), "HT");
assert.equal(formatSlotZoneShort(slotInstant, "Africa/Johannesburg"), "SAST");
assert.equal(formatSlotButton(slotInstant, "America/New_York", "US"), "10:30 AM ET");
assert.equal(formatSlotButton(slotInstant, "America/Chicago", "US"), "9:30 AM CT");
assert.equal(formatSlotButton(slotInstant, "America/Denver", "US"), "8:30 AM MT");
assert.equal(formatSlotButton(slotInstant, "America/Los_Angeles", "US"), "7:30 AM PT");
assert.equal(formatSlotButton(slotInstant, "America/Anchorage", "US"), "6:30 AM AKT");
assert.equal(formatSlotButton(slotInstant, "Pacific/Honolulu", "US"), "4:30 AM HT");
assert.equal(formatSlotButton(slotInstant, "Africa/Johannesburg", "ZA"), "16:30 SAST");
assert.equal(formatSlotButton(slotInstant, "Africa/Johannesburg", "US"), "4:30 PM SAST");

assert.equal(formatInviteExpiry("2099-09-08T12:00:00.000Z", ZA_MARKET), "8 Sep 2099");
assert.equal(formatInviteExpiry("2099-09-08T12:00:00.000Z", US), "Sep 8, 2099");
assert.equal(formatInviteExpiry("2020-09-08T12:00:00.000Z", ZA_MARKET), "Expired 8 Sep 2020");
assert.doesNotMatch(formatInviteExpiry("2099-09-08T12:00:00.000Z", ZA_MARKET), /Sept/);
const teamSource = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/settings.team.tsx"),
  "utf8",
);
assert.equal(teamSource.includes("new Intl.DateTimeFormat"), false);
assert.equal(teamSource.includes("formatDate("), true);

console.log("date-presets ok");
