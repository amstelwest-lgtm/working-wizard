/**
 * One reading of the 13-week forecast for the cash tab, Overview, the PDF,
 * and the Bot. The maths stay in client-metrics. This module only decides
 * which point is the low, whether cash is under the floor, and the sentence
 * those surfaces share.
 */
import {
  forecastMinimumCash,
  RUNWAY_INSUFFICIENT_LABEL,
  RUNWAY_PROFITABLE_LABEL,
  storedOpeningIsMissing,
} from "./client-metrics.ts";

export const CASH_BELOW_FLOOR_STATUS = "Critical: cash below floor";
export const OPENING_BALANCE_MISSING = "Opening balance missing";
/** Status column when cash cannot be scored. Never "Healthy". */
export const NEEDS_DATA_OPENING = "Needs data: opening balance missing";

export { storedOpeningIsMissing };

export function canonicalForecastFloor(input: {
  configured?: number | null;
  weeklyOutflows?: Array<number | null | undefined> | null;
}): number {
  return forecastMinimumCash(input);
}

/**
 * Empty cash tab. No lines means there is nothing to chart. A zero opening
 * is not a trough under the floor — the lowest-point tile stays blank until
 * an opening balance is entered.
 */
export function cashEmptyPresentation(input: {
  opening: number;
  linesBlank: boolean;
}): { showChart: boolean; lowestBlank: boolean } {
  const hasOpening = Number.isFinite(input.opening) && input.opening !== 0;
  return {
    showChart: !input.linesBlank,
    lowestBlank: input.linesBlank && !hasOpening,
  };
}

/**
 * A P&L sketch is not a forecast the owner entered. The cash tab and the
 * 13-week PDF both use this gate. Derived weeks stay off both surfaces.
 */
export function forecastWeeksAreEntered(outlook: {
  source: string;
  estimateLabel?: string | null;
}): boolean {
  return outlook.source === "stored" && !outlook.estimateLabel;
}

export function forecastLineIsDerived(line: { id?: string | null; name?: string | null }): boolean {
  const id = typeof line.id === "string" ? line.id : "";
  const name = typeof line.name === "string" ? line.name : "";
  return id.startsWith("derived-") || /collections \(monthly/i.test(name) || /operating payments \(monthly/i.test(name);
}

/** True when this line is an amount the owner or accountant entered. */
export function forecastLineCountsAsEntered(
  line: {
    id?: string | null;
    name?: string | null;
    amount?: string | number | null;
  },
  opts?: { includeDerived?: boolean },
): boolean {
  if (!opts?.includeDerived && forecastLineIsDerived(line)) return false;
  const amount = typeof line.amount === "number" ? line.amount : parseFloat(String(line.amount ?? ""));
  return Number.isFinite(amount) && Math.abs(amount) >= 0.5;
}

export function forecastLinesBlank(
  lines: readonly { id?: string | null; name?: string | null; amount?: string | number | null }[],
  opts?: { includeDerived?: boolean },
): boolean {
  return lines.every((line) => !forecastLineCountsAsEntered(line, opts));
}

/**
 * Week column on the cash-forecast PDF. Prints `Week N` and nothing after it.
 * A trailing lint marker is not part of the label.
 */
export function cashForecastWeekRowLabel(periodLabel: string): string {
  const line = periodLabel.split("\n")[0] ?? "";
  const withoutMarker = line.replace(/\s*\/\/.*$/, "").trim();
  const week = /^Week\s+(\d+)$/i.exec(withoutMarker);
  return week ? `Week ${week[1]}` : withoutMarker;
}

export type EnteredForecastWeek = {
  period_label: string;
  opening_balance: number;
  total_receipts: number;
  total_payments: number;
  net_movement: number;
  closing_balance: number;
  scenario: "moderate";
  runway_weeks: number;
};

/**
 * Week rows for the 13-week PDF. Null when the cash tab has no entered line,
 * including a P&L run-rate sketch (weeks 1, 5 and 9).
 */
export function cashForecastWeeksFromOutlook(outlook: {
  source: string;
  estimateLabel?: string | null;
  opening: number;
  inflow: readonly number[];
  outflow: readonly number[];
  closing: readonly number[];
}): EnteredForecastWeek[] | null {
  if (!forecastWeeksAreEntered(outlook)) return null;
  const empty =
    outlook.opening === 0 &&
    outlook.inflow.every((n) => n === 0) &&
    outlook.outflow.every((n) => n === 0);
  if (empty) return null;
  return outlook.inflow.map((inflow, i) => {
    const receipts = Math.round(inflow);
    const payments = Math.round(outlook.outflow[i] ?? 0);
    const opening = i === 0 ? outlook.opening : outlook.closing[i - 1] ?? outlook.opening;
    const closing = outlook.closing[i] ?? opening;
    return {
      period_label: `Week ${i + 1}`,
      opening_balance: Math.round(opening),
      total_receipts: receipts,
      total_payments: payments,
      net_movement: receipts - payments,
      closing_balance: Math.round(closing),
      scenario: "moderate" as const,
      runway_weeks: 0,
    };
  });
}

/**
 * Chat quotes the same closings as the cash screen.
 * A P&L that looks cash generative does not hide a negative week or a week under the floor.
 */
export function forecastChatFacts(input: {
  closings: readonly number[];
  floor: number;
  plCashGenerative?: boolean;
}): {
  cashGenerative: boolean;
  negativeWeeks: number;
  weeksBelowFloor: number;
  shortfall: boolean;
} {
  const negativeWeeks = input.closings.filter((value) => Number.isFinite(value) && value < 0).length;
  const weeksBelowFloor =
    Number.isFinite(input.floor)
      ? input.closings.filter((value) => Number.isFinite(value) && value < input.floor).length
      : 0;
  const dipped = negativeWeeks > 0 || weeksBelowFloor > 0;
  return {
    cashGenerative: input.plCashGenerative === true && !dipped,
    negativeWeeks,
    weeksBelowFloor,
    shortfall: dipped,
  };
}

/** 1-based index of the first closing strictly below `threshold`. */
export function firstClosingBelow(closings: readonly number[], threshold: number): number | null {
  for (let i = 0; i < closings.length; i++) {
    const raw = closings[i];
    if (typeof raw === "number" && Number.isFinite(raw) && raw < threshold) return i + 1;
  }
  return null;
}

export function forecastLowestPoint(
  opening: number,
  closings: readonly number[],
): { amount: number; week: number; isOpening: boolean } {
  let amount = Number.isFinite(opening) ? opening : Number.POSITIVE_INFINITY;
  let week = 0;
  let isOpening = true;
  closings.forEach((raw, i) => {
    if (!Number.isFinite(raw)) return;
    if (raw < amount) {
      amount = raw;
      week = i + 1;
      isOpening = false;
    }
  });
  if (!Number.isFinite(amount)) return { amount: 0, week: 0, isOpening: true };
  return { amount, week, isOpening };
}

/**
 * Opening at zero plus only dust flows (the floor then collapses to a few
 * rand, such as R69) is a placeholder, not a forecast. A real burn from a
 * zero opening is larger than this and still counts.
 */
const NEAR_EMPTY_FLOW = 1_000;

export function forecastIsNearEmptyPlaceholder(input: {
  opening: number;
  totalInflow?: number | null;
  totalOutflow?: number | null;
}): boolean {
  const openingEmpty = !Number.isFinite(input.opening) || Math.abs(input.opening) < 0.5;
  if (!openingEmpty) return false;
  const flow = Math.abs(input.totalInflow ?? 0) + Math.abs(input.totalOutflow ?? 0);
  return flow < NEAR_EMPTY_FLOW;
}

/**
 * A stored series, or a derived series with operating outflows, is a forecast.
 * A derived sketch with no costs uses the R50,000 fallback floor. Thirteen
 * zeros under that line are not a forecast.
 */
export function forecastHasCashEvidence(input: {
  source?: "stored" | "derived" | null;
  opening: number;
  totalInflow?: number | null;
  totalOutflow?: number | null;
}): boolean {
  if (forecastIsNearEmptyPlaceholder(input)) return false;
  const openingSet = Number.isFinite(input.opening) && Math.abs(input.opening) >= 0.5;
  const inflow = (input.totalInflow ?? 0) > 0.5;
  const outflow = (input.totalOutflow ?? 0) > 0.5;
  if (input.source === "stored") return openingSet || inflow || outflow;
  return outflow;
}

/** Total column for Opening cash. Week 1's opening, not the last week's. */
export function forecastOpeningColumnTotal(openings: readonly number[], fallback = 0): number {
  if (!openings.length) return fallback;
  const first = openings[0];
  return Number.isFinite(first) ? first! : fallback;
}

/**
 * Same Critical check as the Financial Manager card: opening under the floor,
 * or any closing under it.
 */
export function cashOutlookIsCritical(input: {
  opening: number;
  floor: number;
  dipsBelowFloorWeek?: number | null;
  /** Blank or zero opening with no source. Not a real balance under the floor. */
  openingMissing?: boolean;
  /** False when the cash balance was not read. Not a balance under the floor. */
  cashOnFile?: boolean;
} | null | undefined): boolean {
  if (!input || input.openingMissing || input.cashOnFile === false) return false;
  if (!Number.isFinite(input.opening) || !Number.isFinite(input.floor)) return false;
  return input.opening < input.floor || input.dipsBelowFloorWeek != null;
}

/**
 * Clients-table runway. No forecast evidence, and an unscored derived sketch,
 * stay blank. A real series uses the shared floor headline.
 */
export function clientListRunwayHeadline(input: {
  source?: "stored" | "derived" | null;
  opening: number;
  closings: readonly number[];
  floor: number;
  totalInflow?: number | null;
  totalOutflow?: number | null;
  runwayLabel?: string | null;
  cashGenerative?: boolean;
  /** Null when the row has no health score. */
  healthOverall?: number | null;
  /** Blank or zero opening with no source. Not a dip under the floor. */
  openingMissing?: boolean;
}): string {
  if (input.openingMissing) return OPENING_BALANCE_MISSING;
  const unscoredSketch = input.source !== "stored" && input.healthOverall == null;
  if (
    unscoredSketch ||
    !forecastHasCashEvidence(input) ||
    input.closings.length === 0
  ) {
    return "—";
  }
  if (firstClosingBelow(input.closings, 0) === 1) return "Below zero now";
  const later = firstClosingBelow(input.closings, 0);
  if (later != null && later > 1) return `Below zero in week ${later}`;
  return forecastRunwayHeadlineShared({
    opening: input.opening,
    closings: input.closings,
    floor: input.floor,
    runwayLabel: input.runwayLabel,
    cashGenerative: input.cashGenerative,
    openingMissing: input.openingMissing,
  }).headline;
}

/**
 * Clients-table cell. A counted runway is weeks. Anything else is an em dash,
 * with the existing headline kept for the tooltip only.
 */
export function clientListRunwayCell(input: {
  weeks: number | null;
  reason: string | null;
}): { value: string; title?: string } {
  const reason = input.reason?.trim() ?? "";
  if (reason === OPENING_BALANCE_MISSING) {
    return { value: "—", title: OPENING_BALANCE_MISSING };
  }
  if (/^below zero now$/i.test(reason)) return { value: "Below zero now", title: reason };
  const laterZero = reason.match(/^below zero in week (\d+)$/i);
  if (laterZero) return { value: reason, title: reason };
  const below = reason.match(/^(\d+) weeks? below$/i);
  if (below) {
    const weeks = Number(below[1]);
    return { value: weeks === 1 ? "1 week" : `${weeks} weeks` };
  }
  if (input.weeks != null && Number.isFinite(input.weeks)) {
    const weeks = Number.isInteger(input.weeks) ? input.weeks : Math.round(input.weeks);
    return { value: weeks === 1 ? "1 week" : `${weeks} weeks` };
  }
  if (reason && reason !== "—") return { value: "—", title: reason };
  return { value: "—" };
}

/**
 * Clients-table status. Cash under the floor uses the Financial Manager word.
 * An unscored row stays blank, including when the empty series sits under the
 * fallback floor.
 */
export function clientListStatusWord(input: {
  healthLabel: string;
  healthOverall: number | null;
  source?: "stored" | "derived" | null;
  opening: number;
  floor: number;
  dipsBelowFloorWeek?: number | null;
  totalInflow?: number | null;
  totalOutflow?: number | null;
  openingMissing?: boolean;
  /** False when the cash balance was not read. The health label stands. */
  cashOnFile?: boolean;
}): string {
  if (input.openingMissing) return NEEDS_DATA_OPENING;
  if (input.cashOnFile === false) {
    if (input.healthOverall == null) return "—";
    return input.healthLabel;
  }
  if (input.healthOverall == null) return "—";
  if (forecastHasCashEvidence(input) && cashOutlookIsCritical(input)) return CASH_BELOW_FLOOR_STATUS;
  return input.healthLabel;
}

/** Clients-list status words that the practice Home attention count includes. */
export function statusColumnNeedsAttention(label: string): boolean {
  const text = label.trim();
  return text.length > 0 && text !== "—" && text !== "Healthy";
}

function stableCashValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCashValue);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = stableCashValue(src[key]);
    return out;
  }
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  return value;
}

function cashLineSnapshot(row: unknown): unknown {
  if (!row || typeof row !== "object") return null;
  const line = row as Record<string, unknown>;
  return {
    name: typeof line.name === "string" ? line.name : "",
    amount: line.amount ?? "",
    frequency: line.frequency ?? "",
    startWeek: line.startWeek ?? null,
    splitCount: line.splitCount ?? null,
    weekOverrides: line.weekOverrides ?? null,
  };
}

/**
 * Cash figures a sign-off can compare. Clocks, line ids, and the forecast
 * start date are not figures — an autosave that only moves those is not a change.
 */
export function cashForecastSnapshot(cashflow: unknown): unknown {
  if (!cashflow || typeof cashflow !== "object") return null;
  const cf = cashflow as Record<string, unknown>;
  const lines = (key: string) => (Array.isArray(cf[key]) ? cf[key].map(cashLineSnapshot) : []);
  return {
    openingBalance: cf.openingBalance ?? "",
    openingBalanceSource: cf.openingBalanceSource ?? null,
    forecastLinesSource: cf.forecastLinesSource ?? null,
    revAdj: cf.revAdj ?? null,
    expAdj: cf.expAdj ?? null,
    collectDelay: cf.collectDelay ?? null,
    revenue: lines("revenue"),
    expenses: lines("expenses"),
    other: lines("other"),
  };
}

/**
 * True when a signed cash snapshot and the forecast now on file differ.
 * A missing snapshot is not a change — the clock alone cannot say the figures moved.
 */
export function cashSignedFiguresChanged(signedSnapshot: unknown, cashflow: unknown): boolean {
  if (!cashflow || !signedSnapshot || typeof signedSnapshot !== "object") return false;
  const figures = (signedSnapshot as { cashFigures?: unknown }).cashFigures;
  if (figures == null || typeof figures !== "object") return false;
  return (
    JSON.stringify(stableCashValue(figures)) !==
    JSON.stringify(stableCashValue(cashForecastSnapshot(cashflow)))
  );
}

export function forecastFloorPosition(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
}): {
  opensBelow: boolean;
  firstDipWeek: number | null;
  weeksBelow: number;
  staysAbove: boolean;
} {
  const opensBelow = Number.isFinite(input.opening) && input.opening < input.floor;
  let firstDipWeek: number | null = null;
  let weeksBelow = 0;
  input.closings.forEach((raw, i) => {
    if (!Number.isFinite(raw)) return;
    if (raw < input.floor) {
      weeksBelow += 1;
      if (firstDipWeek == null) firstDipWeek = i + 1;
    }
  });
  return {
    opensBelow,
    firstDipWeek,
    weeksBelow,
    staysAbove: !opensBelow && firstDipWeek == null,
  };
}

/** Position clause shared by Overview and the cash tab. */
export function forecastPositionPhrase(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
}): string {
  const pos = forecastFloorPosition(input);
  if (pos.staysAbove) return "stays above floor";
  if (pos.opensBelow && pos.firstDipWeek == null) return "opens below floor";
  if (pos.opensBelow && pos.firstDipWeek != null) {
    return `opens below floor; dips below floor in week ${pos.firstDipWeek}`;
  }
  return `dips below floor in week ${pos.firstDipWeek}`;
}

/**
 * Runway tile. The value stays short ("No shortfall", "Cash generative",
 * "N weeks", "Below floor"). The long "add a cash-flow statement" sentence
 * is not the value, and it is not used once an opening is set and the
 * forecast never goes under the floor.
 * A floor dip does not replace that label with "weeks until the first dip".
 */
export function forecastRunwayHeadlineShared(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
  runwayLabel?: string | null;
  cashGenerative?: boolean;
  openingMissing?: boolean;
}): { headline: string; note: string } {
  if (input.openingMissing) return { headline: OPENING_BALANCE_MISSING, note: "opening balance missing" };
  const pos = forecastFloorPosition(input);
  if (!pos.staysAbove) {
    if (pos.firstDipWeek != null) {
      const n = pos.weeksBelow;
      const headline = n === 1 ? "1 week below" : `${n} weeks below`;
      const note = pos.opensBelow
        ? `opens below the floor; first closing dip week ${pos.firstDipWeek}`
        : `first dip week ${pos.firstDipWeek}`;
      return { headline, note };
    }
    return { headline: "Below floor", note: "opening is under the floor" };
  }
  if (input.cashGenerative) return { headline: "Cash generative", note: "above the floor" };
  const openingSet = Number.isFinite(input.opening) && input.opening !== 0;
  const label = input.runwayLabel?.trim() ?? "";
  const asksForData =
    !label ||
    label === "—" ||
    label === RUNWAY_PROFITABLE_LABEL ||
    label === RUNWAY_INSUFFICIENT_LABEL;
  if (openingSet && asksForData) return { headline: "No shortfall", note: "above the floor" };
  if (label === RUNWAY_PROFITABLE_LABEL) {
    return { headline: "Profitable", note: "Add a cash-flow statement or bank balance" };
  }
  if (label && label !== "—") return { headline: label, note: "above the floor" };
  const horizon = input.closings.length > 0 ? input.closings.length : 13;
  return { headline: `${horizon}+ wks`, note: "above the floor" };
}

function finiteCashAmount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  return value;
}

/**
 * Overview Cash tile. "No shortfall" keeps a real figure when one exists
 * (lowest closing, otherwise the opening). A missing forecast stays blank.
 */
export function overviewCashTileFigure(input: {
  headline?: string | null;
  opening?: number | null;
  lowest?: number | null;
  lowestIsOpening?: boolean;
  money: (n: number) => string;
}): string | null {
  const headline = input.headline?.trim() ?? "";
  const lowest = finiteCashAmount(input.lowest);
  const opening = finiteCashAmount(input.opening);
  const amount = input.lowestIsOpening ? (opening ?? lowest) : (lowest ?? opening);
  if (!headline && amount == null) return null;
  if (!headline) return input.money(amount as number);
  const bare =
    headline === "No shortfall" || headline === "Cash generative" || headline === "Profitable";
  if (!bare || amount == null) return headline;
  const kind = !input.lowestIsOpening && lowest != null ? "lowest" : "opening";
  return `${headline} · ${kind} ${input.money(amount)}`;
}

/**
 * Weeks-below readout shared by the cash PDF and the tab.
 * An opening under the floor is not "0 / none projected".
 */
export function forecastWeeksBelowReadout(pos: {
  opensBelow: boolean;
  firstDipWeek: number | null;
  weeksBelow: number;
  staysAbove: boolean;
}): { value: string; note: string; clear: boolean } {
  if (pos.staysAbove) return { value: "0", note: "none projected", clear: true };
  if (pos.weeksBelow > 0) return { value: String(pos.weeksBelow), note: "action required", clear: false };
  return { value: "Below floor", note: "opening is under the floor", clear: false };
}

/**
 * The sentence under the cash-tab tiles. The pack uses the same words so a
 * regenerated forecast cannot disagree with the screen.
 */
export function forecastStatusSentence(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
  floorText: string;
  runwayLabel?: string | null;
  cashGenerative?: boolean;
  openingMissing?: boolean;
  /** When set, a closing under zero replaces the floor wording. */
  formatAmount?: (amount: number) => string;
}): string {
  if (input.openingMissing) return OPENING_BALANCE_MISSING;
  if (input.formatAmount) {
    const week = firstClosingBelow(input.closings, 0);
    if (week != null) {
      const low = forecastLowestPoint(Number.POSITIVE_INFINITY, input.closings);
      const lowWeek = low.week > 0 ? low.week : week;
      return `Cash is below zero from week ${week} — lowest ${input.formatAmount(low.amount)} in week ${lowWeek}`;
    }
  }
  const story = forecastRunwayHeadlineShared(input);
  const weeks = input.closings.length > 0 ? input.closings.length : 13;
  if (story.note === "above the floor") {
    return `Cash stays above the ${input.floorText} floor across these ${weeks} weeks.`;
  }
  const phrase = forecastPositionPhrase(input);
  return `Cash ${phrase} (floor ${input.floorText}). ${story.headline} — action needed.`;
}

export type OpeningSourceChip = "Statement" | "Bank" | "Sync" | "Manual" | "Estimate";

/** Chip for the opening field. Unknown sources stay blank rather than guessed. */
export function openingSourceLabel(
  cf: Record<string, unknown> | null | undefined,
): OpeningSourceChip | null {
  if (!cf) return null;
  const lines = typeof cf.forecastLinesSource === "string" ? cf.forecastLinesSource : "";
  const opening = typeof cf.openingBalanceSource === "string" ? cf.openingBalanceSource : "";
  if (lines === "pl-estimate") return "Estimate";
  if (typeof cf.seededFromBanksAt === "string" && cf.seededFromBanksAt.length > 0) return "Bank";
  if (
    opening === "xero" ||
    opening === "qbo" ||
    lines === "xero-bank-summary" ||
    lines === "qbo-bank-activity"
  ) {
    return "Sync";
  }
  if (opening === "statement") return "Statement";
  if (opening === "manual" || opening === "accountant") return "Manual";
  return null;
}

/**
 * Chip for the forecast lines, when the stored source is known.
 * Untagged lines stay blank — a missing source is not "Manual".
 */
export function forecastLinesSourceLabel(
  cf: Record<string, unknown> | null | undefined,
): OpeningSourceChip | null {
  if (!cf) return null;
  const lines = typeof cf.forecastLinesSource === "string" ? cf.forecastLinesSource : "";
  if (lines === "pl-estimate") return "Estimate";
  if (lines === "xero-bank-summary" || lines === "qbo-bank-activity") return "Sync";
  if (typeof cf.seededFromBanksAt === "string" && cf.seededFromBanksAt.length > 0) return "Bank";
  if (lines === "statement") return "Statement";
  if (lines === "manual" || lines === "accountant") return "Manual";
  return null;
}
