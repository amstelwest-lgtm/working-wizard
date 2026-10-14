/**
 * Pure rules for the public sample at /try.
 * Health and ratios come from health-score.ts and ratios.ts.
 * Profitability uses the period bridge the waterfall already uses.
 * The 13-week line uses resolveThirteenWeekForecast.
 * Nothing here talks to a ledger.
 */

import { resolveThirteenWeekForecast } from "@/lib/client-metrics";
import {
  overviewRatios,
  scorecardHealthFromFinancials,
  scoreRatio,
  type ScoreMarket,
} from "@/lib/health-score";
import { periodProfitBridge } from "@/lib/period-profit";
import { currentRatioValue, healthBandLabel } from "@/lib/ratios";
import { SAMPLE_BUSINESS_BLURB, sampleFinancialsFor } from "@/lib/sample-business";
import type { MarketId } from "@/lib/market/types";
import {
  TRIAL_DISCLAIMER,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_TOKEN,
  turnstileSecret,
  turnstileSiteKey,
} from "@/lib/trial-public";

export { TRIAL_DISCLAIMER };

export const TRIAL_SESSIONS_PER_IP_PER_DAY = 3;
export const TRIAL_LEADS_PER_EMAIL = 2;
export const TRIAL_RUNS_PER_SESSION = 10;
export const TRIAL_DEFAULT_DAILY_AI_CAP = 100;
export const TRIAL_RETENTION_DAYS = 7;
export const TRIAL_COOKIE = "milon_trial";

export type TrialMarketId = MarketId;

export type GateError = "name" | "email" | "consent" | "turnstile";

export type TrialGateInput = {
  name: string;
  email: string;
  consent: boolean;
  turnstileToken: string;
};

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function ipSessionAllowed(countToday: number): boolean {
  return countToday < TRIAL_SESSIONS_PER_IP_PER_DAY;
}

/** Two leads per email. Leads are kept, so this is a lifetime count. */
export function emailLeadAllowed(count: number): boolean {
  return count < TRIAL_LEADS_PER_EMAIL;
}

export function sessionRunAllowed(count: number): boolean {
  return count < TRIAL_RUNS_PER_SESSION;
}

export function trialDailyCap(raw: string | undefined): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return TRIAL_DEFAULT_DAILY_AI_CAP;
}

/**
 * The deterministic reading is only for a missing model key.
 * A present key calls the analyst. Past the daily cap, the call is paused
 * rather than replaced with that reading.
 */
export function trialAnalystMode(input: {
  runsToday: number;
  cap: number;
  aiConfigured: boolean;
}): "model" | "deterministic" | "paused" {
  if (!input.aiConfigured) return "deterministic";
  if (input.runsToday >= input.cap) return "paused";
  return "model";
}

/** A finding that only repeats the health score is not a reading. */
export function findingRestatesScore(finding: TrialFinding): boolean {
  const text = `${finding.title} ${finding.detail}`.toLowerCase();
  return /health score|weakest pillar|pillar score|overall health/.test(text);
}

export function deliverTrialFindings(input: {
  mode: "model" | "deterministic" | "paused";
  modelFindings: TrialFinding[];
  fallback: TrialFinding[];
}):
  | { ok: true; findings: TrialFinding[]; delivered: "model" | "deterministic" }
  | { ok: false; reason: "paused" | "empty" } {
  if (input.mode === "paused") return { ok: false, reason: "paused" };
  if (input.mode === "deterministic") {
    return { ok: true, findings: input.fallback.slice(0, 3), delivered: "deterministic" };
  }
  const findings = input.modelFindings
    .filter((finding) => !findingRestatesScore(finding))
    .slice(0, 3);
  if (findings.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, findings, delivered: "model" };
}

export function trialMarketFromCountry(country: string | null | undefined): TrialMarketId {
  return (country ?? "").trim().toUpperCase() === "ZA" ? "ZA" : "US";
}

export function validateTrialGate(
  input: TrialGateInput,
): { ok: true; name: string; email: string } | { ok: false; error: GateError } {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) return { ok: false, error: "name" };
  const email = input.email.trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "email" };
  }
  if (input.consent !== true) return { ok: false, error: "consent" };
  if (!input.turnstileToken.trim()) return { ok: false, error: "turnstile" };
  return { ok: true, name, email };
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export function sanitizeUtm(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, 200);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

/**
 * Siteverify when it answers. The published test secret accepts any
 * non-empty token if Cloudflare cannot be reached, so local dev still opens.
 * A real secret never skips siteverify.
 */
export async function verifyTurnstileToken(input: {
  token: string;
  secret: string;
  remoteIp: string | null;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const token = input.token.trim();
  if (!token || !input.secret) return false;
  const testSecret = input.secret === TURNSTILE_TEST_SECRET_KEY;
  try {
    const body = new URLSearchParams();
    body.set("secret", input.secret);
    body.set("response", token);
    if (input.remoteIp && input.remoteIp !== "unknown") body.set("remoteip", input.remoteIp);
    const res = await (input.fetchImpl ?? fetch)(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (res.ok) {
      const json = (await res.json()) as { success?: boolean };
      if (json.success === true) return true;
    }
  } catch {
    /* siteverify unreachable */
  }
  if (!testSecret) return false;
  return token === TURNSTILE_TEST_TOKEN || token.length > 10;
}

export { turnstileSecret, turnstileSiteKey };

export type TrialPillar = {
  id: string;
  label: string;
  score: number | null;
  status: string;
};

export type TrialRatio = {
  name: string;
  display: string;
  value: number;
  score: number;
};

export type TrialBoard = {
  market: TrialMarketId;
  sampleStamp: "SAMPLE";
  blurb: string;
  health: {
    score: number | null;
    label: string;
    pillars: TrialPillar[];
  };
  ratios: TrialRatio[];
};

export type TrialFinding = {
  kind: string;
  severity: "info" | "watch" | "act";
  title: string;
  detail: string;
};

export type TrialStep = {
  label: string;
  display: string;
  kind: "total" | "decrease" | "subtotal";
};

export type TrialProfit = {
  steps: TrialStep[];
  netDisplay: string;
};

export type TrialCashWeek = {
  week: number;
  date: string;
  closeDisplay: string;
};

export type TrialCash = {
  openingDisplay: string;
  weeks: TrialCashWeek[];
  lowDisplay: string;
  note: string;
};

const KEY_RATIOS = [
  "Gross Margin",
  "Net Margin",
  "Debtor Days",
  "Creditor Days",
  "Debt-to-Equity",
  "Return on Equity",
] as const;

const PERCENT_RATIOS = new Set([
  "Gross Margin",
  "Operating Margin",
  "Net Margin",
  "Return on Assets",
  "Return on Equity",
  "Fixed Cost Ratio",
  "Top-5 Customer Share",
]);

const DAY_RATIOS = new Set([
  "Debtor Days",
  "Inventory Days",
  "Creditor Days",
  "Working Capital Days",
]);

function scoreMarket(market: TrialMarketId): ScoreMarket {
  return market === "US" ? { country: "US", copyPack: "us" } : { country: "ZA", copyPack: "za" };
}

function money(n: number, market: TrialMarketId): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const body = Math.round(Math.abs(n)).toLocaleString("en-US");
  return market === "US" ? `${sign}$${body}` : `${sign}R ${body}`;
}

function ratioDisplay(name: string, value: number): string {
  if (PERCENT_RATIOS.has(name)) return `${(value * 100).toFixed(1)}%`;
  if (DAY_RATIOS.has(name)) return `${Math.round(value)} days`;
  return value.toFixed(2);
}

export function buildTrialBoard(market: TrialMarketId): TrialBoard {
  const financials = sampleFinancialsFor(market);
  const scored = scoreMarket(market);
  const health = scorecardHealthFromFinancials({
    financials,
    market: scored,
    cashBalance: null,
    cashRunwayWeeks: null,
  });
  const ratios = overviewRatios(financials);
  const currentAssets = Number(financials.currentAssets);
  const currentLiabilities = Number(financials.currentLiabilities);
  const current = currentRatioValue(currentAssets, currentLiabilities);
  if (Number.isFinite(current)) ratios["Current Ratio"] = current;

  const shown: TrialRatio[] = [];
  for (const name of [...KEY_RATIOS, "Current Ratio"] as string[]) {
    const value = ratios[name];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const score = scoreRatio(name, value, scored);
    if (!Number.isFinite(score)) continue;
    shown.push({ name, display: ratioDisplay(name, value), value, score });
  }

  return {
    market,
    sampleStamp: "SAMPLE",
    blurb: SAMPLE_BUSINESS_BLURB,
    health: {
      score: health.overall,
      label: health.displayLabel,
      pillars: health.pillars.map((pillar) => ({
        id: pillar.id,
        label: pillar.label,
        score: pillar.score,
        status: healthBandLabel(pillar.status),
      })),
    },
    ratios: shown,
  };
}

export type TrialReading = {
  grossMargin: string;
  netMargin: string;
  debtorDays: string;
  creditorDays: string;
  currentRatio: string;
  revenue: string;
  grossProfit: string;
  operatingExpenses: string;
  netProfit: string;
  cashOpening: string;
  cashLow: string;
  cashClose: string;
};

function ratioText(board: TrialBoard, name: string): string {
  return board.ratios.find((ratio) => ratio.name === name)?.display ?? "";
}

function stepText(profit: TrialProfit, label: string): string {
  return profit.steps.find((step) => step.label === label)?.display ?? "";
}

/** Ratios, margins, and the cash line. No health score. */
export function trialReading(board: TrialBoard, now = new Date()): TrialReading {
  const profit = buildTrialProfit(board.market);
  const cash = buildTrialCash(board.market, now);
  return {
    grossMargin: ratioText(board, "Gross Margin"),
    netMargin: ratioText(board, "Net Margin"),
    debtorDays: ratioText(board, "Debtor Days"),
    creditorDays: ratioText(board, "Creditor Days"),
    currentRatio: ratioText(board, "Current Ratio"),
    revenue: stepText(profit, "Revenue"),
    grossProfit: stepText(profit, "Gross profit"),
    operatingExpenses: stepText(profit, "Operating expenses"),
    netProfit: stepText(profit, "Net profit"),
    cashOpening: cash.openingDisplay,
    cashLow: cash.lowDisplay,
    cashClose: cash.weeks[cash.weeks.length - 1]?.closeDisplay ?? cash.lowDisplay,
  };
}

/**
 * Three findings from the sample's ratios, margins, and cash line.
 * Used only when the model key is missing. Same input, same sentences.
 * They do not restate the health score.
 */
export function deterministicTrialFindings(board: TrialBoard, now = new Date()): TrialFinding[] {
  const reading = trialReading(board, now);
  const findings: TrialFinding[] = [];

  if (reading.grossMargin && reading.netMargin && reading.revenue && reading.netProfit) {
    const expenses = reading.operatingExpenses
      ? ` Operating expenses are ${reading.operatingExpenses}, which leaves net profit of ${reading.netProfit}.`
      : ` Net profit is ${reading.netProfit}.`;
    findings.push({
      kind: "margin_compression",
      severity: "watch",
      title: `Gross margin is ${reading.grossMargin}, and net margin is ${reading.netMargin}.`,
      detail: `Revenue is ${reading.revenue} and gross profit is ${reading.grossProfit}.${expenses} The margin is made on the work, then given back in the cost of running the business.`,
    });
  }

  if (reading.debtorDays && reading.creditorDays && reading.currentRatio) {
    findings.push({
      kind: "working_capital_days",
      severity: "info",
      title: `Customers pay in ${reading.debtorDays}, and suppliers are paid in ${reading.creditorDays}.`,
      detail: `Current assets cover current liabilities ${reading.currentRatio} times. Collection days and payment days sit close together on this sample.`,
    });
  }

  if (reading.cashOpening && reading.cashClose) {
    findings.push({
      kind: "liquidity",
      severity: "watch",
      title: "Cash runway is not measured, because the sample has no cash balance.",
      detail: `The 13-week estimate opens at ${reading.cashOpening} and closes week 13 at ${reading.cashClose}. The low point is ${reading.cashLow}. It follows the monthly run-rate, and it is not a bank balance.`,
    });
  }

  return findings.slice(0, 3);
}

export function buildTrialProfit(market: TrialMarketId): TrialProfit {
  const financials = sampleFinancialsFor(market);
  const bridge = periodProfitBridge(financials);
  const statedNet = Number(financials.netIncome);
  const computed = bridge.ebit - bridge.interest - bridge.tax;
  const net =
    bridge.interestIsFact && bridge.taxIsFact
      ? computed
      : Number.isFinite(statedNet)
        ? statedNet
        : computed;
  const showDepreciation = Math.abs(bridge.depreciation) >= 0.5;
  const steps: TrialStep[] = [
    { label: "Revenue", display: money(bridge.revenue, market), kind: "total" },
    { label: "Cost of sales", display: money(bridge.cogs, market), kind: "decrease" },
    { label: "Gross profit", display: money(bridge.grossProfit, market), kind: "subtotal" },
    {
      label: "Operating expenses",
      display: money(bridge.operatingExpenses, market),
      kind: "decrease",
    },
  ];
  if (showDepreciation) {
    steps.push({
      label: "Depreciation",
      display: money(bridge.depreciation, market),
      kind: "decrease",
    });
  }
  steps.push(
    { label: "Operating profit", display: money(bridge.ebit, market), kind: "subtotal" },
    { label: "Interest", display: money(bridge.interest, market), kind: "decrease" },
    { label: "Tax", display: money(bridge.tax, market), kind: "decrease" },
    { label: "Net profit", display: money(net, market), kind: "subtotal" },
  );
  return { steps, netDisplay: money(net, market) };
}

export function buildTrialCash(market: TrialMarketId, now = new Date()): TrialCash {
  const financials = sampleFinancialsFor(market);
  const forecast = resolveThirteenWeekForecast({
    financials,
    openingCash: null,
    now,
  });
  const low = forecast.closing.reduce(
    (min, value) => (value < min ? value : min),
    forecast.closing[0] ?? forecast.opening,
  );
  return {
    openingDisplay: money(forecast.opening, market),
    weeks: forecast.weekDates.map((date, index) => ({
      week: index + 1,
      date,
      closeDisplay: money(forecast.closing[index] ?? 0, market),
    })),
    lowDisplay: money(low, market),
    note: "The sample has no cash balance, so this line opens at zero and follows the monthly run-rate. Estimated from the P&L. Not a bank balance.",
  };
}

export function gateErrorCopy(error: GateError): string {
  if (error === "name") return "Add your name.";
  if (error === "email") return "Add a valid email.";
  if (error === "consent") return "Tick the box to continue.";
  return "Complete the check above.";
}
