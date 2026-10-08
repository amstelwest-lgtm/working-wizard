/**
 * Fixture desks for the local mockup route. Numbers are stand-ins for fields
 * the live file already has. The desk does not invent a second set at render.
 *
 * Populated (USD) maps to:
 *   health 62 / Watch          OverviewBrief.health + healthLabel
 *   runway 6 weeks             OverviewBrief.runwayWeeks
 *   debtor days 71             OverviewBrief.debtorDays
 *   3 debtors, $48,200, >60    CollectionsSnapshot contacts past the 60-day bucket
 *   payroll +18%               varianceLine deltaPct on overheads_people
 *   activity lines             sync, snapshot import, bot run + pack still in review
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
  coverage: { controller: true, fpa: true, treasury: true },
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
      label: "Health",
      figure: "62 / 100 · Watch",
      source: "qbo",
      action: "draft_fix",
    },
    {
      id: "runway",
      label: "Cash runway",
      figure: "6 weeks",
      source: "qbo",
      action: "draft_fix",
    },
    {
      id: "debtors",
      label: "Debtor days",
      figure: "71 days",
      source: "qbo",
      action: "add_to_pack",
    },
  ],
  jobs: [
    {
      id: "collections",
      kind: "collections_chase",
      precardKind: "email",
      debtorCount: 3,
      olderThanDays: 60,
      amount: 48200,
    },
    {
      id: "budget",
      kind: "budget_variance",
      precardKind: "pack",
      lineLabel: "payroll",
      deltaPct: 18,
    },
  ],
  activity: [
    {
      id: "health-check",
      at: "2026-10-08T07:12:00.000Z",
      kind: "health_check",
      line: "Ran health check 07:12 · drafted Scorecard · waiting on your sign-off",
    },
    {
      id: "sync",
      at: "2026-10-08T16:00:00.000Z",
      kind: "sync",
      line: "Synced QuickBooks 16:00",
    },
    {
      id: "import",
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
  coverage: { controller: false, fpa: false, treasury: false },
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
