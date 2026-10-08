/**
 * Quoted days and margins in advisory copy. One formatter, shared with the
 * pack, so a stored sentence cannot keep 43.8 / 73 / 0.16 after live Ratios
 * already say 25 days, 37 days, and 8.6%.
 * Qualitative claims follow the same score bands as the Scorecard.
 */
import { overviewRatios, scoreRatio } from "./health-score.ts";
import { healthBandLabel, periodMonthsOf, scoreTier } from "./ratios.ts";

const DAYS_RATIOS = new Set([
  "Debtor Days",
  "Inventory Days",
  "Creditor Days",
  "Working Capital Days",
]);

const MULTIPLE_RATIOS = new Set([
  "Asset Turnover",
  "Equity Multiplier",
  "Degree of Operating Leverage",
  "Gross Profit / Labor",
  "OCF / EBITDA",
  "Debt-to-Equity",
  "Current Ratio",
]);

/** Days rounded, margins as percents. Sales-per-employee stays a plain number. */
export function formatSnapshotRatio(name: string, v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (DAYS_RATIOS.has(name)) return `${Math.round(v)} days`;
  if (MULTIPLE_RATIOS.has(name)) return `${v.toFixed(2)}×`;
  if (name === "Sales-per-Employee Ratio") return `${Math.round(v)}`;
  return `${(v * 100).toFixed(1)}%`;
}

type QuoteKind = "days" | "margin";

const LABEL_SPECS: ReadonlyArray<{ labels: string; name: string; kind: QuoteKind }> = [
  { labels: "debtor days|days sales outstanding|days AR|DSO", name: "Debtor Days", kind: "days" },
  {
    labels: "creditor days|days payable outstanding|days AP|DPO",
    name: "Creditor Days",
    kind: "days",
  },
  { labels: "operating margin|OM", name: "Operating Margin", kind: "margin" },
  { labels: "gross margin|GM", name: "Gross Margin", kind: "margin" },
];

function ratioValue(ratios: Record<string, number>, name: string): number | null {
  const value = ratios[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A hyphen or dash glued to another digit is a band ("30–60"), not a reading. */
function continuesRange(text: string, index: number): boolean {
  return /^[\u2013\u2014-]\d/.test(text.slice(index));
}

/**
 * Days agree on the rounded count. A margin agrees only when it is already
 * printed as a percent within 0.6 points — a bare fraction such as 0.16 is
 * rewritten even when it is 100× the ratio.
 */
function citationAgrees(
  cited: number,
  suffix: string | undefined,
  value: number,
  kind: QuoteKind,
): boolean {
  if (kind === "days") return Math.round(cited) === Math.round(value);
  if (!suffix?.includes("%")) return false;
  return Math.abs(cited - value * 100) <= 0.6;
}

function formattedQuote(name: string, value: number, kind: QuoteKind): string {
  if (kind === "days") return `${Math.round(value)} days`;
  return formatSnapshotRatio(name, value);
}

/** "43.8 / 73" after a debtor and creditor mention becomes the snapshot pair. */
function groundDayPair(text: string, ratios: Record<string, number>): string {
  const debtor = ratioValue(ratios, "Debtor Days");
  const creditor = ratioValue(ratios, "Creditor Days");
  if (debtor == null || creditor == null) return text;
  const debtorDays = Math.round(debtor);
  const creditorDays = Math.round(creditor);
  return text.replace(
    /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g,
    (full, leftRaw: string, rightRaw: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 80), offset).toLowerCase();
      const debtorAt = Math.max(
        before.lastIndexOf("debtor"),
        before.lastIndexOf("dso"),
        before.lastIndexOf("days ar"),
      );
      const creditorAt = Math.max(
        before.lastIndexOf("creditor"),
        before.lastIndexOf("dpo"),
        before.lastIndexOf("days ap"),
      );
      if (debtorAt < 0 || creditorAt < 0) return full;
      const leftIsDebtor = debtorAt <= creditorAt;
      const leftTarget = leftIsDebtor ? debtorDays : creditorDays;
      const rightTarget = leftIsDebtor ? creditorDays : debtorDays;
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      if (Math.round(left) === leftTarget && Math.round(right) === rightTarget) return full;
      return `${leftTarget} / ${rightTarget}`;
    },
  );
}

/** Words that may sit between a label and the figure it quotes. */
const LABEL_CONNECTOR = String.raw`(?:\s+(?:ratio|figure|reading|are|is|of|at|currently|about|around|now))*`;

function groundLabeled(text: string, ratios: Record<string, number>): string {
  let out = text;
  for (const spec of LABEL_SPECS) {
    const value = ratioValue(ratios, spec.name);
    if (value == null) continue;
    const formatted = formattedQuote(spec.name, value, spec.kind);
    const bareDays = spec.kind === "days" ? String(Math.round(value)) : formatted;
    // "debtor days ratio of 43.8" / "creditor days of 73" / "OM 0.16"
    const after = new RegExp(
      String.raw`(?<![\w/])(${spec.labels})\b(${LABEL_CONNECTOR}\s*[:=]?\s*)(\*\*)?(-?\d+(?:\.\d+)?)(\*\*)?(\s*(?:%|days?))?`,
      "gi",
    );
    out = out.replace(
      after,
      (
        full: string,
        label: string,
        mid: string,
        _open: string | undefined,
        num: string,
        _close: string | undefined,
        suffix: string | undefined,
        offset: number,
        whole: string,
      ) => {
        const cited = Number(num);
        if (!Number.isFinite(cited)) return full;
        const numberEnd = offset + full.lastIndexOf(num) + num.length;
        if (continuesRange(whole, numberEnd)) return full;
        if (citationAgrees(cited, suffix, value, spec.kind)) return full;
        return `${label}${mid}${formatted}`;
      },
    );
    // "43.8-day debtor days" / "At 73 creditor days" / "a 0.16 operating margin"
    // A signed delta ("−12 debtor days") is an impact, not the current reading.
    const before = new RegExp(
      String.raw`(?<![\w.%\u2013\u2014\u2212+-])(\*\*)?(\d+(?:\.\d+)?)(\*\*)?(\s*-\s*days?\s+|\s+days?\s+|\s*%\s+|\s+)(${spec.labels})\b`,
      "gi",
    );
    out = out.replace(
      before,
      (
        full: string,
        _open: string | undefined,
        num: string,
        _close: string | undefined,
        sep: string,
        label: string,
        offset: number,
        whole: string,
      ) => {
        const cited = Number(num);
        if (!Number.isFinite(cited)) return full;
        const numberStart = offset + full.indexOf(num);
        const numberEnd = numberStart + num.length;
        if (continuesRange(whole, numberEnd)) return full;
        const percentSep = sep.includes("%");
        if (citationAgrees(cited, percentSep ? "%" : undefined, value, spec.kind)) return full;
        const shown = spec.kind === "days" && /day/i.test(`${sep}${label}`) ? bareDays : formatted;
        const sepOut = shown.includes("%") ? sep.replace("%", "") : sep;
        return `${shown}${sepOut}${label}`;
      },
    );
  }
  return out;
}

/**
 * "Stretching payables significantly" is a critical-band claim. Days inside
 * the Scorecard healthy band (30–60, score 100) must not keep it after the
 * figure is rewritten from 73 to 37.
 */
function alignPayablesJudgment(text: string, ratios: Record<string, number>): string {
  if (!/stretching payables/i.test(text)) return text;
  const days = ratioValue(ratios, "Creditor Days");
  if (days == null) return text;
  const tier = scoreTier(scoreRatio("Creditor Days", days));
  const band = healthBandLabel(tier).toLowerCase();
  if (tier === "critical" && days > 60) return text;
  const phrase =
    tier === "healthy"
      ? "paying suppliers inside the healthy band"
      : days > 60
        ? `stretching payables past the ${band} band`
        : `paying suppliers faster than the ${band} band`;
  return text.replace(/stretching payables significantly/gi, phrase);
}

/**
 * Rewrite debtor/creditor day counts and gross/operating margin quotes so they
 * match `ratios`. Benchmark bands ("30–60") and horizons ("90 days") stay.
 * Text with no cited figure is returned unchanged. Payables wording follows
 * the same rating band as the Scorecard.
 */
export function groundAdvisoryNarrative(
  text: string,
  ratios: Record<string, number> | null | undefined,
): string {
  if (!text || !ratios) return text;
  return alignPayablesJudgment(groundLabeled(groundDayPair(text, ratios), ratios), ratios);
}

/**
 * Live Overview ratios for stored Brain prose. Null when there is no
 * financials file, so a missing snapshot does not rewrite the text.
 */
export function ratiosForBrainProse(
  financials: Record<string, unknown> | null | undefined,
  fyStartMonth?: number | null,
): Record<string, number> | null {
  if (!financials || typeof financials !== "object" || Array.isArray(financials)) return null;
  return overviewRatios(financials, {
    fyStartMonth,
    periodMonths: periodMonthsOf(financials),
  });
}

const BRAIN_PROSE_KEYS = ["headline", "body", "summary"] as const;

/**
 * Rewrite ratio citations in a stored brain_summary so the Books summary
 * and the Bot quote the live Overview figures. Other fields stay as stored.
 */
export function groundBrainSummaryRecord(
  raw: unknown,
  ratios: Record<string, number> | null | undefined,
): unknown {
  if (!ratios) return raw;
  if (typeof raw === "string") return groundAdvisoryNarrative(raw, ratios);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  for (const key of BRAIN_PROSE_KEYS) {
    if (typeof out[key] === "string") out[key] = groundAdvisoryNarrative(out[key], ratios);
  }
  if (Array.isArray(out.bullets)) {
    out.bullets = out.bullets.map((item) =>
      typeof item === "string" ? groundAdvisoryNarrative(item, ratios) : item,
    );
  }
  return out;
}
