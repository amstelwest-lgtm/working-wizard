/**
 * Financial Manager brief for client Home.
 * Amounts come from the current statement and the previous month on file.
 * A missing month or a missing amount stays empty. Nothing here is estimated.
 * The chase button opens the shared chase draft. This file does not write one.
 * The cash floor line is the same sentence as the owner home card: balance and
 * gap, worded as a floor alert so it does not fight the health Watch band.
 */
import type { ChaseDraftInput } from "./chase-draft.ts";
import { actionDisplayTitle } from "./strategic-moves.ts";
import { OPENING_BALANCE_MISSING } from "./cash-forecast-parity.ts";
import { cashFloorCopy, ownerCashStatusChip } from "./owner-answers.ts";
import { rewriteDraftMonthStamp } from "./statement-period.ts";
import type { MoneyMarket } from "./market/format.ts";

export type BriefMoneyField = {
  key: string;
  label: string;
};

export const BRIEF_MONEY_FIELDS: readonly BriefMoneyField[] = [
  { key: "revenue", label: "Revenue" },
  { key: "cash", label: "Cash" },
  { key: "netIncome", label: "Net profit" },
  { key: "receivables", label: "Receivables" },
  { key: "payables", label: "Payables" },
  { key: "fixedCosts", label: "Fixed costs" },
];

export type BriefSnapshot = {
  periodDate?: string | null;
  periodLabel?: string | null;
  financials?: Record<string, unknown> | null;
};

export type BriefMovement = {
  key: string;
  label: string;
  current: number;
  prior: number;
  delta: number;
};

export type BriefButton = "hand" | "chase" | "open";

export type BriefAction = {
  id: string;
  title: string;
  reason: string;
  button: BriefButton;
  /** Studio tab the Open button uses. Hand and chase stay on Home. */
  tab: "plan" | "cash" | "health" | "profit" | "budget" | "reports" | null;
};

export type BriefDraft = {
  id: string;
  title: string;
};

export type FinancialManagerBrief = {
  priorLabel: string | null;
  movements: BriefMovement[];
  movementEmpty: string | null;
  actions: BriefAction[];
  actionEmpty: string | null;
  drafts: BriefDraft[];
  draftEmpty: string | null;
  /** Shared chase draft. Null when there is no balance and no overdue action. */
  chase: ChaseDraftInput | null;
  /** Opening and floor, in the same words as the owner home. Null when either amount is missing. */
  cashFloorLine: string | null;
  /** Same chip as the owner Financial Manager card, including Watch. */
  cashFloorChip: string | null;
  /** Short Health cash line. Same reading as the chip, so the pillar matches this brief. */
  healthCue: string | null;
};

function numField(fin: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!fin) return null;
  const raw = fin[key];
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const value = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function daysBetween(later: string, earlier: string): number | null {
  const a = Date.parse(`${later}T00:00:00Z`);
  const b = Date.parse(`${earlier}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * The snapshot about a month before the current statement.
 * A year-ago snapshot is not labelled as last month.
 */
export function previousMonthSnapshot<T extends BriefSnapshot>(
  snapshots: readonly T[],
  current?: { periodEnd?: string | null; financials?: Record<string, unknown> | null } | null,
): T | null {
  const end =
    day(current?.periodEnd) ??
    day(typeof current?.financials?.periodEnd === "string" ? current.financials.periodEnd : null);
  if (!end) return null;
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const snapshot of snapshots) {
    const when = day(snapshot.periodDate);
    if (!when || when >= end) continue;
    const gap = daysBetween(end, when);
    if (gap == null || gap < 20 || gap > 45) continue;
    const distance = Math.abs(gap - 30);
    if (distance < bestDistance) {
      best = snapshot;
      bestDistance = distance;
    }
  }
  return best;
}

export function topMoneyMovements(
  current: Record<string, unknown> | null | undefined,
  prior: Record<string, unknown> | null | undefined,
  limit = 3,
): BriefMovement[] {
  const rows: BriefMovement[] = [];
  for (const field of BRIEF_MONEY_FIELDS) {
    const now = numField(current, field.key);
    const then = numField(prior, field.key);
    if (now == null || then == null) continue;
    const delta = now - then;
    if (Math.abs(delta) < 1) continue;
    rows.push({ key: field.key, label: field.label, current: now, prior: then, delta });
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label));
  return rows.slice(0, limit);
}

export function buildFinancialManagerBrief(input: {
  clientName: string;
  currentFinancials: Record<string, unknown> | null | undefined;
  currentPeriodEnd?: string | null;
  snapshots: readonly BriefSnapshot[];
  openActionTitle?: string | null;
  /** Open plan rows. When set, these are the same titles the hub and the card count. */
  openActionTitles?: readonly string[] | null;
  overdueActions?: number;
  cashDipWeek?: number | null;
  /** Opening cash and the 13-week floor. Both are required before the brief quotes them. */
  cashOpening?: number | null;
  cashFloor?: number | null;
  /** Week closings. The line quotes the low point when the forecast goes under the floor. */
  cashClosing?: readonly number[] | null;
  /** Market for the short Health line. The sentence still uses formatMoney. */
  market?: MoneyMarket;
  /** A blank opening is not R0 under the floor. */
  openingMissing?: boolean;
  /**
   * Cash pillar band. Watch or Healthy keeps the cash sentence off the floor.
   * Omit it and a dip under the floor still says so.
   */
  cashPillarStatus?: "healthy" | "at_risk" | "critical" | null;
  receivables?: number | null;
  drafts?: readonly BriefDraft[];
  draftsReady?: boolean;
  actionsReady?: boolean;
  formatMoney: (amount: number) => string;
}): FinancialManagerBrief {
  const prior = previousMonthSnapshot(input.snapshots, {
    periodEnd: input.currentPeriodEnd,
    financials: input.currentFinancials,
  });
  const priorLabel = prior?.periodLabel?.trim() || null;
  const movements = prior
    ? topMoneyMovements(input.currentFinancials, prior.financials)
    : [];
  const movementEmpty = prior
    ? movements.length
      ? null
      : `Nothing in the money figures moved since ${priorLabel ?? "last month"}.`
    : "No last-month figures are on file.";

  const actions: BriefAction[] = [];
  const overdue = input.overdueActions ?? 0;
  const titled = (
    input.openActionTitles != null
      ? input.openActionTitles
      : input.openActionTitle
        ? [input.openActionTitle]
        : []
  )
    .map((title) => actionDisplayTitle(title))
    .filter(Boolean);
  const openTitles = [...new Set(titled)];
  if (input.actionsReady !== false) {
    openTitles.forEach((title, index) => {
      actions.push({
        id: index === 0 ? "open-action" : `open-action-${index}`,
        title,
        reason: "Open item on the action plan.",
        button: "hand",
        tab: "plan",
      });
    });
  }
  const receivables =
    input.receivables != null && Number.isFinite(input.receivables) ? input.receivables : null;
  if (input.actionsReady !== false && ((receivables != null && receivables > 0) || overdue > 0)) {
    const reason =
      receivables != null && receivables > 0
        ? `${input.formatMoney(receivables)} outstanding on the statement.`
        : `${overdue} overdue on the action plan.`;
    actions.push({
      id: "chase",
      title: receivables != null && receivables > 0 ? "Chase the outstanding balance" : "Chase overdue work",
      reason,
      button: "chase",
      tab: null,
    });
  }
  const cashOpening = input.cashOpening;
  const cashFloor = input.cashFloor;
  const pillarAgrees =
    input.cashPillarStatus === "healthy" || input.cashPillarStatus === "at_risk";
  const floorCopy =
    !input.openingMissing &&
    cashOpening != null &&
    cashFloor != null &&
    Number.isFinite(cashOpening) &&
    Number.isFinite(cashFloor)
      ? cashFloorCopy({
          opening: cashOpening,
          floor: cashFloor,
          dipsBelowFloorWeek: input.cashDipWeek ?? null,
          closing: input.cashClosing,
          money: input.formatMoney,
          market: input.market,
        })
      : null;
  // Watch and Healthy keep the card sentence off the floor. The Health pillar
  // still uses this same floor reading, so its line is not cleared with the chip.
  const cashCopy = pillarAgrees ? null : floorCopy;
  const cashFloorLine = input.openingMissing
    ? `${OPENING_BALANCE_MISSING}.`
    : pillarAgrees && cashOpening != null && Number.isFinite(cashOpening)
      ? `Cash is ${input.formatMoney(cashOpening)}.`
      : (cashCopy?.sentence ?? null);
  const cashFloorChip =
    ownerCashStatusChip(input.cashPillarStatus, input.openingMissing ? null : (cashCopy?.chip ?? null))
      ?.word ?? null;
  if (
    input.actionsReady !== false &&
    !input.openingMissing &&
    !pillarAgrees &&
    input.cashDipWeek != null &&
    input.cashDipWeek > 0
  ) {
    actions.push({
      id: "cash-floor",
      title: `Cash goes under the floor in week ${input.cashDipWeek}`,
      reason: cashFloorLine ?? "From the 13-week forecast already on file.",
      button: "open",
      tab: "cash",
    });
  }

  const drafts = (input.drafts ?? []).flatMap((row) => {
    const title = row.title.trim();
    if (!row.id || !title) return [];
    return [{ id: row.id, title: rewriteDraftMonthStamp(title) }];
  });
  const chaseAction = actions.find((action) => action.button === "chase");
  const chase: ChaseDraftInput | null =
    input.actionsReady === false || !chaseAction
      ? null
      : {
          clientName: input.clientName,
          actions: [{ title: chaseAction.title, overdue: overdue > 0 }],
        };

  return {
    priorLabel,
    movements,
    movementEmpty,
    actions: actions.slice(0, 3),
    actionEmpty:
      input.actionsReady === false
        ? "Checking the action plan."
        : actions.length
          ? null
          : "Nothing to act on from the books on file.",
    drafts,
    draftEmpty:
      input.draftsReady === false
        ? "Checking drafts."
        : drafts.length
          ? null
          : "No draft is waiting for review.",
    chase,
    cashFloorLine,
    cashFloorChip,
    healthCue: input.openingMissing ? null : (floorCopy?.healthCue ?? null),
  };
}
