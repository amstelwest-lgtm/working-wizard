/**
 * Statement-type field map for CSV / spreadsheet text.
 *
 * A balance sheet must not fill P&L fields, and a P&L must not fill balance
 * sheet fields. Matching is whole-phrase, so "debt" cannot become EBT and
 * "Cash and cash equivalents" lands on cash. Fixed costs are taken only from
 * a line that says so — rent, salaries and insurance are not summed.
 */

export type StatementKind = "income_statement" | "balance_sheet" | "mixed" | "unknown";

export type StatementMeta = {
  kind: StatementKind;
  companyName: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  periodMonths: number | null;
  currency: "ZAR" | "USD" | "EUR" | "GBP" | "other" | null;
  /** Flat keys that were calculated (EBITDA = EBIT + depreciation). */
  derived: string[];
};

export type ParsedStatement = StatementMeta & {
  fields: Record<string, string>;
};

const INCOME_KEYS = [
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
] as const;

const BALANCE_KEYS = [
  "cash",
  "receivables",
  "inventory",
  "payables",
  "totalAssets",
  "equity",
  "currentAssets",
  "currentLiabilities",
  "totalLiabilities",
  "fixedAssets",
  "shortTermDebt",
  "longTermDebt",
] as const;

const SHARED_KEYS = ["employees", "founderHours", "operatingCashflow"] as const;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Alias = { field: string; phrase: string; rank: number; exact?: boolean };

const ALIASES: Alias[] = [
  { field: "skip", phrase: "total liabilities and equity", rank: 200 },
  { field: "skip", phrase: "total equity and liabilities", rank: 200 },
  { field: "skip", phrase: "retained earnings", rank: 120 },
  { field: "skip", phrase: "accumulated depreciation", rank: 120 },
  { field: "skip", phrase: "prepaid expenses", rank: 80 },
  { field: "skip", phrase: "accrued liabilities", rank: 80 },
  { field: "skip", phrase: "other operating expenses", rank: 80 },
  { field: "skip", phrase: "total operating expenses", rank: 90 },

  { field: "revenue", phrase: "total revenue", rank: 90 },
  { field: "revenue", phrase: "total turnover", rank: 90 },
  { field: "revenue", phrase: "net sales", rank: 85 },
  { field: "revenue", phrase: "revenue", rank: 70 },
  { field: "revenue", phrase: "turnover", rank: 70 },
  { field: "revenue", phrase: "sales", rank: 40 },

  { field: "cogs", phrase: "cost of goods sold", rank: 90 },
  { field: "cogs", phrase: "cost of sales", rank: 90 },
  { field: "cogs", phrase: "cost of revenue", rank: 80 },
  { field: "cogs", phrase: "direct costs", rank: 60 },

  { field: "grossProfit", phrase: "gross profit", rank: 90 },
  { field: "grossProfit", phrase: "gross margin", rank: 40 },

  { field: "ebit", phrase: "operating income", rank: 95 },
  { field: "ebit", phrase: "operating profit", rank: 90 },
  { field: "ebit", phrase: "profit from operations", rank: 85 },
  { field: "ebit", phrase: "ebit", rank: 70, exact: true },

  { field: "ebitda", phrase: "ebitda", rank: 95, exact: true },

  { field: "ebt", phrase: "profit before tax", rank: 95 },
  { field: "ebt", phrase: "income before tax", rank: 95 },
  { field: "ebt", phrase: "profit before income tax", rank: 95 },
  { field: "ebt", phrase: "earnings before tax", rank: 90 },
  { field: "ebt", phrase: "ebt", rank: 70, exact: true },

  { field: "tax", phrase: "income tax expense", rank: 90 },
  { field: "tax", phrase: "income tax", rank: 80 },
  { field: "tax", phrase: "tax expense", rank: 80 },
  { field: "tax", phrase: "taxation", rank: 70 },

  { field: "netIncome", phrase: "profit after tax", rank: 90 },
  { field: "netIncome", phrase: "profit for the year", rank: 80 },
  { field: "netIncome", phrase: "profit for the period", rank: 80 },
  { field: "netIncome", phrase: "net income", rank: 90 },
  { field: "netIncome", phrase: "net profit", rank: 85 },

  { field: "interestExpense", phrase: "interest expense", rank: 95 },
  { field: "interestExpense", phrase: "interest paid", rank: 85 },
  { field: "interestExpense", phrase: "finance costs", rank: 70 },

  { field: "depreciation", phrase: "depreciation and amortisation", rank: 90 },
  { field: "depreciation", phrase: "depreciation and amortization", rank: 90 },
  { field: "depreciation", phrase: "depreciation", rank: 60 },

  { field: "laborCost", phrase: "salaries and wages", rank: 95 },
  { field: "laborCost", phrase: "salary and wages", rank: 90 },
  { field: "laborCost", phrase: "employee costs", rank: 80 },
  { field: "laborCost", phrase: "staff costs", rank: 80 },
  { field: "laborCost", phrase: "personnel costs", rank: 75 },
  { field: "laborCost", phrase: "payroll", rank: 70 },

  { field: "fixedCosts", phrase: "fixed costs", rank: 90 },
  { field: "fixedCosts", phrase: "fixed overheads", rank: 85 },
  { field: "fixedCosts", phrase: "fixed overhead", rank: 85 },
  { field: "fixedCosts", phrase: "fixed expenses", rank: 80 },
  { field: "variableCosts", phrase: "variable costs", rank: 80 },
  { field: "variableCosts", phrase: "variable expenses", rank: 75 },

  { field: "cash", phrase: "cash and cash equivalents", rank: 100 },
  { field: "cash", phrase: "cash & cash equivalents", rank: 100 },
  { field: "cash", phrase: "cash at bank and in hand", rank: 100 },
  { field: "cash", phrase: "cash at bank", rank: 95 },
  { field: "cash", phrase: "cash on hand", rank: 90 },
  { field: "cash", phrase: "petty cash", rank: 70 },
  { field: "cash", phrase: "cash", rank: 75, exact: true },
  { field: "cash", phrase: "bank", rank: 60, exact: true },

  { field: "receivables", phrase: "trade and other receivables", rank: 95 },
  { field: "receivables", phrase: "accounts receivable", rank: 90 },
  { field: "receivables", phrase: "trade receivables", rank: 90 },
  { field: "receivables", phrase: "debtors", rank: 70 },

  { field: "inventory", phrase: "inventories", rank: 80 },
  { field: "inventory", phrase: "inventory", rank: 80 },
  { field: "inventory", phrase: "stock", rank: 50, exact: true },

  { field: "payables", phrase: "trade and other payables", rank: 95 },
  { field: "payables", phrase: "accounts payable", rank: 90 },
  { field: "payables", phrase: "trade payables", rank: 90 },
  { field: "payables", phrase: "creditors", rank: 70 },

  { field: "currentAssets", phrase: "total current assets", rank: 90 },
  { field: "fixedAssets", phrase: "property and equipment net", rank: 95 },
  { field: "fixedAssets", phrase: "property plant and equipment", rank: 90 },
  { field: "fixedAssets", phrase: "property and equipment", rank: 80 },
  { field: "fixedAssets", phrase: "fixed assets", rank: 85 },
  { field: "totalAssets", phrase: "total assets", rank: 90 },

  { field: "currentLiabilities", phrase: "total current liabilities", rank: 90 },
  { field: "totalLiabilities", phrase: "total liabilities", rank: 80 },
  { field: "shortTermDebt", phrase: "current portion of long term debt", rank: 100 },
  { field: "shortTermDebt", phrase: "current portion of long-term debt", rank: 100 },
  { field: "shortTermDebt", phrase: "short term debt", rank: 80 },
  { field: "shortTermDebt", phrase: "short-term borrowings", rank: 80 },
  { field: "longTermDebt", phrase: "long term debt", rank: 70 },
  { field: "longTermDebt", phrase: "long-term debt", rank: 70 },

  { field: "equity", phrase: "total shareholders equity", rank: 100 },
  { field: "equity", phrase: "total stockholders equity", rank: 100 },
  { field: "equity", phrase: "total equity", rank: 100 },
  { field: "equity", phrase: "shareholders equity", rank: 85 },
  { field: "equity", phrase: "stockholders equity", rank: 85 },
  { field: "equity", phrase: "owners equity", rank: 40 },
  { field: "equity", phrase: "equity", rank: 50, exact: true },

  { field: "operatingCashflow", phrase: "net cash from operating", rank: 90 },
  { field: "operatingCashflow", phrase: "cash from operating activities", rank: 90 },
  { field: "operatingCashflow", phrase: "cash generated from operations", rank: 85 },
  { field: "employees", phrase: "number of employees", rank: 80 },
  { field: "employees", phrase: "total employees", rank: 80 },
  { field: "employees", phrase: "headcount", rank: 70 },
];

const EBT_LINE =
  /\b(profit before tax|income before tax|profit before income tax|earnings before tax|ebt)\b/i;

export function statementKindFromMetadata(meta: {
  document_type?: string | null;
  contains_income_statement?: boolean | null;
  contains_balance_sheet?: boolean | null;
} | null | undefined): StatementKind {
  if (!meta) return "unknown";
  if (meta.document_type === "balance_sheet") return "balance_sheet";
  if (meta.document_type === "income_statement") return "income_statement";
  const income = Boolean(meta.contains_income_statement);
  const balance = Boolean(meta.contains_balance_sheet);
  if (
    meta.document_type === "full_annual_financials" ||
    meta.document_type === "management_accounts"
  ) {
    if (income && !balance) return "income_statement";
    if (balance && !income) return "balance_sheet";
    return "mixed";
  }
  if (income && balance) return "mixed";
  if (balance) return "balance_sheet";
  if (income) return "income_statement";
  return "unknown";
}

function allowedKeys(kind: StatementKind): Set<string> {
  if (kind === "balance_sheet") return new Set([...BALANCE_KEYS, ...SHARED_KEYS]);
  if (kind === "income_statement") return new Set([...INCOME_KEYS, ...SHARED_KEYS]);
  return new Set([...INCOME_KEYS, ...BALANCE_KEYS, ...SHARED_KEYS]);
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function phraseHit(label: string, phrase: string, exact = false): boolean {
  const left = norm(label);
  const right = norm(phrase);
  if (!left || !right) return false;
  if (exact || left === right) return left === right;
  return ` ${left} `.includes(` ${right} `);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if ((ch === "," || ch === "\t" || ch === ";") && !quoted) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter((cell) => cell.length > 0);
}

function parseAmount(raw: string): number | null {
  const matches = raw.match(/[-−(]?\d[\d ,]*(?:\.\d+)?[)]?/g);
  if (!matches) return null;
  const token = matches[matches.length - 1]
    .replace(/[, ]/g, "")
    .replace(/\(([^)]+)\)/, "-$1")
    .replace("−", "-");
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function monthIndex(name: string): number | null {
  const n = norm(name);
  const idx = MONTHS.findIndex((m) => m === n || m.startsWith(n));
  if (idx < 0 || n.length < 3) return null;
  return idx;
}

function iso(year: number, month: number, day: number): string {
  const dt = new Date(Date.UTC(year, month, day));
  return dt.toISOString().slice(0, 10);
}

function endOfMonth(year: number, month: number): string {
  return iso(year, month + 1, 0);
}

function parsePeriod(text: string): {
  label: string | null;
  start: string | null;
  end: string | null;
  months: number | null;
} {
  const range = text.match(
    /\b([A-Za-z]+)\s*(?:-|–|—|to)\s*([A-Za-z]+)\s+(\d{4})\b/,
  );
  if (range) {
    const startMonth = monthIndex(range[1]);
    const endMonth = monthIndex(range[2]);
    const year = Number(range[3]);
    if (startMonth != null && endMonth != null && endMonth >= startMonth) {
      const months = endMonth - startMonth + 1;
      return {
        label: `${MONTH_SHORT[startMonth]}–${MONTH_SHORT[endMonth]} ${year}`,
        start: iso(year, startMonth, 1),
        end: endOfMonth(year, endMonth),
        months,
      };
    }
  }
  const asOf = text.match(
    /\b(?:as of\s+)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (asOf) {
    const month = monthIndex(asOf[1]);
    const day = Number(asOf[2]);
    const year = Number(asOf[3]);
    if (month != null && day >= 1 && day <= 31) {
      return {
        label: `As of ${day} ${MONTH_SHORT[month]} ${year}`,
        start: null,
        end: iso(year, month, day),
        months: null,
      };
    }
  }
  const dmy = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = monthIndex(dmy[2]);
    const year = Number(dmy[3]);
    if (month != null && day >= 1 && day <= 31) {
      return {
        label: `As of ${day} ${MONTH_SHORT[month]} ${year}`,
        start: null,
        end: iso(year, month, day),
        months: null,
      };
    }
  }
  return { label: null, start: null, end: null, months: null };
}

function titleKind(text: string): StatementKind | null {
  const n = norm(text);
  const income = /\b(profit and loss|income statement|statement of profit|profit loss)\b/.test(n);
  const balance = /\b(balance sheet|statement of financial position)\b/.test(n);
  if (income && balance) return "mixed";
  if (income) return "income_statement";
  if (balance) return "balance_sheet";
  return null;
}

function currencyOf(text: string): StatementMeta["currency"] {
  const n = text.toUpperCase();
  if (/\bUSD\b|US\$|\$/.test(n)) return "USD";
  if (/\bZAR\b|\bRAND\b/.test(n)) return "ZAR";
  if (/\bEUR\b|€/.test(n)) return "EUR";
  if (/\bGBP\b|£/.test(n)) return "GBP";
  return null;
}

function bestAlias(label: string): { field: string; rank: number } | null {
  let best: { field: string; rank: number; score: number } | null = null;
  for (const alias of ALIASES) {
    if (!phraseHit(label, alias.phrase, alias.exact)) continue;
    const score = norm(alias.phrase).length * 1000 + alias.rank;
    if (!best || score > best.score) best = { field: alias.field, rank: alias.rank, score };
  }
  return best ? { field: best.field, rank: best.rank } : null;
}

function lineLabel(line: string): string {
  return line.replace(/[-−(]?\d[\d ,]*(?:\.\d+)?[)]?/g, " ");
}

export function parseStatementText(text: string): ParsedStatement {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^---\s*sheet:/i.test(line));

  let kind: StatementKind = "unknown";
  let companyName: string | null = null;
  let period = parsePeriod(lines.slice(0, 4).join(" "));
  let currency = currencyOf(lines.slice(0, 6).join(" "));

  if (lines[0]) {
    const cells = splitCsvLine(lines[0]);
    const titled = titleKind(cells[0] ?? lines[0]);
    if (titled) {
      kind = titled;
      if (cells[1] && !parseAmount(cells[1]) && !titleKind(cells[1])) companyName = cells[1];
      const periodCell = cells.slice(2).join(" ");
      const parsed = parsePeriod(periodCell || lines[0]);
      if (parsed.label) period = parsed;
    }
  }
  if (!companyName) {
    for (const line of lines.slice(0, 3)) {
      const cells = splitCsvLine(line);
      if (cells.length >= 2 && titleKind(cells[0]) && !parseAmount(cells[1])) {
        companyName = cells[1];
        break;
      }
    }
  }

  const found = new Map<string, { amount: number; rank: number }>();
  for (const line of lines) {
    const amount = parseAmount(line);
    if (amount == null) continue;
    const label = lineLabel(line);
    if (norm(label) === "account" || norm(label) === "amount") continue;
    const hit = bestAlias(label);
    if (!hit || hit.field === "skip") continue;
    const prev = found.get(hit.field);
    if (!prev || hit.rank > prev.rank) found.set(hit.field, { amount, rank: hit.rank });
  }

  const derived: string[] = [];
  if (!found.has("ebitda") && found.has("ebit") && found.has("depreciation")) {
    found.set("ebitda", {
      amount: found.get("ebit")!.amount + found.get("depreciation")!.amount,
      rank: 10,
    });
    derived.push("ebitda");
  }

  const incomeHit = INCOME_KEYS.some((key) => found.has(key));
  const balanceHit = BALANCE_KEYS.some((key) => found.has(key));
  if (kind === "unknown") {
    if (incomeHit && balanceHit) kind = "mixed";
    else if (balanceHit) kind = "balance_sheet";
    else if (incomeHit) kind = "income_statement";
  }

  const allowed = allowedKeys(kind);
  const fields: Record<string, string> = {};
  for (const [key, row] of found) {
    if (!allowed.has(key)) continue;
    fields[key] = formatAmount(row.amount);
  }

  return {
    kind,
    companyName,
    periodLabel: period.label,
    periodStart: period.start,
    periodEnd: period.end,
    periodMonths: period.months,
    currency,
    derived: derived.filter((key) => key in fields),
    fields,
  };
}

/**
 * Parser wins. Model output may fill a gap only inside the statement's own
 * fields. EBT is kept only when the text actually has a profit-before-tax
 * line. Fixed costs are never invented from other expense lines.
 */
export function mergeStatementFields(
  parsed: ParsedStatement,
  ai: Record<string, string>,
  text = "",
): Record<string, string> {
  const allowed = allowedKeys(parsed.kind);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.fields)) {
    if (allowed.has(key) && value.trim()) out[key] = value;
  }
  const ebtAllowed = EBT_LINE.test(text) || Boolean(parsed.fields.ebt);
  for (const [key, value] of Object.entries(ai)) {
    if (!value?.trim() || out[key] || !allowed.has(key)) continue;
    if (key === "fixedCosts") continue;
    if (key === "ebt" && !ebtAllowed) continue;
    out[key] = value;
  }
  return out;
}

const INCOME_SECTION_KEYS = [
  "revenue",
  "cogs",
  "gross_profit",
  "other_income",
  "fixed_costs",
  "labor_cost",
  "depreciation",
  "amortisation",
  "depreciation_amortisation_total",
  "ebitda",
  "ebit",
  "interest_expense",
  "interest_income",
  "ebt",
  "tax",
  "net_income",
  "director_remuneration",
  "dividends_declared",
] as const;

const BALANCE_SECTION_KEYS = [
  "total_assets",
  "fixed_assets",
  "goodwill",
  "intangible_assets",
  "right_of_use_assets",
  "current_assets",
  "inventory",
  "wip",
  "debtors",
  "provision_bad_debts",
  "cash",
  "other_current_assets",
  "total_liabilities",
  "current_liabilities",
  "creditors",
  "short_term_debt",
  "lease_liabilities_current",
  "other_current_liabilities",
  "non_current_liabilities",
  "long_term_debt",
  "lease_liabilities_non_current",
  "deferred_tax_liability",
  "deferred_tax_asset",
  "equity",
  "share_capital",
  "retained_earnings_opening",
  "retained_earnings_closing",
  "shareholder_loans_asset",
  "shareholder_loans_liability",
  "contingent_liabilities_notes",
] as const;

/** Drop P&L numbers from a balance-sheet document, and the reverse. */
export function blankDisallowedSections<T extends {
  document_metadata: {
    document_type?: string | null;
    contains_income_statement?: boolean | null;
    contains_balance_sheet?: boolean | null;
  };
  current_period: {
    income_statement: object;
    balance_sheet: object;
  };
}>(raw: T): T {
  const kind = statementKindFromMetadata(raw.document_metadata);
  if (kind !== "balance_sheet" && kind !== "income_statement") return raw;
  const copy = JSON.parse(JSON.stringify(raw)) as T;
  if (kind === "balance_sheet") {
    const income = copy.current_period.income_statement as Record<string, unknown>;
    for (const key of INCOME_SECTION_KEYS) income[key] = null;
    copy.document_metadata.contains_income_statement = false;
  } else {
    const balance = copy.current_period.balance_sheet as Record<string, unknown>;
    for (const key of BALANCE_SECTION_KEYS) balance[key] = null;
    copy.document_metadata.contains_balance_sheet = false;
  }
  return copy;
}
