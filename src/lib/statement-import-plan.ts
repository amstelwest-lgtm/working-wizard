/**
 * A statement import may not silently replace a different period, and a
 * P&L with no balance sheet may not rescore the sheet.
 */
import type { DateMarket } from "./market/format.ts";
import { formatCalendarDay, formatDateRange } from "./market/format.ts";
import { isBlankExtracted, mergeStatementFinancials, type StatementKind } from "./statement-parse.ts";
import { defaultPeriodCoverage } from "./statement-period.ts";

export const SHEET_PILLARS_HELD_KEY = "sheetPillarsHeld";

export const BALANCE_SHEET_NEXT_ACTION = "Upload a balance sheet to keep cash current.";

/** Shown on the upload panels and at the end of the unreadable-period block. */
export const SET_PERIOD_DATES = "Set the start and end dates before importing.";

export type PeriodChoice = "replace_ytd" | "add_period";

export type StatementSpan = {
  periodStart: string;
  periodEnd: string;
  months: number;
};

export type HeldPillarScore = {
  score: number | null;
  status: "healthy" | "at_risk" | "critical";
};

export type SheetPillarsHeld = {
  cash: HeldPillarScore;
  assets: HeldPillarScore;
  financing: HeldPillarScore;
  asOf: string | null;
};

export type HealthPillarSnapshot = {
  id: string;
  score: number | null;
  status: "healthy" | "at_risk" | "critical";
};

/** Income lines a later P&L must replace outright. A blank does not keep the previous period. */
const INCOME_PERIOD_KEYS = [
  "revenue",
  "cogs",
  "grossProfit",
  "ebit",
  "ebitda",
  "ebt",
  "netIncome",
  "interestExpense",
  "tax",
  "depreciation",
  "laborCost",
  "fixedCosts",
  "variableCosts",
  "top5Revenue",
  "operatingCashflow",
] as const;

const SHEET_KEYS = [
  "cash",
  "totalAssets",
  "receivables",
  "inventory",
  "payables",
  "equity",
  "currentAssets",
  "currentLiabilities",
  "totalLiabilities",
] as const;

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function monthsBetween(start: string, end: string): number | null {
  const covered = defaultPeriodCoverage({ periodStart: start, periodEnd: end });
  return covered.periodStart ? covered.months : null;
}

export function statementSpan(start: unknown, end: unknown, months?: number | null): StatementSpan | null {
  const from = iso(start);
  const to = iso(end);
  if (!from || !to || to < from) return null;
  const counted = monthsBetween(from, to);
  if (counted == null) return null;
  const explicit =
    months != null && Number.isFinite(months) && months >= 1 ? Math.round(months) : counted;
  return { periodStart: from, periodEnd: to, months: explicit };
}

export function liveStatementSpan(financials: object | null | undefined): StatementSpan | null {
  if (!financials || typeof financials !== "object") return null;
  const row = financials as Record<string, unknown>;
  return statementSpan(row.periodStart, row.periodEnd);
}

export function spansMatch(left: StatementSpan | null, right: StatementSpan | null): boolean {
  if (!left || !right) return false;
  return left.periodStart === right.periodStart && left.periodEnd === right.periodEnd;
}

/** Calendar quarter named Q1–Q4 when the span is that quarter. */
export function quarterTag(span: StatementSpan): "Q1" | "Q2" | "Q3" | "Q4" | null {
  if (span.months !== 3) return null;
  const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(span.periodStart);
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(span.periodEnd);
  if (!start || !end || start[1] !== end[1] || start[3] !== "01") return null;
  const startMonth = Number(start[2]);
  const endMonth = Number(end[2]);
  if (endMonth !== startMonth + 2) return null;
  const last = new Date(Date.UTC(Number(end[1]), endMonth, 0)).getUTCDate();
  if (Number(end[3]) !== last) return null;
  if (startMonth === 1) return "Q1";
  if (startMonth === 4) return "Q2";
  if (startMonth === 7) return "Q3";
  if (startMonth === 10) return "Q4";
  return null;
}

export function spanLabel(span: StatementSpan, market: DateMarket): string {
  const label = formatDateRange(span.periodStart, span.periodEnd, market);
  return label === "—" ? `${span.periodStart}/${span.periodEnd}` : label;
}

function monthPhrase(span: StatementSpan): string {
  return span.months === 1 ? "1 month" : `${span.months} months`;
}

export function hasSheetPosition(financials: object | null | undefined): boolean {
  if (!financials || typeof financials !== "object") return false;
  const row = financials as Record<string, unknown>;
  return SHEET_KEYS.some((key) => {
    const value = row[key];
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return value.trim() !== "";
    return false;
  });
}

export function sheetPillarsFromHealth(
  pillars: readonly HealthPillarSnapshot[],
  asOf: string | null,
): SheetPillarsHeld {
  const pick = (id: string): HeldPillarScore => {
    const row = pillars.find((pillar) => pillar.id === id);
    return {
      score: row && row.score != null && Number.isFinite(row.score) ? Math.round(row.score) : null,
      status: row?.status === "healthy" || row?.status === "critical" ? row.status : "at_risk",
    };
  };
  return {
    cash: pick("cash"),
    assets: pick("assets"),
    financing: pick("financing"),
    asOf,
  };
}

export function encodeSheetPillarsHeld(held: SheetPillarsHeld): string {
  return JSON.stringify(held);
}

export function readSheetPillarsHeld(financials: object | null | undefined): SheetPillarsHeld | null {
  if (!financials || typeof financials !== "object") return null;
  const raw = (financials as Record<string, unknown>)[SHEET_PILLARS_HELD_KEY];
  const parsed =
    typeof raw === "string"
      ? safeJson(raw)
      : raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : null;
  if (!parsed) return null;
  const pillar = (value: unknown): HeldPillarScore | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const score =
      typeof row.score === "number" && Number.isFinite(row.score) ? Math.round(row.score) : null;
    const status =
      row.status === "healthy" || row.status === "critical" || row.status === "at_risk"
        ? row.status
        : null;
    if (!status) return null;
    return { score, status };
  };
  const cash = pillar(parsed.cash);
  const assets = pillar(parsed.assets);
  const financing = pillar(parsed.financing);
  if (!cash || !assets || !financing) return null;
  return { cash, assets, financing, asOf: iso(parsed.asOf) };
}

function safeJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function earlierStatementNote(
  financials: object | null | undefined,
  market: DateMarket,
): string | null {
  const held = readSheetPillarsHeld(financials);
  if (!held) return null;
  const day = held.asOf ? formatCalendarDay(held.asOf, market) : "";
  if (!day || day === "—") return "from an earlier statement";
  return `as at ${day}, from earlier statement`;
}

export type ImportPlan = {
  action: "choose" | "live" | "history" | "block";
  message: string;
  replaceLabel: string;
  addLabel: string;
  /** Live books after a replace or a same-span apply. Null when nothing is written there. */
  live: Record<string, unknown> | null;
  /** Snapshot body when the file is stored as its own period. */
  history: Record<string, unknown> | null;
  periodLabel: string | null;
};

/**
 * Dates the confirm may stamp onto the books.
 * A file with no readable span does not borrow a financial-year expansion
 * once the books already have their own span. That expansion is only for a
 * first import.
 */
export function liveCoverageForImport(input: {
  existing: object | null | undefined;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodMonths?: number | null;
  fyStartMonth?: number | null;
  preClose?: boolean;
}): {
  span: StatementSpan | null;
  months: number | null;
  periodStart: string | null;
  periodEnd: string;
} {
  const span = statementSpan(input.periodStart, input.periodEnd, input.periodMonths);
  const periodEnd = span?.periodEnd ?? (input.periodEnd?.trim() || "");
  if (span) {
    return { span, months: span.months, periodStart: span.periodStart, periodEnd: span.periodEnd };
  }
  if (liveStatementSpan(input.existing)) {
    return { span: null, months: null, periodStart: null, periodEnd };
  }
  const coverage = defaultPeriodCoverage({
    periodEnd: input.periodEnd,
    fyStartMonth: input.fyStartMonth,
    preClose: input.preClose,
  });
  return {
    span: null,
    months: coverage.months,
    periodStart: coverage.periodStart,
    periodEnd,
  };
}

function choiceCopy(
  live: StatementSpan,
  file: StatementSpan,
  market: DateMarket,
): { message: string; replaceLabel: string; addLabel: string } {
  const quarter = quarterTag(file);
  const addLabel = quarter ? `Add as ${quarter}` : "Add as its own period";
  const message = `This file covers ${spanLabel(file, market)} (${monthPhrase(file)}). The books show ${spanLabel(live, market)} (${monthPhrase(live)}). Replace the year-to-date figures, or ${quarter ? `add this as ${quarter}` : "add this as its own period"}?`;
  return { message, replaceLabel: "Replace year-to-date", addLabel };
}

function outcomeMessage(input: {
  mode: "updated" | "added";
  kind: StatementKind;
  periodLabel: string | null;
  missingBalanceSheet: boolean;
  earlierNote: string | null;
}): string {
  const period = input.periodLabel ? ` for ${input.periodLabel}` : "";
  const what =
    input.kind === "balance_sheet"
      ? "balance sheet"
      : input.kind === "mixed"
        ? "income statement and balance sheet"
        : input.kind === "income_statement"
          ? "income statement"
          : "statement";
  const lead =
    input.mode === "added"
      ? `Added ${input.periodLabel ?? "this period"} as its own period. Year-to-date books are unchanged.`
      : `Imported, ${what} updated${period}.`;
  if (!input.missingBalanceSheet) return lead;
  const kept = input.earlierNote ? ` Cash stays ${input.earlierNote}.` : "";
  return `${lead} Balance sheet was not in the file.${kept} ${BALANCE_SHEET_NEXT_ACTION}`;
}

function withSpan(fields: Record<string, unknown>, span: StatementSpan | null): Record<string, unknown> {
  if (!span) return fields;
  return {
    ...fields,
    periodStart: span.periodStart,
    periodEnd: span.periodEnd,
    periodMonths: String(span.months),
  };
}

/**
 * A balance sheet must not replace the income statement's window.
 * When the books already have a span, the as-of date is not written onto it.
 * When they do not, only the as-of end is stored. No start and no month count.
 */
function balanceSheetIncoming(
  incoming: Record<string, unknown>,
  liveSpan: StatementSpan | null,
  fileSpan: StatementSpan | null,
): Record<string, unknown> {
  const next = { ...incoming };
  delete next.periodStart;
  delete next.periodMonths;
  if (liveSpan) {
    delete next.periodEnd;
    return next;
  }
  const asOf = iso(next.periodEnd) ?? fileSpan?.periodEnd ?? null;
  if (asOf) next.periodEnd = asOf;
  else delete next.periodEnd;
  return next;
}

export type ConfirmedStatement = ImportPlan & {
  span: StatementSpan | null;
  /** Figures the confirm may merge, with only the period it is allowed to stamp. */
  stamped: Record<string, unknown>;
};

/**
 * One confirm for the accountant page, the owner review, and the ratios panel.
 * A balance sheet skips the range block. Every other kind uses the same
 * coverage rule: financial-year expansion only when the books have no span.
 */
export function confirmUploadedStatement(input: {
  existing: object | null | undefined;
  incoming: Record<string, unknown>;
  kind: StatementKind;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodMonths?: number | null;
  choice?: PeriodChoice | null;
  market: DateMarket;
  fyStartMonth?: number | null;
  preClose?: boolean;
  pillarsBefore?: readonly HealthPillarSnapshot[] | null;
}): ConfirmedStatement {
  if (input.kind === "balance_sheet") {
    const asOf = iso(input.periodEnd) ?? iso(input.incoming.periodEnd);
    const incoming = balanceSheetIncoming(
      asOf ? { ...input.incoming, periodEnd: asOf } : input.incoming,
      liveStatementSpan(input.existing),
      null,
    );
    const planned = planStatementImport({
      existing: input.existing,
      incoming,
      kind: "balance_sheet",
      span: null,
      choice: null,
      pillarsBefore: input.pillarsBefore,
      market: input.market,
    });
    return { ...planned, span: null, stamped: incoming };
  }
  const covered = liveCoverageForImport({
    existing: input.existing,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    periodMonths: input.periodMonths,
    fyStartMonth: input.fyStartMonth,
    preClose: input.preClose,
  });
  const incoming = {
    ...input.incoming,
    ...(covered.months != null ? { periodMonths: String(covered.months) } : {}),
    ...(covered.periodEnd ? { periodEnd: covered.periodEnd } : {}),
    ...(covered.periodStart ? { periodStart: covered.periodStart } : {}),
  };
  const planned = planStatementImport({
    existing: input.existing,
    incoming,
    kind: input.kind,
    span: covered.span,
    choice: input.choice ?? null,
    pillarsBefore: input.pillarsBefore,
    market: input.market,
  });
  return { ...planned, span: covered.span, stamped: incoming };
}

/** Forwards the replace / add choice. A 3-argument adapter drops it and the question loops. */
export function passStatementChoice<A, B, C, R>(
  confirm: (result: A, prefs: B, period: C, choice?: PeriodChoice | null) => R,
): (result: A, prefs: B, period: C, choice?: PeriodChoice | null) => R {
  return (result, prefs, period, choice) => confirm(result, prefs, period, choice ?? null);
}

/**
 * Decide what a confirm is allowed to write.
 * `choice` is null until the person picks replace or add.
 */
export function planStatementImport(input: {
  existing: object | null | undefined;
  incoming: Record<string, unknown>;
  kind: StatementKind;
  span: StatementSpan | null;
  choice?: PeriodChoice | null;
  pillarsBefore?: readonly HealthPillarSnapshot[] | null;
  market: DateMarket;
}): ImportPlan {
  const existing = (input.existing ?? {}) as Record<string, unknown>;
  const liveSpan = liveStatementSpan(existing);
  const fileSpan = input.span;
  const pointInTime = input.kind === "balance_sheet";
  const quarter = fileSpan ? quarterTag(fileSpan) : null;
  const replaceLabel = "Replace year-to-date";
  const addLabel = quarter ? `Add as ${quarter}` : "Add as its own period";
  const periodLabel = fileSpan ? spanLabel(fileSpan, input.market) : null;
  const mismatch = Boolean(liveSpan && fileSpan && !spansMatch(liveSpan, fileSpan));

  // A balance sheet is one date. Its as-of parse has no start, so the P&L
  // range guard must not treat that as an unreadable period.
  // An unreadable income file must not land on the books' span, and a chosen
  // replace does not invent that span from the financial year.
  if (!pointInTime && !fileSpan && liveSpan) {
    return {
      action: "block",
      message: `Couldn't read the period in this file. The books show ${spanLabel(liveSpan, input.market)}. ${SET_PERIOD_DATES}`,
      replaceLabel,
      addLabel,
      live: null,
      history: null,
      periodLabel: null,
    };
  }

  if (!pointInTime && mismatch && fileSpan && liveSpan && !input.choice) {
    const copy = choiceCopy(liveSpan, fileSpan, input.market);
    return {
      action: "choose",
      message: copy.message,
      replaceLabel: copy.replaceLabel,
      addLabel: copy.addLabel,
      live: null,
      history: null,
      periodLabel,
    };
  }

  const incoming = pointInTime
    ? balanceSheetIncoming(input.incoming, liveSpan, fileSpan)
    : withSpan(input.incoming, fileSpan);
  const missingBalanceSheet = input.kind === "income_statement";
  const keepSheet = missingBalanceSheet && hasSheetPosition(existing);

  // A balance sheet always updates the live position. It is not a quarter
  // that can be filed beside the year-to-date income statement.
  if (!pointInTime && input.choice === "add_period" && fileSpan) {
    const history = mergeStatementFinancials(null, incoming, input.kind);
    const note = keepSheet ? earlierStatementNote(stampHeld(existing, input.pillarsBefore), input.market) : null;
    return {
      action: "history",
      message: outcomeMessage({
        mode: "added",
        kind: input.kind,
        periodLabel,
        missingBalanceSheet,
        earlierNote: note,
      }),
      replaceLabel,
      addLabel,
      live: null,
      history,
      periodLabel,
    };
  }

  let live = mergeStatementFinancials(existing, incoming, input.kind);
  // A different span is a different statement. Lines it does not contain
  // are not the previous period's figures.
  if (input.choice === "replace_ytd" && mismatch && missingBalanceSheet) {
    for (const key of INCOME_PERIOD_KEYS) {
      if (isBlankExtracted(incoming[key])) live[key] = "";
    }
  }
  if (keepSheet && input.pillarsBefore) {
    const asOf = iso(existing.cashAsOf) ?? iso(existing.periodEnd);
    live = {
      ...live,
      [SHEET_PILLARS_HELD_KEY]: encodeSheetPillarsHeld(
        sheetPillarsFromHealth(input.pillarsBefore, asOf),
      ),
    };
  } else if (!missingBalanceSheet) {
    delete live[SHEET_PILLARS_HELD_KEY];
  }
  return {
    action: "live",
    message: outcomeMessage({
      mode: "updated",
      kind: input.kind,
      periodLabel,
      missingBalanceSheet,
      earlierNote: keepSheet ? earlierStatementNote(live, input.market) : null,
    }),
    replaceLabel,
    addLabel,
    live,
    history: null,
    periodLabel,
  };
}

function stampHeld(
  existing: Record<string, unknown>,
  pillars: readonly HealthPillarSnapshot[] | null | undefined,
): Record<string, unknown> {
  if (!pillars) return existing;
  const asOf = iso(existing.cashAsOf) ?? iso(existing.periodEnd);
  return {
    ...existing,
    [SHEET_PILLARS_HELD_KEY]: encodeSheetPillarsHeld(sheetPillarsFromHealth(pillars, asOf)),
  };
}

/** Prefer the snapshot that matches the live span when several share an end date. */
export function preferStatementSnapshot<T extends { financials?: unknown; period_date?: string | null }>(
  rows: readonly T[],
  live: object | null | undefined,
): T | null {
  if (!rows.length) return null;
  const liveSpan = liveStatementSpan(live);
  if (liveSpan) {
    const match = rows.find((row) => spansMatch(liveSpan, liveStatementSpan(row.financials as object)));
    if (match) return match;
  }
  return rows[0] ?? null;
}
