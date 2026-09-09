/**
 * Accountant-facing statement notes after a financial-statement upload.
 * Built from extracted fields only — never invents figures, never names a vendor.
 */

import type { ExtractionResult, Money } from "@/lib/financialSchema";

export type StatementNoteSection = {
  title: string;
  items: string[];
};

const BASIS_LABEL: Record<NonNullable<ExtractionResult["statement_basis"]>, string> = {
  audited: "Audited",
  independently_reviewed: "Independently reviewed",
  compiled: "Compiled",
  management_accounts: "Management accounts",
  unknown: "Unknown",
};

const UNITS_LABEL: Record<NonNullable<ExtractionResult["units"]>, string> = {
  actual: "as printed",
  thousands: "in thousands",
  millions: "in millions",
};

const KEY_FIGURES: Array<{ label: string; get: (r: ExtractionResult) => Money }> = [
  { label: "Revenue", get: (r) => r.current_period.figures.income_statement.revenue },
  { label: "Gross profit", get: (r) => r.current_period.figures.income_statement.gross_profit },
  {
    label: "Operating profit",
    get: (r) => r.current_period.figures.income_statement.operating_profit,
  },
  {
    label: "Profit after tax",
    get: (r) => r.current_period.figures.income_statement.profit_after_tax,
  },
  { label: "Total assets", get: (r) => r.current_period.figures.balance_sheet.total_assets },
  { label: "Total equity", get: (r) => r.current_period.figures.balance_sheet.equity.total },
  {
    label: "Total liabilities",
    get: (r) => r.current_period.figures.balance_sheet.total_liabilities,
  },
  {
    label: "Cash",
    get: (r) => r.current_period.figures.balance_sheet.current_assets.cash_and_cash_equivalents,
  },
  {
    label: "Cash from operating",
    get: (r) => r.current_period.figures.cash_flow?.cash_from_operating ?? null,
  },
];

const VENDOR_NAME = /\b(claude|anthropic|chatgpt|openai|gemini|gpt-?\d*)\b/gi;

function isMoney(v: Money): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function hasMoney(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object") return Object.values(value).some(hasMoney);
  return false;
}

/** Drop vendor/model names the model may have written into extraction_notes. */
export function sanitiseExtractionNote(text: string): string {
  return text
    .replace(VENDOR_NAME, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function noteBullets(text: string | null): string[] {
  if (!text) return [];
  const cleaned = sanitiseExtractionNote(text);
  if (!cleaned) return [];
  return cleaned
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

export function statementNoteSections(
  result: ExtractionResult,
  formatNumber: (n: number) => string,
): StatementNoteSection[] {
  const is = result.current_period.figures.income_statement;
  const bs = result.current_period.figures.balance_sheet;
  const cf = result.current_period.figures.cash_flow;
  const sections: StatementNoteSection[] = [];

  const period: string[] = [];
  if (result.current_period.period_end)
    period.push(`Period end: ${result.current_period.period_end}`);
  if (result.comparative_period?.period_end) {
    period.push(`Comparative: ${result.comparative_period.period_end}`);
  }
  if (result.statement_basis && result.statement_basis !== "unknown") {
    period.push(`Basis: ${BASIS_LABEL[result.statement_basis]}`);
  }
  if (result.currency) period.push(`Currency: ${result.currency}`);
  if (result.units) period.push(`Scale: ${UNITS_LABEL[result.units]}`);
  if (period.length) sections.push({ title: "Period", items: period });

  const read: string[] = [];
  if (hasMoney(is)) read.push("Income statement");
  if (hasMoney(bs)) read.push("Balance sheet");
  if (hasMoney(cf)) read.push("Cash flow statement");
  if (hasMoney(result.comparative_period?.figures)) read.push("Comparative period");
  if (read.length) sections.push({ title: "What was read", items: read });

  const figures: string[] = [];
  for (const field of KEY_FIGURES) {
    const value = field.get(result);
    if (isMoney(value)) figures.push(`${field.label}: ${formatNumber(value)}`);
  }
  if (figures.length) sections.push({ title: "Key figures", items: figures });

  const gaps: string[] = [];
  if (!result.current_period.period_end) gaps.push("Period end not in the file.");
  if (!hasMoney(is)) gaps.push("Income statement not in the file.");
  if (!hasMoney(bs)) gaps.push("Balance sheet not in the file.");
  if (!hasMoney(cf)) gaps.push("Cash flow statement not in the file.");
  if (!hasMoney(result.comparative_period?.figures)) {
    gaps.push("Comparative period not in the file.");
  }
  gaps.push(...noteBullets(result.extraction_notes));
  if (gaps.length) sections.push({ title: "Gaps", items: gaps });

  return sections;
}
