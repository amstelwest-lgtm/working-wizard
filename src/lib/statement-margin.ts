/**
 * Statement margins are stored as fractions (0.6 = 60%). Overview, Ask AI,
 * and Client Brain all print them through here so a draft cannot say 0.6
 * while the briefing says 60.0%.
 */

export type StatementFigureFacts = {
  grossMargin?: number | null;
  operatingMargin?: number | null;
  /** Shown with gross and operating when the ratio engine has a net margin. */
  netMargin?: number | null;
  periodLabel?: string | null;
};

export type StatementFigureLine = {
  key: "gross" | "operating" | "net";
  label: string;
  value: string;
};

/**
 * The margin lines Overview prints, in the same order, plus net when it exists.
 * Client Brain renders these in the summary viewport. Hidden tab panes are not
 * a substitute — an accountant on `?tab=summary` has to see the percentages.
 */
export function visibleStatementFigures(
  facts: StatementFigureFacts | null | undefined,
): StatementFigureLine[] {
  const lines: StatementFigureLine[] = [];
  const gross = formatStatementMargin(facts?.grossMargin);
  const operating = formatStatementMargin(facts?.operatingMargin);
  const net = formatStatementMargin(facts?.netMargin);
  if (gross) lines.push({ key: "gross", label: "Gross margin", value: gross });
  if (operating) lines.push({ key: "operating", label: "Operating margin", value: operating });
  if (net) lines.push({ key: "net", label: "Net margin", value: net });
  return lines;
}

const MARGIN_NAMES = new Set(["grossmargin", "operatingmargin", "netmargin", "gm", "om"]);

function compactName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

export function isStatementMarginName(name: string): boolean {
  return MARGIN_NAMES.has(compactName(name));
}

/**
 * Fraction 0.6 → "60.0%". A value already on the percent scale (|n| > 1.5)
 * is not scaled again, so 60 stays 60.0%.
 */
export function formatStatementMargin(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const pct = Math.abs(value) <= 1.5 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

export function ratioPromptLines(raw: unknown, limit = 16): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    if (isStatementMarginName(key)) {
      const shown = formatStatementMargin(val);
      if (shown) out.push(`${key}: ${shown}`);
    } else {
      out.push(`${key}: ${val}`);
    }
    if (out.length >= limit) break;
  }
  return out;
}

function readRatio(ratios: Record<string, unknown>, names: string[]): number | null {
  const wanted = new Set(names.map(compactName));
  for (const [key, val] of Object.entries(ratios)) {
    if (!wanted.has(compactName(key))) continue;
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return null;
}

/** Lines the model must quote instead of inventing a fraction or a benchmark. */
export function quotedStatementFigures(input: {
  ratios?: Record<string, unknown> | null;
  periodLabel?: string | null;
}): string[] {
  const ratios = input.ratios ?? {};
  const lines: string[] = [];
  const period = input.periodLabel?.trim();
  if (period) {
    lines.push(`Statement period: ${period}. Cite this period. Do not write Period not dated.`);
  }
  const gross = formatStatementMargin(
    readRatio(ratios, ["Gross Margin", "grossMargin", "gm"]),
  );
  const operating = formatStatementMargin(
    readRatio(ratios, ["Operating Margin", "operatingMargin", "om"]),
  );
  if (gross) {
    lines.push(
      `Gross margin: ${gross}. Quote this percentage exactly. Do not write it as a fraction.`,
    );
  }
  if (operating) {
    lines.push(
      `Operating margin: ${operating}. Quote this percentage exactly. Do not substitute a benchmark.`,
    );
  }
  return lines;
}

export const STATEMENT_FIGURE_RULES = [
  "- Gross margin and operating margin are printed as percentages (60.0% means sixty percent). Copy that percentage. Never write a fraction such as 0.6, and never substitute a benchmark for the operating margin on file.",
  "- If a statement period is given, cite it. Do not write Period not dated.",
];

/**
 * Rewrite stored GAP / draft copy so it matches the live Overview snapshot.
 * Existing drafts keep their wording except the margin figures and an undated
 * period line.
 */
export function alignBrainFigureCopy(text: string, facts: StatementFigureFacts): string {
  if (!text) return text;
  let out = text;
  const gross = formatStatementMargin(facts.grossMargin);
  const operating = formatStatementMargin(facts.operatingMargin);
  if (gross) {
    out = out.replace(
      /(gross margin)(\s+of\s+)(\*\*)?-?\d+(?:\.\d+)?(?:\s*%)?(\*\*)?/gi,
      `$1$2$3${gross}$4`,
    );
  }
  if (operating) {
    out = out.replace(
      /(operating margin)(\s+of\s+)(\*\*)?-?\d+(?:\.\d+)?(?:\s*%)?(\*\*)?/gi,
      `$1$2$3${operating}$4`,
    );
  }
  const period = facts.periodLabel?.trim();
  if (period) out = out.replace(/period not dated/gi, period);
  return out;
}
