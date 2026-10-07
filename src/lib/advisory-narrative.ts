/**
 * Quoted days and margins in advisory copy. One formatter, shared with the
 * pack ratio block, so a stored sentence cannot keep an older 43.8 / 0.16
 * after the snapshot already says 25 days and 8.6%.
 */

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

function citationAgrees(
  cited: number,
  suffix: string | undefined,
  value: number,
  kind: QuoteKind,
): boolean {
  if (kind === "days") return Math.round(cited) === Math.round(value);
  const asPercent = Boolean(suffix?.includes("%")) || Math.abs(cited) > 1.5;
  const citedPct = asPercent ? cited : cited * 100;
  return Math.abs(citedPct - value * 100) <= 0.6;
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

function groundLabeled(text: string, ratios: Record<string, number>): string {
  let out = text;
  for (const spec of LABEL_SPECS) {
    const value = ratioValue(ratios, spec.name);
    if (value == null) continue;
    const formatted = formattedQuote(spec.name, value, spec.kind);
    const re = new RegExp(
      String.raw`(?<![\w/])(${spec.labels})\b(\s*(?:are|is|of|at)?\s*[:=]?\s*)(-?\d+(?:\.\d+)?)(\s*(?:%|days))?`,
      "gi",
    );
    out = out.replace(re, (full, label: string, mid: string, num: string, suffix?: string) => {
      const cited = Number(num);
      if (!Number.isFinite(cited) || citationAgrees(cited, suffix, value, spec.kind)) return full;
      return `${label}${mid}${formatted}`;
    });
  }
  return out;
}

/**
 * Rewrite debtor/creditor day counts and gross/operating margin quotes so they
 * match `ratios`. Benchmark bands ("30–60") and horizons ("90 days") stay.
 * Text with no cited figure is returned unchanged.
 */
export function groundAdvisoryNarrative(
  text: string,
  ratios: Record<string, number> | null | undefined,
): string {
  if (!text || !ratios) return text;
  return groundLabeled(groundDayPair(text, ratios), ratios);
}
