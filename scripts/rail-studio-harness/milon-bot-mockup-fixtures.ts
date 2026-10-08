/**
 * Fixture desks for the local mockup route. Numbers are stand-ins for fields
 * the live file already has. The desk does not invent a second set at render.
 *
 * Populated (USD) maps to:
 *   health 62 / Watch          OverviewBrief.health + healthLabel
 *   runway 6 weeks             OverviewBrief.runwayWeeks
 *   debtor days 71             OverviewBrief.debtorDays
 *   3 debtors, $48,200, >60    CollectionsSnapshot contacts past the 60-day bucket
 *   people costs +18%          varianceLine deltaPct on overheads_people
 *   activity lines             sync, snapshot import, health check, forecast run, cash-floor flag
 *
 * Empty (ZAR) has no timestamps, figures, jobs, or events.
 */
import type { MilonDeskModel } from "@/components/milon-bot-desk/contract";

const POPULATED_NOW = "2026-10-08T18:00:00.000Z";

export const POPULATED_DESK: MilonDeskModel = {
  clientName: "Harbour Glass",
  currency: "USD",
  now: POPULATED_NOW,
  syncedAt: "2026-10-08T16:00:00.000Z",
  agents: [
    { id: "accountant", status: "Books clean ✓", lastRunAt: "2026-10-08T16:00:00.000Z", tone: "ok" },
    { id: "analyst", status: "Forecast updated", lastRunAt: "2026-10-08T14:40:00.000Z", tone: "ok" },
    { id: "advisor", status: "Cash watch: 1 alert", lastRunAt: "2026-10-08T11:05:00.000Z", tone: "watch" },
  ],
  signoff: {
    state: {
      status: "in_review",
      version: 3,
      signedBy: null,
      firmName: null,
      signedAt: null,
      zone: "America/New_York",
      reviewedByKind: null,
    },
    signedDateLabel: null,
  },
  briefing: [
    {
      id: "health",
      agent: "accountant",
      label: "Health",
      figure: "62 / 100 · Watch",
      why: "Watchful rather than urgent. One or two ratios need attention.",
      source: "qbo",
      action: "draft_fix",
      actionLabel: "Draft plan",
    },
    {
      id: "runway",
      agent: "advisor",
      label: "Cash runway",
      figure: "6 weeks",
      why: "Cash is the constraint: runway is 6 weeks.",
      source: "qbo",
      action: "draft_fix",
    },
    {
      id: "debtors",
      agent: "advisor",
      label: "Debtor days",
      figure: "71 days",
      why: "Above the 40-day mark. 3 invoices are past 60 days.",
      source: "qbo",
      action: "add_to_pack",
    },
  ],
  jobs: [
    {
      id: "collections",
      agent: "advisor",
      kind: "collections_chase",
      precardKind: "email",
      debtorCount: 3,
      olderThanDays: 60,
      amount: 48200,
    },
    {
      id: "budget",
      agent: "analyst",
      kind: "budget_variance",
      precardKind: "pack",
      lineLabel: "people costs",
      deltaPct: 18,
    },
  ],
  activity: [
    {
      id: "sync",
      agent: "accountant",
      at: "2026-10-08T16:00:00.000Z",
      kind: "sync",
      line: "Synced QuickBooks 16:00",
    },
    {
      id: "forecast",
      agent: "analyst",
      at: "2026-10-08T14:40:00.000Z",
      kind: "forecast",
      line: "Updated the 13-week forecast 14:40",
    },
    {
      id: "cash",
      agent: "advisor",
      at: "2026-10-08T11:05:00.000Z",
      kind: "cash_watch",
      line: "Flagged the cash floor 11:05 · runway 6 weeks",
    },
    {
      id: "health-check",
      agent: "accountant",
      at: "2026-10-08T07:12:00.000Z",
      kind: "health_check",
      line: "Ran health check 07:12 · drafted Scorecard · waiting on your sign-off",
    },
    {
      id: "import",
      agent: "accountant",
      at: "2026-10-06T09:40:00.000Z",
      kind: "import",
      line: "Imported statement 6 Oct",
    },
  ],
  precard: {
    applies: true,
    blocked: { pack: false, email: true, bot: false },
  },
};

export const EMPTY_DESK: MilonDeskModel = {
  clientName: "Stillwater Co",
  currency: "ZAR",
  now: POPULATED_NOW,
  syncedAt: null,
  agents: [
    { id: "accountant", status: "No books on file yet", lastRunAt: null, tone: "idle" },
    { id: "analyst", status: "No forecast on file", lastRunAt: null, tone: "idle" },
    { id: "advisor", status: "No cash watch yet", lastRunAt: null, tone: "idle" },
  ],
  signoff: {
    state: {
      status: "draft",
      version: null,
      signedBy: null,
      firmName: null,
      signedAt: null,
      zone: "Africa/Johannesburg",
      reviewedByKind: null,
    },
    signedDateLabel: null,
  },
  briefing: [],
  jobs: [],
  activity: [],
  precard: {
    applies: false,
    blocked: { pack: false, email: false, bot: false },
  },
};
