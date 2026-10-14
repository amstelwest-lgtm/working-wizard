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

/** Model call, or the deterministic findings when the cap or key is missing. */
export function trialAnalystMode(input: {
  runsToday: number;
  cap: number;
  aiConfigured: boolean;
}): "model" | "deterministic" {
  if (!input.aiConfigured) return "deterministic";
  if (input.runsToday >= input.cap) return "deterministic";
  return "model";
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

function severityFor(score: number): TrialFinding["severity"] {
  if (score < 40) return "act";
  if (score < 80) return "watch";
  return "info";
}

function kindForRatio(name: string, score: number): string {
  if (DAY_RATIOS.has(name)) return "working_capital_days";
  if (name.includes("Margin")) return score < 50 ? "margin_compression" : "margin_improvement";
  if (name.includes("Debt") || name.includes("Equity Multiplier")) return "leverage";
  if (name === "Current Ratio") return "liquidity";
  if (name.includes("Cost")) return "cost_ratio";
  return "other";
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

/** Three findings from the scored sample. Same input, same sentences. */
export function deterministicTrialFindings(board: TrialBoard): TrialFinding[] {
  const pillars = board.health.pillars.filter(
    (pillar): pillar is TrialPillar & { score: number } =>
      typeof pillar.score === "number" && Number.isFinite(pillar.score),
  );
  const weakest = [...pillars].sort((a, b) => a.score - b.score)[0];
  const worstRatio = [...board.ratios].sort((a, b) => a.score - b.score)[0];
  const findings: TrialFinding[] = [];

  if (weakest) {
    findings.push({
      kind: "weakest_pillar",
      severity: severityFor(weakest.score),
      title: `${weakest.label} is the weakest pillar on this sample, at ${Math.round(weakest.score)}.`,
      detail: `${weakest.label} scores ${Math.round(weakest.score)} (${weakest.status}). It is the lowest of the four pillars on these sample figures.`,
    });
  }

  if (worstRatio) {
    findings.push({
      kind: kindForRatio(worstRatio.name, worstRatio.score),
      severity: severityFor(worstRatio.score),
      title: `${worstRatio.name} on the sample is ${worstRatio.display}.`,
      detail: `${worstRatio.name} is ${worstRatio.display}, which scores ${Math.round(worstRatio.score)} on the same scale as the health pillars.`,
    });
  }

  const overall = board.health.score;
  findings.push({
    kind: "other",
    severity: overall == null ? "info" : severityFor(overall),
    title:
      overall == null
        ? "The sample does not have enough figures for a health score."
        : `The sample health score is ${Math.round(overall)}, ${board.health.label}.`,
    detail:
      overall == null
        ? "No pillar could be scored from the sample figures."
        : `Overall health is ${Math.round(overall)} (${board.health.label}), an equal average of the pillars that could be scored. These are sample figures.`,
  });

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
