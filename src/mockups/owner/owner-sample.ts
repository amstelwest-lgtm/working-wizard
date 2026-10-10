/**
 * Harbour Glass — static owner-door sample.
 *
 * Figures are derived once (closings from SavedCashflowLike, debtor days
 * from the books, margin points from the two rates) and every screen reads
 * them from here. Nothing is fetched.
 *
 * Shape notes, for when this maps onto the live feed:
 * - feed[]        → TeamActivityEvent (kind, agent, text, at)
 * - actions[]     → TeamJob, plus assignee / due which the job type lacks
 * - deliverables  → TeamJob status awaiting_signoff | signed_off
 * - signoffLine   → MilonTeamFeed.signoffLine via signoffStatusLine
 * - cashflow      → SavedCashflowLike, closings via closingBalancesFromCashflow
 * Production AgentKey is bookkeeper | analyst | advisor. Financial Manager
 * is not that bookkeeper key, so this mock keeps its own bot key.
 */
import { closingBalancesFromCashflow, type SavedCashflowLike } from "@/lib/cash-runway";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market/resolve";
import { healthBandLabel, scoreTier } from "@/lib/ratios";
import { signoffStatusLine } from "@/lib/signoff-status";
import type { TeamActivityKind, TeamJobStatus } from "@/lib/milon-team-feed";
import { OWNER_TEAM, ownerHandoff, type OwnerBotKey, type OwnerPresence } from "./owner-team";

export const OWNER_NOW = new Date("2026-10-10T08:00:00.000Z");

const MARKET: MoneyMarket = ZA_MARKET;

export function zar(n: number): string {
  return formatMoney(n, MARKET).replace(/ /g, "\u00a0");
}

export const HARBOUR = {
  name: "Harbour Glass",
  place: "Cape Town",
  trade: "Manufacturing",
  books: "QuickBooks" as const,
  asOf: "2026-09-30",
  asOfLabel: "30 Sep",
} as const;

/**
 * Owner price, locked. South Africa is rand. The United States is dollars.
 * Harbour Glass is in Cape Town, so the door renders rand only, and only on
 * the Plan view when the accountant is not on Milōn. The free sentence is
 * the invite seat's line, not a plan-line suffix.
 */
export const OWNER_PLAN = {
  za: "R299/mo",
  us: "$39/mo",
  freeLine: "Free when your accountant joins Milōn",
  priceLine: "Owner plan · R299/mo",
} as const;

export function ownerPlanIncluded(firm: string): string {
  return `Owner plan · included — ${firm} is on Milōn`;
}

/** Owner-only packs. Never the accountant's "Signed off" badge. */
export const OWNER_PACK = {
  reviewed: "Reviewed by you",
  invite: "Invite your accountant to sign off",
} as const;

export const HARBOUR_ACCOUNTANT = {
  name: "Thandiwe Khumalo",
  firm: "Kloof & Partners",
  place: "Cape Town",
  signedOn: "8 Oct",
} as const;

export const HARBOUR_STAFF = [
  { id: "johan", name: "Johan Pietersen", role: "Sales" },
  { id: "amina", name: "Amina Rahman", role: "Workshop" },
  { id: "lerato", name: "Lerato Ndlovu", role: "Operations" },
  { id: "sipho", name: "Sipho Dlamini", role: "Accounts" },
] as const;

export type StaffId = (typeof HARBOUR_STAFF)[number]["id"];

const SEPTEMBER_REVENUE = 4_820_000;
const AUGUST_MARGIN = 36;
const SEPTEMBER_MARGIN = 33;
const DEBTORS_TOTAL = 6_420_000;
const ATLANTIC = 1_280_000;
const VA_JOINERY = 860_000;
const OPENING_CASH = 1_860_000;
const CASH_FLOOR = 720_000;
const HEALTH_SCORE = 64;

/** Week-of dates for the 13-week line. Week 1 starts the Monday after 10 Oct 2026. */
export const HARBOUR_WEEK_OF = [
  "2026-10-12",
  "2026-10-19",
  "2026-10-26",
  "2026-11-02",
  "2026-11-09",
  "2026-11-16",
  "2026-11-23",
  "2026-11-30",
  "2026-12-07",
  "2026-12-14",
  "2026-12-21",
  "2026-12-28",
  "2027-01-04",
] as const;

const WEEK_FLOWS: readonly { inn: number; out: number }[] = [
  { inn: 420_000, out: 540_000 },
  { inn: 280_000, out: 840_000 },
  { inn: 860_000, out: 400_000 },
  { inn: 310_000, out: 970_000 },
  { inn: 450_000, out: 570_000 },
  { inn: 1_280_000, out: 620_000 },
  { inn: 390_000, out: 630_000 },
  { inn: 180_000, out: 850_000 },
  { inn: 980_000, out: 380_000 },
  { inn: 360_000, out: 680_000 },
  { inn: 410_000, out: 520_000 },
  { inn: 640_000, out: 680_000 },
  { inn: 520_000, out: 450_000 },
];

export const HARBOUR_CASHFLOW: SavedCashflowLike = {
  openingBalance: String(OPENING_CASH),
  revenue: WEEK_FLOWS.map((week, index) => ({
    amount: String(week.inn),
    frequency: "once-off",
    startWeek: index + 1,
  })),
  expenses: WEEK_FLOWS.map((week, index) => ({
    amount: String(week.out),
    frequency: "once-off",
    startWeek: index + 1,
  })),
};

function assertSample(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Harbour Glass sample: ${message}`);
}

const closingsOrNull = closingBalancesFromCashflow(HARBOUR_CASHFLOW);
if (!closingsOrNull || closingsOrNull.length !== 13) {
  throw new Error("Harbour Glass sample: 13-week closings missing");
}
const closings: number[] = closingsOrNull;

const lowIndex = closings.reduce(
  (best, value, index, all) => (value < all[best] ? index : best),
  0,
);

export const HARBOUR_BOOKS = {
  revenue: SEPTEMBER_REVENUE,
  augustMargin: AUGUST_MARGIN,
  septemberMargin: SEPTEMBER_MARGIN,
  marginPoints: AUGUST_MARGIN - SEPTEMBER_MARGIN,
  grossProfit: Math.round((SEPTEMBER_REVENUE * SEPTEMBER_MARGIN) / 100),
  debtors: DEBTORS_TOTAL,
  debtorDays: Math.round((DEBTORS_TOTAL / SEPTEMBER_REVENUE) * 30),
  overdue: ATLANTIC + VA_JOINERY,
  atlantic: ATLANTIC,
  vaJoinery: VA_JOINERY,
  openingCash: OPENING_CASH,
  floor: CASH_FLOOR,
  health: HEALTH_SCORE,
  healthBand: healthBandLabel(scoreTier(HEALTH_SCORE)),
  closings,
  lowWeek: lowIndex + 1,
  lowClosing: closings[lowIndex],
  lowWeekOf: HARBOUR_WEEK_OF[lowIndex],
  atlanticWeekOf: HARBOUR_WEEK_OF[5],
  underFloor: CASH_FLOOR - closings[lowIndex],
} as const;

assertSample(HARBOUR_BOOKS.marginPoints === 3, "margin points drifted");
assertSample(HARBOUR_BOOKS.debtorDays === 40, "debtor days drifted");
assertSample(HARBOUR_BOOKS.lowWeek === 8, "low week drifted");
assertSample(HARBOUR_BOOKS.lowClosing === 610_000, "low point drifted");
assertSample(HARBOUR_BOOKS.underFloor === 110_000, "floor gap drifted");
assertSample(HARBOUR_BOOKS.overdue === 2_140_000, "overdue drifted");
assertSample(
  HARBOUR_BOOKS.closings.filter((value) => value < CASH_FLOOR).length === 1,
  "more than one week sits under the floor",
);
assertSample(WEEK_FLOWS[2].inn === VA_JOINERY, "V&A receipt is not in week 3");
assertSample(WEEK_FLOWS[5].inn === ATLANTIC, "Atlantic receipt is not in week 6");

export const BOOKS_LINE = `Reads the books in ${HARBOUR.books}. Not the bank.`;
export const FORWARD_LINE = "Only this 13-week line looks forward.";

export interface OwnerPresenceCard {
  bot: OwnerBotKey;
  presence: OwnerPresence;
  sentence: string;
}

export const OWNER_PRESENCES: readonly OwnerPresenceCard[] = [
  {
    bot: "financial_manager",
    presence: "waiting",
    sentence: "Waiting on the Atlantic Fit-out call.",
  },
  {
    bot: "analyst",
    presence: "found",
    sentence: "September made less than August.",
  },
  {
    bot: "advisor",
    presence: "working",
    sentence: "Two moves are ready to read.",
  },
];

export interface OwnerFeedItem {
  id: string;
  at: string;
  agent: OwnerBotKey;
  kind: TeamActivityKind;
  text: string;
}

const firm = HARBOUR_ACCOUNTANT.firm;
const advisor = OWNER_TEAM.advisor.voice;
const manager = OWNER_TEAM.financial_manager.voice;

export const OWNER_FEED: readonly OwnerFeedItem[] = [
  {
    id: "wait",
    at: "2026-10-10T07:42:00.000Z",
    agent: "financial_manager",
    kind: "query",
    text: `${manager} is waiting on you to assign the Atlantic Fit-out call.`,
  },
  {
    id: "atlantic-hand",
    at: "2026-10-10T07:28:00.000Z",
    agent: "advisor",
    kind: "proposal",
    text: ownerHandoff(
      "advisor",
      manager,
      `Atlantic Fit-out (${zar(HARBOUR_BOOKS.atlantic)}) assumed on 16 Nov.`,
    ),
  },
  {
    id: "margin-hand",
    at: "2026-10-10T07:12:00.000Z",
    agent: "analyst",
    kind: "proposal",
    text: ownerHandoff("analyst", advisor, "margin dip; drafting 2 moves."),
  },
  {
    id: "margin-check",
    at: "2026-10-10T07:04:00.000Z",
    agent: "analyst",
    kind: "diagnosis",
    text: `${OWNER_TEAM.analyst.voice} checked September: margin down ${HARBOUR_BOOKS.marginPoints} points.`,
  },
  {
    id: "debtors",
    at: "2026-10-10T06:55:00.000Z",
    agent: "analyst",
    kind: "diagnosis",
    text: `${OWNER_TEAM.analyst.voice} read debtors on the books: ${zar(HARBOUR_BOOKS.debtors)}, ${HARBOUR_BOOKS.debtorDays} days, ${zar(HARBOUR_BOOKS.overdue)} overdue.`,
  },
  {
    id: "forecast",
    at: "2026-10-10T06:40:00.000Z",
    agent: "financial_manager",
    kind: "diagnosis",
    text: `${manager} checked the 13-week line: low point ${zar(HARBOUR_BOOKS.lowClosing)} in the week of 30 Nov, ${zar(HARBOUR_BOOKS.underFloor)} under the ${zar(HARBOUR_BOOKS.floor)} floor.`,
  },
  {
    id: "books",
    at: "2026-10-10T06:22:00.000Z",
    agent: "financial_manager",
    kind: "sync",
    text: `${manager} read the books to ${HARBOUR.asOfLabel}: cash on the books is ${zar(HARBOUR_BOOKS.openingCash)}.`,
  },
  {
    id: "signed",
    at: "2026-10-08T14:10:00.000Z",
    agent: "financial_manager",
    kind: "signoff",
    text: `${HARBOUR_ACCOUNTANT.name} signed the September pack.`,
  },
  {
    id: "pack-hand",
    at: "2026-10-08T09:05:00.000Z",
    agent: "financial_manager",
    kind: "data_request",
    text: ownerHandoff("financial_manager", firm, "September pack ready for sign-off."),
  },
];

export type ActionStatus = "needs_you" | "in_progress" | "with_them";

export interface OwnerAction {
  id: string;
  title: string;
  detail: string;
  raisedBy: OwnerBotKey;
  assignee: StaffId | null;
  suggested: StaffId | null;
  status: ActionStatus;
  due: string;
  jobStatus: TeamJobStatus;
}

export const OWNER_ACTIONS: readonly OwnerAction[] = [
  {
    id: "atlantic",
    title: `Confirm Atlantic Fit-out will pay ${zar(HARBOUR_BOOKS.atlantic)} by 16 November`,
    detail: `The 13-week forecast already reaches ${zar(HARBOUR_BOOKS.lowClosing)} in the week of 30 November, ${zar(HARBOUR_BOOKS.underFloor)} under the ${zar(HARBOUR_BOOKS.floor)} floor, and that still assumes this receipt.`,
    raisedBy: "advisor",
    assignee: null,
    suggested: "johan",
    status: "needs_you",
    due: "2026-10-17",
    jobStatus: "proposed",
  },
  {
    id: "margin",
    title: "Walk the float line on cullet and energy",
    detail: `Gross margin moved from ${HARBOUR_BOOKS.augustMargin}% to ${HARBOUR_BOOKS.septemberMargin}%.`,
    raisedBy: "analyst",
    assignee: "amina",
    suggested: null,
    status: "in_progress",
    due: "2026-10-24",
    jobStatus: "drafting",
  },
  {
    id: "floor",
    title: "Hold a supplier payment if the week of 30 November is still under the floor",
    detail: `The floor is ${zar(HARBOUR_BOOKS.floor)}. The low point on this forecast is ${zar(HARBOUR_BOOKS.lowClosing)}.`,
    raisedBy: "financial_manager",
    assignee: "lerato",
    suggested: null,
    status: "with_them",
    due: "2026-11-21",
    jobStatus: "draft_ready",
  },
  {
    id: "notes",
    title: "Send the September glass delivery notes",
    detail: `${firm} asked for them, so the cullet cost can be checked against the books.`,
    raisedBy: "financial_manager",
    assignee: "sipho",
    suggested: null,
    status: "with_them",
    due: "2026-10-15",
    jobStatus: "awaiting_signoff",
  },
];

export const DO_THIS_NOW = {
  title: "Assign the Atlantic Fit-out call",
  sentence: `Ask Johan to confirm Atlantic pays ${zar(HARBOUR_BOOKS.atlantic)} by 16 Nov.`,
  support: OWNER_ACTIONS[0].detail,
  actionId: "atlantic",
  staffId: "johan" as StaffId,
} as const;

export const OWNER_CHAT = {
  bot: "financial_manager" as const,
  question: "Will we make payroll in November?",
  answer: `Not from the cash on the books. The week of 30 November closes at ${zar(HARBOUR_BOOKS.lowClosing)}, ${zar(HARBOUR_BOOKS.underFloor)} under your ${zar(HARBOUR_BOOKS.floor)} floor.`,
  source: "From the books, 13-week forecast",
  step: "Assign the Atlantic Fit-out call",
} as const;

/** What the mic drops into the composer. Nothing is sent until the owner says so. */
export const OWNER_TRANSCRIPT = OWNER_CHAT.question;

export const OWNER_PROMISES = [
  {
    id: "cash",
    heading: "Cash over the next 13 weeks",
    sentence: `Week of 30 Nov closes at ${zar(HARBOUR_BOOKS.lowClosing)}, ${zar(HARBOUR_BOOKS.underFloor)} under your ${zar(HARBOUR_BOOKS.floor)} floor.`,
    source: "From the books, 13-week forecast",
    step: "Ask Financial Manager",
    go: "bot",
    bot: "financial_manager",
    signed: false,
  },
  {
    id: "owes",
    heading: "Who owes you",
    sentence: `Customers owe ${zar(HARBOUR_BOOKS.debtors)}. ${zar(HARBOUR_BOOKS.overdue)} is overdue.`,
    source: "From the books, to 30 Sep",
    step: "Assign the Atlantic Fit-out call",
    go: "actions",
    bot: null,
    signed: false,
  },
  {
    id: "profit",
    heading: "Am I making money",
    sentence: `Yes. September gross profit was ${zar(HARBOUR_BOOKS.grossProfit)}, less than August.`,
    source: "From the books, September",
    step: "Ask Analyst",
    go: "bot",
    bot: "analyst",
    signed: false,
  },
  {
    id: "answer",
    heading: "What needs your answer",
    sentence: DO_THIS_NOW.sentence,
    source: "Raised by Advisor",
    step: "Assign to Johan",
    go: "actions",
    bot: null,
    signed: false,
  },
  {
    id: "signed",
    heading: "What your accountant signed",
    sentence: `${HARBOUR_ACCOUNTANT.name} signed the September pack on ${HARBOUR_ACCOUNTANT.signedOn}.`,
    source: HARBOUR_ACCOUNTANT.firm,
    step: "See what they signed",
    go: "deliverables",
    bot: null,
    signed: true,
  },
] as const;

export interface OwnerDeliverable {
  id: string;
  title: string;
  sentence: string;
  by: OwnerBotKey;
  signed: boolean;
  chip: string;
}

const signedLine = signoffStatusLine({
  kind: "signed",
  name: HARBOUR_ACCOUNTANT.name,
  date: HARBOUR_ACCOUNTANT.signedOn,
});

export const OWNER_SIGNOFF_LINE = signedLine;

export const OWNER_DELIVERABLES: readonly OwnerDeliverable[] = [
  {
    id: "diagnosis",
    title: "September diagnosis",
    sentence: `September's gross profit was ${zar(HARBOUR_BOOKS.grossProfit)}. You made money, and you made less than August.`,
    by: "analyst",
    signed: true,
    chip: `Books · ${HARBOUR.asOfLabel}`,
  },
  {
    id: "forecast",
    title: "13-week cash forecast",
    sentence: `Low point ${zar(HARBOUR_BOOKS.lowClosing)} in the week of 30 November, ${zar(HARBOUR_BOOKS.underFloor)} under the ${zar(HARBOUR_BOOKS.floor)} floor. Cash on the books at ${HARBOUR.asOfLabel} is ${zar(HARBOUR_BOOKS.openingCash)}.`,
    by: "financial_manager",
    signed: true,
    chip: "13-week forecast",
  },
  {
    id: "moves",
    title: "Two moves",
    sentence:
      "Confirm the Atlantic Fit-out receipt, and ask the workshop what changed in cullet and energy.",
    by: "advisor",
    signed: false,
    chip: "Advisory",
  },
];

/** Unsigned owner pack. The accountant has not signed it, so it is not "Signed off". */
export const MOVES_STATUS_LINE = OWNER_PACK.invite;

export interface OwnerUploadRequest {
  id: string;
  title: string;
  detail: string;
  fileName: string;
}

export const OWNER_UPLOADS: readonly OwnerUploadRequest[] = [
  {
    id: "delivery-notes",
    title: "September glass delivery notes",
    detail: `${firm} asked for these, to set the cullet cost next to the books.`,
    fileName: "september-glass-notes.pdf",
  },
  {
    id: "overtime",
    title: "Float-line overtime sheet",
    detail: "The week of 22 September. It sits with the wage line already in the books.",
    fileName: "float-line-overtime.pdf",
  },
];

export const ANALYST_FINDINGS = [
  {
    id: "health",
    label: "Health",
    value: String(HARBOUR_BOOKS.health),
    note: HARBOUR_BOOKS.healthBand,
  },
  {
    id: "margin",
    label: "Gross margin",
    value: `${HARBOUR_BOOKS.septemberMargin}%`,
    note: `August was ${HARBOUR_BOOKS.augustMargin}%`,
  },
  {
    id: "debtors",
    label: "Debtors",
    value: zar(HARBOUR_BOOKS.debtors),
    note: `${HARBOUR_BOOKS.debtorDays} days · ${zar(HARBOUR_BOOKS.overdue)} overdue`,
  },
] as const;

export function staffById(id: StaffId) {
  const person = HARBOUR_STAFF.find((row) => row.id === id);
  assertSample(person, "unknown staff");
  return person;
}
