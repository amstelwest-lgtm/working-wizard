/**
 * Overview figures the accountant client page already shows.
 *
 * Health matches `computeOverallHealth` in src/lib/health-score.ts:
 * equal-weight average of rounded pillar scores, with cash runway blended
 * into the cash pillar. Ask AI must not read `client_score_history` for this
 * number — that row can lag the live financials.
 *
 * Ratio math and pillar scores match `computeRatios` / `computeOverallHealth`,
 * including the financial-year span Ratios uses for days.
 */

import { hasFinancialEvidence } from "../../../src/lib/client-metrics.ts";
import { parseOperatingProfile } from "../../../src/lib/client-profile.ts";
import {
  cashPillarFollowsForecast,
  computeOverallHealth,
  liveHealthFromBooks,
  scorecardHealthFromFinancials,
  type ScoreMarket,
} from "../../../src/lib/health-score.ts";
import {
  creditorDaysHealthyBand,
  currentRatioValue,
  formatQuotedDays,
  healthBandLabel,
  peerMedian,
  periodMonthsOf,
} from "../../../src/lib/ratios.ts";
import { statementGrossMarginFraction, statementNetProfit } from "../../../src/lib/period-profit.ts";
import { formatStatementMargin } from "../../../src/lib/statement-margin.ts";
import {
  figuresPeriodLabelFrom,
  readStatementMeta,
  storedYearToDateEnd,
} from "../../../src/lib/statement-period.ts";
import { computeRatiosFromFinancials, DISPLAY_TO_CAMEL } from "./derive-ratios.ts";
import type { DateMarket } from "../../../src/lib/market/format.ts";
import { marketForClient } from "../../../src/lib/market/scope.ts";

export type OverviewCopyPack = "za" | "us";

export type OverviewPillar = {
  id: "profit" | "assets" | "financing" | "cash";
  label: string;
  score: number | null;
  status: "healthy" | "at_risk" | "critical";
};

export type OverviewBrief = {
  clientName: string | null;
  periodLabel: string | null;
  figuresAsOf: string | null;
  copyPack: OverviewCopyPack;
  health: number | null;
  healthStatus: "healthy" | "at_risk" | "critical" | null;
  healthLabel: "Healthy" | "Watch" | "Critical" | null;
  pillars: OverviewPillar[];
  weakest: { id: string; label: string; score: number } | null;
  cash: number | null;
  revenue: number | null;
  runwayWeeks: number | null;
  /** "Cash generative", "4 weeks", "0 weeks". Null when runway is unknown. */
  runwayLabel: string | null;
  creditorDays: number | null;
  debtorDays: number | null;
  /** Stored inventory balance. Null when the file has no inventory line. */
  inventory: number | null;
  /** `overviewRatios` Inventory Days. Null when Overview omits the ratio. */
  inventoryDays: number | null;
  workingCapitalDays: number | null;
  /** Current assets ÷ current liabilities. Null when Overview cannot show it. */
  currentRatio: number | null;
  /** Finite Overview ratios, display names, same map the desk scores. */
  ratioValues: Record<string, number>;
  periodStart: string | null;
  periodEnd: string | null;
  /** Short source phrase, e.g. "uploaded statement". */
  figuresSource: string | null;
  /** Set when the stored period is year-to-date. "30 Sep 2026". */
  yearToDateEnd: string | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  /** Stored P&L headlines. Null when that line is not on the file. */
  grossProfit: number | null;
  operatingProfit: number | null;
  profitBeforeTax: number | null;
  netProfit: number | null;
  /** Balance-sheet totals the Health grid can show. Null when the file has none. */
  equity: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  /** True only when total liabilities was assets minus equity, not a stored total. */
  totalLiabilitiesDerived: boolean;
  brainHeadline: string | null;
};

const CAMEL_TO_DISPLAY: Record<string, string> = {};
for (const [display, camel] of Object.entries(DISPLAY_TO_CAMEL)) {
  CAMEL_TO_DISPLAY[camel] = display;
}

function asNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.replace(/[,\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Stored total liabilities win. Assets minus equity is used only when no
 * stored total is present, and that result is labelled derived. Payables are
 * not a stand-in for the printed total.
 */
export function resolveTotalLiabilities(
  financials: Record<string, unknown> | null | undefined,
): { amount: number; derived: boolean } | null {
  if (!financials) return null;
  const stored =
    asNumber(financials.totalLiabilities) ??
    asNumber(financials.total_liabilities) ??
    asNumber(financials.liabilities);
  if (stored != null) return { amount: stored, derived: false };
  const assets = asNumber(financials.totalAssets) ?? asNumber(financials.total_assets);
  const equity = asNumber(financials.equity);
  if (assets == null || equity == null) return null;
  return { amount: Math.round((assets - equity) * 100) / 100, derived: true };
}

function chipLabel(status: "healthy" | "at_risk" | "critical"): "Healthy" | "Watch" | "Critical" {
  return healthBandLabel(status);
}

const NON_FINITE_DAY_KEYS = new Set(["Creditor Days", "Inventory Days", "Working Capital Days"]);

function finiteDisplayRatios(raw: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [key, val] of Object.entries(raw)) {
    const display = DISPLAY_TO_CAMEL[key] ? key : CAMEL_TO_DISPLAY[key];
    if (!display) continue;
    if (!Number.isFinite(val)) {
      if (NON_FINITE_DAY_KEYS.has(display) && Number.isNaN(val)) out[display] = Number.NaN;
      continue;
    }
    out[display] = val;
  }
  return out;
}

export function brainHeadlineFromSummary(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  for (const key of ["headline", "summary", "body"]) {
    const val = src[key];
    if (typeof val === "string" && val.trim()) return val.trim().slice(0, 400);
  }
  return null;
}

export function copyPackFromMarket(raw: unknown): OverviewCopyPack {
  if (raw && typeof raw === "object" && "country" in raw) {
    const country = (raw as { country?: unknown }).country;
    if (country === "US") return "us";
  }
  return "za";
}

function marketFromCopyPack(copyPack: OverviewCopyPack): ScoreMarket {
  return copyPack === "us" ? { country: "US", copyPack: "us" } : { country: "ZA", copyPack: "za" };
}

/** Profile year-start when the funnel stored one, otherwise the market default. */
export function overviewFyStartMonth(
  copyPack: OverviewCopyPack,
  operatingProfile: unknown,
): number {
  const profile = parseOperatingProfile(operatingProfile);
  const fromProfile = profile?.fyStartMonth;
  if (fromProfile != null && Number.isFinite(fromProfile) && fromProfile >= 1 && fromProfile <= 12) {
    return fromProfile;
  }
  return copyPack === "us" ? 1 : 3;
}

function resolvedFyStart(copyPack: OverviewCopyPack, explicit?: number | null): number {
  if (explicit != null && Number.isFinite(Number(explicit)) && Number(explicit) >= 1) {
    return Number(explicit);
  }
  return copyPack === "us" ? 1 : 3;
}

function money(n: number, copyPack: OverviewCopyPack): string {
  const symbol = copyPack === "us" ? "$" : "R";
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : 2;
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${n < 0 ? "-" : ""}${symbol}${formatted}`;
}

export function formatMoney(n: number, copyPack: OverviewCopyPack): string {
  return money(n, copyPack);
}

function pct(fraction: number): string {
  return formatStatementMargin(fraction) ?? "—";
}

function days(n: number, name = "Debtor Days"): string {
  return formatQuotedDays(name, n);
}

function finiteOrNull(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) ? n : null;
}

function figuresSourcePhrase(source: string | null | undefined): string | null {
  switch (source) {
    case "xero":
      return "Xero";
    case "qbo":
      return "QuickBooks";
    case "sage":
      return "Sage";
    case "upload":
    case "pdf_upload":
      return "uploaded statement";
    case "financial_statement":
      return "imported statement";
    case "bank_pack":
      return "bank import";
    case "manual":
      return "figures entered by hand";
    default:
      return null;
  }
}

/** Ratios the Overview sphere shows that are not given their own sentence above. */
const OVERVIEW_RATIO_NAMES = [
  "Working Capital Days",
  "Fixed Cost Ratio",
  "Asset Turnover",
  "Return on Assets",
  "Return on Equity",
  "Equity Multiplier",
  "Debt-to-Equity",
  "Interest Burden",
  "Tax Burden",
  "Degree of Operating Leverage",
  "Top-5 Customer Share",
  "Gross Profit / Labor",
  "Sales-per-Employee Ratio",
  "OCF / EBITDA",
] as const;

function formatOverviewRatio(name: string, value: number, copyPack: OverviewCopyPack): string {
  if (name.endsWith("Days")) return `${name}: ${days(value, name)}`;
  if (
    name.endsWith("Margin") ||
    name === "Fixed Cost Ratio" ||
    name === "Top-5 Customer Share" ||
    name === "Return on Assets" ||
    name === "Return on Equity"
  ) {
    return `${name}: ${pct(value)}`;
  }
  if (name === "Sales-per-Employee Ratio") return `${name}: ${money(value, copyPack)}`;
  const digits = Math.abs(value) >= 100 ? 0 : 2;
  return `${name}: ${value.toFixed(digits)}×`;
}

/**
 * Runway line the Bot may quote. Cash already on file is not a missing bank
 * balance — the only gap left is a cash-flow statement.
 */
export function overviewRunwayFact(brief: OverviewBrief): string | null {
  const label = brief.runwayLabel;
  if (brief.cash != null && label && /bank balance/i.test(label)) {
    return "Cash runway: not estimated yet — no cash-flow statement is on file";
  }
  if (label) return `Cash runway: ${label}`;
  if (brief.runwayWeeks != null) return `Cash runway: ${brief.runwayWeeks} weeks`;
  return null;
}

export function buildOverviewBrief(input: {
  financials?: Record<string, unknown> | null;
  ratios?: Record<string, number> | null;
  runwayWeeks?: number | null;
  runwayLabel?: string | null;
  /** Resolved cash (bank, then period). When set, wins over financials.cash. */
  cash?: number | null;
  copyPack?: OverviewCopyPack;
  /** Operating-profile year start. Omitted uses January for US and March for ZA. */
  fyStartMonth?: number | null;
  /** First forecast week below zero. Week 1 cannot display Healthy. */
  shortfallWeek?: number | null;
  market?: ScoreMarket;
  /** Client market for printed ranges. Copy-pack stand-in is only used when this is omitted. */
  dateMarket?: DateMarket;
  /** Stored forecast. Real lines count as evidence. When this is passed, health comes from `liveHealthFromBooks`. */
  cashflow?: unknown;
  clientName?: string | null;
  periodLabel?: string | null;
  figuresAsOf?: string | null;
  brainSummary?: unknown;
  /** Industry label. A gross margin above 85% stays out of Profit outside software. */
  industry?: string | null;
  /** Blank opening. Cash is left unscored. */
  openingMissing?: boolean;
  /** 13-week opening and closings. A close under the floor caps Cash at 25. */
  cashOpening?: number | null;
  cashClosings?: readonly number[] | null;
  cashFloor?: number | null;
  financialsUpdatedAt?: string | null;
  priorFinancials?: Record<string, unknown> | null;
  timeZone?: string | null;
  now?: Date;
}): OverviewBrief {
  const copyPack = input.copyPack ?? "za";
  const market = input.market ?? marketFromCopyPack(copyPack);
  const dateMarket =
    input.dateMarket ??
    marketForClient({
      market: copyPack === "us" ? { country: "US", regionCode: "NY" } : null,
    });
  const fyStartMonth = resolvedFyStart(copyPack, input.fyStartMonth);
  const financials =
    input.financials && typeof input.financials === "object" && !Array.isArray(input.financials)
      ? input.financials
      : null;
  const periodMonths = financials ? periodMonthsOf(financials) : null;
  const derived = finiteDisplayRatios(
    computeRatiosFromFinancials(financials, { fyStartMonth, periodMonths }),
  );
  const ratios = Object.keys(derived).length > 0 ? derived : finiteDisplayRatios(input.ratios ?? null);

  const runway = asNumber(input.runwayWeeks);
  // Same pillar math as Overview / the scorecard. A year-span health score
  // (creditor days 28) must not sit next to the stored-cover days (37).
  // No books: health, cash, and runway stay blank. A $0 default is not a score.
  const evidenced = hasFinancialEvidence({
    financials,
    cashflow: input.cashflow,
    ratios,
  });
  const cashOnFile = !evidenced
    ? null
    : input.cash !== undefined
      ? input.cash
      : asNumber(financials?.cash);
  const fromBooks =
    evidenced && financials && input.cashflow !== undefined
      ? liveHealthFromBooks({
          financials,
          cashflow: input.cashflow,
          financialsUpdatedAt: input.financialsUpdatedAt ?? null,
          priorFinancials: input.priorFinancials ?? null,
          fyStartMonth,
          market,
          industry: input.industry,
          timeZone: input.timeZone,
          now: input.now,
        })
      : null;
  const raw = !evidenced
    ? null
    : (fromBooks ??
      (financials
        ? scorecardHealthFromFinancials({
            financials,
            fyStartMonth,
            periodMonths,
            cashRunwayWeeks: runway,
            cashBalance: cashOnFile,
            shortfallWeek: input.shortfallWeek,
            market,
            industry: input.industry,
          })
        : computeOverallHealth({
            ratios,
            cashRunwayWeeks: runway,
            shortfallWeek: input.shortfallWeek,
            market,
          })));
  const scored =
    raw == null
      ? null
      : fromBooks
        ? fromBooks
        : raw.overall == null
          ? raw
          : cashPillarFollowsForecast(raw, {
              hasEvidence: true,
              openingMissing: input.openingMissing === true,
              opening: input.cashOpening,
              closings: input.cashClosings,
              floor: input.cashFloor,
            });
  const pillars: OverviewPillar[] = (scored?.pillars ?? []).map((pillar) => ({
    id: pillar.id,
    label: pillar.label,
    score: evidenced ? pillar.score : null,
    status: pillar.status,
  }));
  const health = evidenced ? (scored?.overall ?? null) : null;
  const healthStatus = health == null ? null : (scored?.displayStatus ?? null);
  const weakest = scored?.weakestPillar ?? null;

  const statement = financials ? readStatementMeta(financials, dateMarket) : null;
  const operatingProfit = asNumber(financials?.ebit);
  const quotedNet = statementNetProfit(financials);
  const netUsable = quotedNet != null;
  const liabilities = resolveTotalLiabilities(financials);
  const currentAssets = asNumber(financials?.currentAssets);
  const currentLiabilities = asNumber(financials?.currentLiabilities);
  const currentRatio =
    currentAssets == null || currentLiabilities == null
      ? null
      : finiteOrNull(currentRatioValue(currentAssets, currentLiabilities));

  return {
    clientName: input.clientName?.trim() || null,
    periodLabel: figuresPeriodLabelFrom(financials, input.periodLabel, dateMarket),
    figuresAsOf: input.figuresAsOf ?? null,
    copyPack,
    health,
    healthStatus,
    healthLabel: healthStatus ? chipLabel(healthStatus) : null,
    pillars,
    weakest:
      weakest && weakest.score != null
        ? { id: weakest.id, label: weakest.label, score: weakest.score }
        : null,
    cash: evidenced ? cashOnFile : null,
    revenue: evidenced ? asNumber(financials?.revenue) : null,
    runwayWeeks: evidenced ? runway : null,
    runwayLabel: !evidenced
      ? null
      : input.runwayLabel !== undefined
        ? input.runwayLabel
        : runway != null
          ? `${runway} ${runway === 1 ? "week" : "weeks"}`
          : null,
    creditorDays: Number.isFinite(ratios["Creditor Days"]) ? ratios["Creditor Days"] : null,
    debtorDays: Number.isFinite(ratios["Debtor Days"]) ? ratios["Debtor Days"] : null,
    inventory: asNumber(financials?.inventory),
    inventoryDays: finiteOrNull(ratios["Inventory Days"]),
    workingCapitalDays: finiteOrNull(ratios["Working Capital Days"]),
    currentRatio,
    ratioValues: ratios,
    periodStart: statement?.periodStart ?? null,
    periodEnd: statement?.periodEnd ?? null,
    figuresSource: figuresSourcePhrase(statement?.statementSource),
    yearToDateEnd: storedYearToDateEnd(financials, fyStartMonth, dateMarket),
    grossMargin:
      statementGrossMarginFraction(financials) ??
      (Number.isFinite(ratios["Gross Margin"]) ? ratios["Gross Margin"] : null),
    operatingMargin: Number.isFinite(ratios["Operating Margin"]) ? ratios["Operating Margin"] : null,
    netMargin: netUsable && Number.isFinite(ratios["Net Margin"]) ? ratios["Net Margin"] : null,
    grossProfit: asNumber(financials?.grossProfit),
    operatingProfit,
    profitBeforeTax: asNumber(financials?.ebt),
    netProfit: quotedNet,
    equity: asNumber(financials?.equity),
    totalAssets: asNumber(financials?.totalAssets),
    totalLiabilities: liabilities?.amount ?? null,
    totalLiabilitiesDerived: liabilities?.derived ?? false,
    brainHeadline: brainHeadlineFromSummary(input.brainSummary),
  };
}

/** Lines the model must quote. Present figures are already on file. */
export function overviewFactLines(brief: OverviewBrief): string[] {
  const lines: string[] = [];
  if (brief.health != null && brief.healthLabel) {
    lines.push(`Health: ${brief.health} (${brief.healthLabel})`);
  }
  if (brief.cash != null) lines.push(`Cash on file: ${money(brief.cash, brief.copyPack)}`);
  if (brief.totalAssets != null) {
    lines.push(`Total assets: ${money(brief.totalAssets, brief.copyPack)}`);
  }
  if (brief.totalLiabilities != null) {
    const label = brief.totalLiabilitiesDerived ? "Total liabilities (derived)" : "Total liabilities";
    lines.push(`${label}: ${money(brief.totalLiabilities, brief.copyPack)}`);
  }
  if (brief.equity != null) lines.push(`Total equity: ${money(brief.equity, brief.copyPack)}`);
  if (brief.revenue != null) {
    const ytd = brief.yearToDateEnd ? ` (year to date to ${brief.yearToDateEnd})` : "";
    lines.push(`Revenue for the period on file: ${money(brief.revenue, brief.copyPack)}${ytd}`);
  }
  if (brief.inventory != null) {
    lines.push(`Inventory: ${money(brief.inventory, brief.copyPack)} (stored balance)`);
  }
  if (brief.grossProfit != null) {
    lines.push(`Gross profit: ${money(brief.grossProfit, brief.copyPack)} (stored)`);
  }
  if (brief.operatingProfit != null) {
    lines.push(`Operating profit: ${money(brief.operatingProfit, brief.copyPack)} (stored)`);
  }
  if (brief.profitBeforeTax != null) {
    lines.push(`Profit before tax: ${money(brief.profitBeforeTax, brief.copyPack)} (stored)`);
  }
  if (brief.netProfit != null) {
    lines.push(
      `Net profit: ${money(brief.netProfit, brief.copyPack)} (stored net income — quote this amount; do not multiply net margin by revenue)`,
    );
  }
  const runwayFact = overviewRunwayFact(brief);
  if (runwayFact) lines.push(runwayFact);
  if (brief.grossMargin != null) lines.push(`Gross margin: ${pct(brief.grossMargin)}`);
  if (brief.operatingMargin != null) lines.push(`Operating margin: ${pct(brief.operatingMargin)}`);
  if (brief.netMargin != null) lines.push(`Net margin: ${pct(brief.netMargin)}`);
  if (brief.debtorDays != null) {
    const median = peerMedian("debtorDays");
    lines.push(
      median != null
        ? `Debtor days: ${days(brief.debtorDays, "Debtor Days")} (peer median ${median} days)`
        : `Debtor days: ${days(brief.debtorDays, "Debtor Days")}`,
    );
  }
  if (brief.creditorDays != null) {
    const band = creditorDaysHealthyBand();
    lines.push(
      `Creditor days: ${days(brief.creditorDays, "Creditor Days")} (healthy band ${band.min}–${band.max} days)`,
    );
  } else if (Number.isNaN(brief.ratioValues["Creditor Days"])) {
    lines.push("Creditor days: not meaningful");
  }
  if (brief.inventoryDays != null) {
    const where = [
      brief.periodLabel ? `period ${brief.periodLabel}` : null,
      brief.figuresSource,
    ]
      .filter((part): part is string => Boolean(part))
      .join(", ");
    lines.push(
      where
        ? `Inventory days: ${days(brief.inventoryDays, "Inventory Days")} (${where})`
        : `Inventory days: ${days(brief.inventoryDays, "Inventory Days")}`,
    );
  } else if (Number.isNaN(brief.ratioValues["Inventory Days"])) {
    lines.push("Inventory days: not meaningful");
  }
  if (Number.isNaN(brief.ratioValues["Working Capital Days"])) {
    lines.push("Working Capital Days: not meaningful");
  }
  if (brief.currentRatio != null) {
    lines.push(formatOverviewRatio("Current Ratio", brief.currentRatio, brief.copyPack));
  }
  for (const name of OVERVIEW_RATIO_NAMES) {
    const value = brief.ratioValues[name];
    if (!Number.isFinite(value)) continue;
    lines.push(formatOverviewRatio(name, value, brief.copyPack));
  }
  for (const pillar of brief.pillars) {
    if (pillar.score == null) continue;
    lines.push(`${pillar.label}: ${pillar.score}`);
  }
  if (brief.weakest) {
    lines.push(`Weakest pillar: ${brief.weakest.label} (${brief.weakest.score})`);
  }
  return lines;
}

export function formatOverviewForPrompt(
  brief: OverviewBrief,
  audience: "owner" | "accountant",
): string {
  const facts = overviewFactLines(brief);
  if (facts.length === 0 && !brief.brainHeadline && !brief.clientName) return "";
  const lines = [
    "OVERVIEW FIGURES — same source as the app Overview for this client. Quote these. Do not recompute a different health score. Do not invent replacements.",
  ];
  if (brief.clientName) lines.push(`- Client name: ${brief.clientName}`);
  if (brief.periodLabel) {
    const range =
      brief.periodStart && brief.periodEnd ? ` (${brief.periodStart} to ${brief.periodEnd})` : "";
    lines.push(`- Figures period: ${brief.periodLabel}${range}`);
  }
  if (brief.figuresSource) lines.push(`- Figures source: ${brief.figuresSource}`);
  if (facts.length === 0) lines.push("(no numeric overview yet)");
  else lines.push(...facts.map((line) => `- ${line}`));
  if (brief.brainHeadline) {
    lines.push(
      `Client Brain headline (background only; if it disagrees with the figures above, use the figures): ${brief.brainHeadline}`,
    );
  }
  if (brief.operatingMargin != null || brief.netMargin != null) {
    lines.push(
      "Operating margin is EBIT divided by revenue. Net margin is net income divided by revenue. Quote those labels. Do not call operating margin EBIT, and do not replace either figure with a waterfall percentage.",
    );
  }
  if (
    brief.grossProfit != null ||
    brief.operatingProfit != null ||
    brief.profitBeforeTax != null ||
    brief.netProfit != null
  ) {
    lines.push(
      "Quote stored Gross profit, Operating profit, Profit before tax, and Net profit when they are listed. Do not recreate them by multiplying a margin by revenue.",
    );
  }
  if (brief.cash != null) {
    lines.push(
      "Cash on file is already recorded. Do not say the bank balance or the cash figure is missing. If runway is not estimated, the only gap you may name is that no cash-flow statement is on file.",
    );
  }
  if (audience === "accountant") {
    lines.push(
      "Address the accountant about this client. Say \"this client\" or \"the owner\" for the business. Do not address the accountant as if they were the owner (\"You are…\").",
    );
  }
  if (brief.inventory != null || brief.inventoryDays != null) {
    lines.push(
      "Inventory and inventory days listed above are the Overview figures for this period. Quote that inventory days number with its period and source. Do not say the inventory balance is not stored, and do not recalculate the days with a different formula.",
    );
  }
  if (brief.yearToDateEnd) {
    lines.push(
      `The stored period is year to date. When asked for revenue YTD, answer with the revenue figure above and say "year to date to ${brief.yearToDateEnd}". Do not say that no year-to-date split is stored.`,
    );
  }
  lines.push(
    "Every figure listed above is already on file. Never ask the user to supply health, cash, revenue, gross profit, operating profit, net profit, runway, margin, debtor days, creditor days, inventory, inventory days, working capital days, current ratio, total assets, total liabilities, or total equity when that line is present.",
  );
  return lines.join("\n");
}

export type PlannedAction = {
  sourceMoveKey: string;
  title: string;
  outcomeWhy: string;
};

/** Action Plan rows grounded in overview figures. No invented metrics. */
export function planActionsFromOverview(brief: OverviewBrief): PlannedAction[] {
  const items: PlannedAction[] = [];
  if (brief.runwayWeeks != null && brief.runwayWeeks < 12) {
    const cash =
      brief.cash != null ? ` Cash on file is ${money(brief.cash, brief.copyPack)}.` : "";
    items.push({
      sourceMoveKey: "bot:cash-runway",
      title: `Protect cash runway (${brief.runwayWeeks} weeks)`,
      outcomeWhy: `Overview runway is ${brief.runwayWeeks} weeks.${cash} Agree how this client covers the next month before treating the forecast as comfortable.`,
    });
  }
  const creditorMax = creditorDaysHealthyBand().max;
  if (brief.creditorDays != null && brief.creditorDays > creditorMax) {
    items.push({
      sourceMoveKey: "bot:creditor-days",
      title: `Review creditor days (${Math.round(brief.creditorDays)})`,
      outcomeWhy: `Creditor days on the Overview are ${Math.round(brief.creditorDays)}, above the ${creditorMax}-day healthy band. Agree a payment stance with the client before the next review.`,
    });
  }
  const debtorMedian = peerMedian("debtorDays");
  if (brief.debtorDays != null && debtorMedian != null && brief.debtorDays > debtorMedian) {
    items.push({
      sourceMoveKey: "bot:debtor-days",
      title: `Collect debtor days (${Math.round(brief.debtorDays)})`,
      outcomeWhy: `Debtor days on the Overview are ${Math.round(brief.debtorDays)}, above the ${debtorMedian}-day peer median. Chase the slowest balances already on file.`,
    });
  }
  if (items.length === 0 && brief.health != null) {
    const weak = brief.weakest
      ? ` Weakest pillar is ${brief.weakest.label} (${brief.weakest.score}).`
      : "";
    items.push({
      sourceMoveKey: "bot:health-review",
      title: `Review health ${brief.health}`,
      outcomeWhy: `Overview health is ${brief.health} (${brief.healthLabel ?? "scored"}).${weak} Walk those figures with the client.`,
    });
  }
  return items.slice(0, 4);
}

export function rulesDraftBody(brief: OverviewBrief): string {
  const who = brief.clientName ?? "this client";
  const facts = overviewFactLines(brief);
  const lines = [
    `SUBJECT: Advisory note for ${who}`,
    "",
    "Draft for the accountant to review. It has not been sent.",
    "",
    facts.length
      ? `Figures already on the Overview:\n${facts.map((f) => `- ${f}`).join("\n")}`
      : "The Overview does not have scored figures yet. Do not invent them.",
    "",
    "Use these figures in the conversation. Do not ask the client to re-supply cash, revenue, runway, margins, or days that are listed above.",
    "Nothing in this note is signed off.",
  ];
  return lines.join("\n");
}

export function packContentFromOverview(
  brief: OverviewBrief,
  actions: PlannedAction[],
  nowIso: string,
): Record<string, unknown> {
  const facts = overviewFactLines(brief);
  const healthLine =
    brief.health != null
      ? `Overview health is ${brief.health} (${brief.healthLabel ?? ""}).`.trim()
      : "Overview health is not scored yet.";
  return {
    schema: 1,
    generatedAt: nowIso,
    clientName: brief.clientName ?? "",
    periodLabel: brief.periodLabel,
    priorPeriodLabel: null,
    figuresAsOf: brief.figuresAsOf,
    reviewer: "accountant",
    health:
      brief.health == null
        ? null
        : {
            overall: brief.health,
            status: brief.healthStatus,
            label: brief.healthLabel,
            pillars: brief.pillars.map((p) => ({
              id: p.id,
              label: p.label,
              score: p.score,
              status: p.status,
            })),
            weakest: brief.weakest?.label ?? null,
          },
    ratios: [],
    forecast: {
      openingBalance: brief.cash,
      lowestClosing: null,
      lowestWeek: null,
      breachesZero: false,
      breachesThreshold: brief.runwayWeeks != null && brief.runwayWeeks < 8,
      runwayWeeks: brief.runwayWeeks,
      horizonWeeks: 13,
    },
    recommendations: actions.map((a, i) => ({
      id: a.sourceMoveKey,
      title: a.title,
      problem: a.outcomeWhy,
      priority: i === 0 ? "high" : "medium",
      status: "proposed",
      expectedImpact: null,
      dataDepth: "overview",
    })),
    dataGaps: [],
    sections: [
      { key: "headline", title: "Where this client stands", body: healthLine },
      {
        key: "state_of_business",
        title: "Overview figures",
        body: facts.join("\n") || "No overview figures on file.",
      },
      {
        key: "forecast",
        title: "Cash",
        body:
          brief.cash != null || brief.runwayLabel || brief.runwayWeeks != null
            ? `Cash on file ${brief.cash != null ? money(brief.cash, brief.copyPack) : "not on file"}. Runway ${
                brief.runwayLabel ??
                (brief.runwayWeeks != null ? `${brief.runwayWeeks} weeks` : "not on file")
              }.`
            : "Cash and runway are not on the Overview.",
      },
      {
        key: "what_matters",
        title: "What matters",
        body: brief.weakest
          ? `Weakest pillar is ${brief.weakest.label} at ${brief.weakest.score}.`
          : healthLine,
      },
      {
        key: "recommendations",
        title: "Moves on the Action Plan",
        body: actions.length
          ? actions.map((a) => a.title).join("\n")
          : "No new Action Plan items were required from the Overview.",
      },
      {
        key: "disclosure",
        title: "Disclosure",
        body: "Draft for accountant review. Not sent. Figures are the Overview, not a second score.",
        locked: true,
      },
    ],
  };
}
