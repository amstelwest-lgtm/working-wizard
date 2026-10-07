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

import { parseOperatingProfile } from "../../../src/lib/client-profile.ts";
import { computeOverallHealth, type ScoreMarket } from "../../../src/lib/health-score.ts";
import {
  creditorDaysHealthyBand,
  healthBandLabel,
  peerMedian,
} from "../../../src/lib/ratios.ts";
import { formatStatementMargin } from "../../../src/lib/statement-margin.ts";
import { computeRatiosFromFinancials, DISPLAY_TO_CAMEL } from "./derive-ratios.ts";

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
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
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

function finiteDisplayRatios(raw: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const [key, val] of Object.entries(raw)) {
    if (!Number.isFinite(val)) continue;
    const display = DISPLAY_TO_CAMEL[key] ? key : CAMEL_TO_DISPLAY[key];
    if (!display) continue;
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

function days(n: number): string {
  return `${Math.round(n)} days`;
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
  clientName?: string | null;
  periodLabel?: string | null;
  figuresAsOf?: string | null;
  brainSummary?: unknown;
}): OverviewBrief {
  const copyPack = input.copyPack ?? "za";
  const market = input.market ?? marketFromCopyPack(copyPack);
  const fyStartMonth = resolvedFyStart(copyPack, input.fyStartMonth);
  const financials =
    input.financials && typeof input.financials === "object" && !Array.isArray(input.financials)
      ? input.financials
      : null;
  const derived = finiteDisplayRatios(computeRatiosFromFinancials(financials, { fyStartMonth }));
  const ratios = Object.keys(derived).length > 0 ? derived : finiteDisplayRatios(input.ratios ?? null);

  const runway = asNumber(input.runwayWeeks);
  const scored = computeOverallHealth({
    ratios,
    cashRunwayWeeks: runway,
    shortfallWeek: input.shortfallWeek,
    market,
  });
  const pillars: OverviewPillar[] = scored.pillars.map((pillar) => ({
    id: pillar.id,
    label: pillar.label,
    score: pillar.score,
    status: pillar.status,
  }));
  const health = scored.overall;
  const healthStatus = health == null ? null : scored.displayStatus;
  const weakest = scored.weakestPillar;

  const periodFromFin =
    typeof financials?.periodLabel === "string" && financials.periodLabel.trim()
      ? financials.periodLabel.trim()
      : null;
  const liabilities = resolveTotalLiabilities(financials);

  return {
    clientName: input.clientName?.trim() || null,
    periodLabel: input.periodLabel?.trim() || periodFromFin,
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
    cash: input.cash !== undefined ? input.cash : asNumber(financials?.cash),
    revenue: asNumber(financials?.revenue),
    runwayWeeks: runway,
    runwayLabel:
      input.runwayLabel !== undefined
        ? input.runwayLabel
        : runway != null
          ? `${runway} ${runway === 1 ? "week" : "weeks"}`
          : null,
    creditorDays: Number.isFinite(ratios["Creditor Days"]) ? ratios["Creditor Days"] : null,
    debtorDays: Number.isFinite(ratios["Debtor Days"]) ? ratios["Debtor Days"] : null,
    grossMargin: Number.isFinite(ratios["Gross Margin"]) ? ratios["Gross Margin"] : null,
    operatingMargin: Number.isFinite(ratios["Operating Margin"]) ? ratios["Operating Margin"] : null,
    netMargin: Number.isFinite(ratios["Net Margin"]) ? ratios["Net Margin"] : null,
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
    lines.push(`Health: ${brief.health}/100 (${brief.healthLabel})`);
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
    lines.push(`Revenue for the period on file: ${money(brief.revenue, brief.copyPack)}`);
  }
  if (brief.runwayLabel) lines.push(`Cash runway: ${brief.runwayLabel}`);
  else if (brief.runwayWeeks != null) lines.push(`Cash runway: ${brief.runwayWeeks} weeks`);
  if (brief.grossMargin != null) lines.push(`Gross margin: ${pct(brief.grossMargin)}`);
  if (brief.operatingMargin != null) lines.push(`Operating margin: ${pct(brief.operatingMargin)}`);
  if (brief.netMargin != null) lines.push(`Net margin: ${pct(brief.netMargin)}`);
  if (brief.debtorDays != null) {
    const median = peerMedian("debtorDays");
    lines.push(
      median != null
        ? `Debtor days: ${days(brief.debtorDays)} (peer median ${median} days)`
        : `Debtor days: ${days(brief.debtorDays)}`,
    );
  }
  if (brief.creditorDays != null) {
    const band = creditorDaysHealthyBand();
    lines.push(
      `Creditor days: ${days(brief.creditorDays)} (healthy band ${band.min}–${band.max} days)`,
    );
  }
  for (const pillar of brief.pillars) {
    if (pillar.score == null) continue;
    lines.push(`${pillar.label}: ${pillar.score}/100`);
  }
  if (brief.weakest) {
    lines.push(`Weakest pillar: ${brief.weakest.label} (${brief.weakest.score}/100)`);
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
  if (facts.length === 0) lines.push("(no numeric overview yet)");
  else lines.push(...facts.map((line) => `- ${line}`));
  if (brief.brainHeadline) {
    lines.push(
      `Client Brain headline (background only; if it disagrees with the figures above, use the figures): ${brief.brainHeadline}`,
    );
  }
  if (audience === "accountant") {
    lines.push(
      "Address the accountant about this client. Say \"this client\" or \"the owner\" for the business. Do not address the accountant as if they were the owner (\"You are…\").",
    );
  }
  lines.push(
    "Every figure listed above is already on file. Never ask the user to supply health, cash, revenue, runway, margin, debtor days, creditor days, total assets, total liabilities, or total equity when that line is present.",
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
      ? ` Weakest pillar is ${brief.weakest.label} (${brief.weakest.score}/100).`
      : "";
    items.push({
      sourceMoveKey: "bot:health-review",
      title: `Review health ${brief.health}/100`,
      outcomeWhy: `Overview health is ${brief.health}/100 (${brief.healthLabel ?? "scored"}).${weak} Walk those figures with the client.`,
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
      ? `Overview health is ${brief.health}/100 (${brief.healthLabel ?? ""}).`.trim()
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
          ? `Weakest pillar is ${brief.weakest.label} at ${brief.weakest.score}/100.`
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
