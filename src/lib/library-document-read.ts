/**
 * Bot-readable body of a Client library upload.
 * Stored on client_artifacts.meta. No new table.
 * A bank statement is cash context (transactions and balances). It does not
 * have to match a P&L extract or a ledger bill proposal.
 * Figure drafts are not saved. The Financial Manager proposes; a person confirms.
 */

import { applyRedaction, createRedactionSession } from "./redact-identifiers.ts";

export const LIBRARY_READ_TEXT_MAX = 12_000;
export const LIBRARY_READ_TX_MAX = 80;

export type LibraryTransaction = {
  date: string | null;
  description: string;
  amount: number;
  balance: number | null;
};

export type LibraryStatementRead = {
  kind: "bank_statement";
  period_start: string | null;
  period_end: string | null;
  currency: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  money_in: number;
  money_out: number;
  transaction_count: number;
  transactions: LibraryTransaction[];
};

export type LibraryReadStatus = "read" | "unreadable";

export type LibraryRead = {
  status: LibraryReadStatus;
  text: string | null;
  statement: LibraryStatementRead | null;
  summary: string;
};

export type LibraryFigureDraft = {
  surface: "cash" | "waterfall";
  patch: Record<string, string | number>;
  reason: string;
  applied: false;
  requires_human_approval: true;
};

const DATE_TOKEN =
  /(\d{4}-\d{2}-\d{2}|\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4})/i;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Day-first when the numbers are ambiguous. South Africa is the product default. */
export function parseStatementDate(raw: string): string | null {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (!month) return null;
    return isoDate(Number(expandYear(named[3])), month, Number(named[1]));
  }
  const numeric = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
  if (!numeric) return null;
  const a = Number(numeric[1]);
  const b = Number(numeric[2]);
  const year = Number(expandYear(numeric[3]));
  let day = a;
  let month = b;
  if (a > 12 && b <= 12) {
    day = a;
    month = b;
  } else if (b > 12 && a <= 12) {
    month = a;
    day = b;
  }
  return isoDate(year, month, day);
}

function expandYear(raw: string): string {
  if (raw.length === 4) return raw;
  const n = Number(raw);
  return String(n >= 70 ? 1900 + n : 2000 + n);
}

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = new Date(Date.UTC(year, month - 1, day));
  if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseMoneyToken(raw: string): number | null {
  let text = raw.trim();
  if (!text || !/\d/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-") || /\bDR\b/i.test(text);
  const credit = /\bCR\b/i.test(text);
  text = text
    .replace(/[()]/g, "")
    .replace(/\b(DR|CR)\b/gi, "")
    .replace(/[$£€]/g, "")
    .replace(/\bR(?=\s?\d)/g, "")
    .replace(/\s/g, "");
  if (!text || text === "-" || text === ".") return null;
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (/,\d{1,2}$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (negative && !credit) return -Math.abs(value);
  return value;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function headerIndex(headers: string[], names: string[]): number {
  return headers.findIndex((header) => names.includes(header));
}

function normalHeader(cell: string): string {
  return cell.toLowerCase().replace(/[_./]+/g, " ").replace(/\s+/g, " ").trim();
}

type ColumnMap = {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  balance: number;
};

function mapColumns(headers: string[]): ColumnMap | null {
  const norm = headers.map(normalHeader);
  const date = headerIndex(norm, ["date", "transaction date", "posting date", "value date", "trans date"]);
  const description = headerIndex(norm, [
    "description",
    "narrative",
    "details",
    "detail",
    "particulars",
    "transaction",
    "reference",
    "payee",
  ]);
  const amount = headerIndex(norm, ["amount", "value", "transaction amount"]);
  const debit = headerIndex(norm, ["debit", "withdrawal", "withdrawals", "money out", "paid out"]);
  const credit = headerIndex(norm, ["credit", "deposit", "deposits", "money in", "paid in"]);
  const balance = headerIndex(norm, ["balance", "running balance", "available balance", "closing balance"]);
  if (date < 0 || (amount < 0 && debit < 0 && credit < 0)) return null;
  return { date, description, amount, debit, credit, balance };
}

function rowAmount(cells: string[], columns: ColumnMap): number | null {
  if (columns.debit >= 0 || columns.credit >= 0) {
    const debit = columns.debit >= 0 ? parseMoneyToken(cells[columns.debit] ?? "") : null;
    const credit = columns.credit >= 0 ? parseMoneyToken(cells[columns.credit] ?? "") : null;
    const out = debit == null ? 0 : -Math.abs(debit);
    const inn = credit == null ? 0 : Math.abs(credit);
    if (debit == null && credit == null) return null;
    return roundMoney(inn + out);
  }
  if (columns.amount < 0) return null;
  const amount = parseMoneyToken(cells[columns.amount] ?? "");
  return amount == null ? null : roundMoney(amount);
}

function parseCsvStatement(text: string): LibraryTransaction[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const columns = mapColumns(headers);
  if (!columns) return [];
  const transactions: LibraryTransaction[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const date = parseStatementDate(cells[columns.date] ?? "");
    const amount = rowAmount(cells, columns);
    if (!date || amount == null || amount === 0) continue;
    const description =
      columns.description >= 0 ? cells[columns.description] || "Transaction" : "Transaction";
    const balance =
      columns.balance >= 0 ? parseMoneyToken(cells[columns.balance] ?? "") : null;
    transactions.push({
      date,
      description: clip(description, 160),
      amount,
      balance: balance == null ? null : roundMoney(balance),
    });
    if (transactions.length >= LIBRARY_READ_TX_MAX) break;
  }
  return transactions;
}

function amountsOnLine(line: string): string[] {
  return (
    line.match(
      /\(?-?(?:[$£€]|R(?=\s?\d))\s?\d[\d ,]*(?:\.\d+)?\)?|\(?-?\d{1,3}(?:[ ,]\d{3})+(?:\.\d{1,2})?\)?|\(?-?\d+\.\d{2}\)?/g,
    ) ?? []
  );
}

function parseProseStatement(text: string): LibraryTransaction[] {
  const transactions: LibraryTransaction[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const dateMatch = line.match(DATE_TOKEN);
    if (!dateMatch || dateMatch.index == null) continue;
    const date = parseStatementDate(dateMatch[1]);
    if (!date) continue;
    const rest = `${line.slice(0, dateMatch.index)} ${line.slice(dateMatch.index + dateMatch[1].length)}`.trim();
    const amountTokens = amountsOnLine(rest);
    if (amountTokens.length === 0) continue;
    const parsed = amountTokens.map((token) => parseMoneyToken(token)).filter((n): n is number => n != null);
    if (parsed.length === 0) continue;
    const balance = parsed.length >= 2 ? parsed[parsed.length - 1] : null;
    const amount = parsed.length >= 2 ? parsed[parsed.length - 2] : parsed[0];
    let description = rest;
    for (const token of amountTokens) description = description.replace(token, " ");
    description = clip(description, 160) || "Transaction";
    if (/^(opening|closing|brought forward|carried forward|balance b\/f|balance c\/f)\b/i.test(description)) {
      continue;
    }
    transactions.push({ date, description, amount: roundMoney(amount), balance });
    if (transactions.length >= LIBRARY_READ_TX_MAX) break;
  }
  return transactions;
}

function statementFromTransactions(
  transactions: LibraryTransaction[],
  text: string,
): LibraryStatementRead | null {
  if (transactions.length === 0) return null;
  const dates = transactions.map((row) => row.date).filter((date): date is string => Boolean(date)).sort();
  let moneyIn = 0;
  let moneyOut = 0;
  for (const row of transactions) {
    if (row.amount > 0) moneyIn += row.amount;
    else moneyOut += Math.abs(row.amount);
  }
  const withBalance = transactions.filter((row) => row.balance != null);
  const openingLine = text.match(/opening balance[^\d-]{0,12}(-?[\d ,]+(?:\.\d{2})?)/i);
  const closingLine = text.match(/closing balance[^\d-]{0,12}(-?[\d ,]+(?:\.\d{2})?)/i);
  const first = withBalance[0];
  const last = withBalance[withBalance.length - 1];
  const openingFromRun = first?.balance != null ? roundMoney(first.balance - first.amount) : null;
  const currency = /\bZAR\b|\bR\s?\d/.test(text) ? "ZAR" : /\bUSD\b|\$\s?\d/.test(text) ? "USD" : null;
  return {
    kind: "bank_statement",
    period_start: dates[0] ?? null,
    period_end: dates[dates.length - 1] ?? null,
    currency,
    opening_balance: openingLine ? parseMoneyToken(openingLine[1]) : openingFromRun,
    closing_balance: closingLine ? parseMoneyToken(closingLine[1]) : (last?.balance ?? null),
    money_in: roundMoney(moneyIn),
    money_out: roundMoney(moneyOut),
    transaction_count: transactions.length,
    transactions,
  };
}

function wantsStatement(input: { documentType?: string | null; source?: string | null; fileName?: string | null }): boolean {
  const type = (input.documentType ?? "").toLowerCase();
  const source = (input.source ?? "").toLowerCase();
  const name = (input.fileName ?? "").toLowerCase();
  return (
    type === "bank_statement" ||
    type === "cash" ||
    source === "bank_pack" ||
    source === "cash_pack" ||
    /bank|statement/.test(name)
  );
}

function summaryFor(read: { text: string | null; statement: LibraryStatementRead | null }): string {
  const statement = read.statement;
  if (statement) {
    const period =
      statement.period_start && statement.period_end
        ? `${statement.period_start} to ${statement.period_end}`
        : "the period on the file";
    const closing =
      statement.closing_balance != null ? ` Closing balance ${statement.closing_balance}.` : "";
    return `${statement.transaction_count} transactions, ${period}. Money in ${statement.money_in}. Money out ${statement.money_out}.${closing}`;
  }
  const text = (read.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length >= 40) return clip(text, 240);
  return "Milōn could not read this file.";
}

/**
 * Turn statement text (CSV, a spreadsheet exported to CSV, or a PDF text layer)
 * into a library read. Scans with no text stay unreadable so the caller can
 * send the original file to the model.
 */
export function buildLibraryRead(input: {
  text: string | null | undefined;
  fileName?: string | null;
  documentType?: string | null;
  source?: string | null;
}): LibraryRead {
  const text = (input.text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const clipped = text.length > LIBRARY_READ_TEXT_MAX ? text.slice(0, LIBRARY_READ_TEXT_MAX) : text;
  const csvRows = parseCsvStatement(clipped);
  const rows = csvRows.length > 0 ? csvRows : parseProseStatement(clipped);
  const bankish = wantsStatement(input) || rows.length >= 2;
  const statement = bankish ? statementFromTransactions(rows, clipped) : null;
  const readable = Boolean(statement) || clipped.length >= 40;
  const body: LibraryRead = {
    status: readable ? "read" : "unreadable",
    text: readable && clipped ? clipped : null,
    statement,
    summary: "",
  };
  body.summary = summaryFor(body);
  return body;
}

/** Drop account numbers and tax ids from the copy bots will quote. Amounts stay. */
export function sealLibraryReadForStorage(read: LibraryRead): LibraryRead {
  const session = createRedactionSession();
  const text = read.text ? applyRedaction(read.text, session) : null;
  const statement = read.statement
    ? {
        ...read.statement,
        transactions: read.statement.transactions.map((row) => ({
          ...row,
          description: applyRedaction(row.description, session),
        })),
      }
    : null;
  const sealed = { ...read, text, statement, summary: applyRedaction(read.summary, session) };
  sealed.summary = summaryFor(sealed);
  return sealed;
}

export function libraryReadPending(meta: unknown): boolean {
  const row = asRecord(meta);
  const status = row?.read_status;
  return status !== "read" && status !== "unreadable";
}

export function libraryHasReadableContent(meta: unknown): boolean {
  return readStoredLibrary(meta).status === "read";
}

export function readStoredLibrary(meta: unknown): LibraryRead {
  const row = asRecord(meta);
  if (!row) {
    return { status: "unreadable", text: null, statement: null, summary: "Milōn could not read this file." };
  }
  const text = typeof row.extracted_text === "string" ? row.extracted_text.trim() : "";
  const statement = statementFromStored(row.statement);
  if (row.read_status === "read" && (text || statement)) {
    return {
      status: "read",
      text: text || null,
      statement,
      summary: typeof row.summary === "string" && row.summary.trim() ? row.summary.trim() : summaryFor({ text, statement }),
    };
  }
  if (row.read_status === "unreadable") {
    return {
      status: "unreadable",
      text: null,
      statement: null,
      summary:
        typeof row.summary === "string" && row.summary.trim()
          ? row.summary.trim()
          : "Milōn could not read this file.",
    };
  }
  return { status: "unreadable", text: null, statement: null, summary: "This file has not been read yet." };
}

function statementFromStored(value: unknown): LibraryStatementRead | null {
  const row = asRecord(value);
  if (!row || row.kind !== "bank_statement" || !Array.isArray(row.transactions)) return null;
  const transactions = row.transactions
    .slice(0, LIBRARY_READ_TX_MAX)
    .map((item) => {
      const tx = asRecord(item);
      if (!tx || typeof tx.amount !== "number" || !Number.isFinite(tx.amount)) return null;
      return {
        date: typeof tx.date === "string" ? tx.date : null,
        description: typeof tx.description === "string" ? clip(tx.description, 160) : "Transaction",
        amount: roundMoney(tx.amount),
        balance: typeof tx.balance === "number" && Number.isFinite(tx.balance) ? roundMoney(tx.balance) : null,
      };
    })
    .filter((item): item is LibraryTransaction => Boolean(item));
  if (transactions.length === 0) return null;
  return {
    kind: "bank_statement",
    period_start: typeof row.period_start === "string" ? row.period_start : null,
    period_end: typeof row.period_end === "string" ? row.period_end : null,
    currency: typeof row.currency === "string" ? row.currency : null,
    opening_balance: typeof row.opening_balance === "number" ? row.opening_balance : null,
    closing_balance: typeof row.closing_balance === "number" ? row.closing_balance : null,
    money_in: typeof row.money_in === "number" ? row.money_in : 0,
    money_out: typeof row.money_out === "number" ? row.money_out : 0,
    transaction_count:
      typeof row.transaction_count === "number" ? row.transaction_count : transactions.length,
    transactions,
  };
}

function keepSummary(current: unknown, next: string): string {
  const existing = typeof current === "string" ? current.trim() : "";
  if (!existing) return next.slice(0, 400);
  if (/could not|couldn.t|not enough|unreadable|failed to|no text|not been read/i.test(existing)) {
    return next.slice(0, 400);
  }
  return existing.slice(0, 400);
}

/** Meta blob written back onto the artifact. Existing keys other than the read stay. */
export function libraryMetaPatch(meta: unknown, read: LibraryRead, at: string): Record<string, unknown> {
  const current = asRecord(meta) ?? {};
  const sealed = sealLibraryReadForStorage(read);
  const next: Record<string, unknown> = {
    ...current,
    read_status: sealed.status,
    read_at: at,
    summary: keepSummary(current.summary, sealed.summary),
  };
  if (sealed.text) next.extracted_text = sealed.text;
  else delete next.extracted_text;
  if (sealed.statement) next.statement = sealed.statement;
  else delete next.statement;
  return next;
}

const LABELED: Array<{ key: "revenue" | "cogs" | "grossProfit" | "fixedCosts" | "netIncome"; pattern: RegExp }> = [
  { key: "revenue", pattern: /^(?:total\s+)?(?:revenue|turnover|sales|income)$/i },
  { key: "cogs", pattern: /^(?:total\s+)?(?:cost of sales|cost of goods sold|cogs)$/i },
  { key: "grossProfit", pattern: /^(?:gross profit|gross margin)$/i },
  { key: "fixedCosts", pattern: /^(?:total\s+)?(?:operating expenses|fixed costs|overheads)$/i },
  { key: "netIncome", pattern: /^(?:net profit|net income|profit after tax|profit for the (?:year|period))$/i },
];

function labeledFigures(text: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s{2,}|,|\t/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const label = parts[0];
    const amount = parseMoneyToken(parts[parts.length - 1]);
    if (amount == null) continue;
    for (const row of LABELED) {
      if (found[row.key] != null) continue;
      if (row.pattern.test(label)) found[row.key] = roundMoney(Math.abs(amount));
    }
  }
  return found;
}

/**
 * Drafts a person can confirm. Nothing here writes cash, budget, waterfall, or a ledger.
 * The patch matches propose_figure_adjustment.
 */
export function figureDraftsFromLibraryRead(read: LibraryRead, fileName: string): LibraryFigureDraft[] {
  if (read.status !== "read") return [];
  const drafts: LibraryFigureDraft[] = [];
  const name = fileName.trim() || "the library file";
  const statement = read.statement;
  const balance = statement?.closing_balance ?? statement?.opening_balance;
  if (statement && balance != null && Number.isFinite(balance)) {
    const period = statement.period_end ? ` at ${statement.period_end}` : "";
    drafts.push({
      surface: "cash",
      patch: { openingBalance: String(roundMoney(balance)) },
      reason: `Opening cash from the closing balance on ${name}${period}. Draft only. A person confirms on the Cash forecast page before the books change.`,
      applied: false,
      requires_human_approval: true,
    });
  }
  const figures = labeledFigures(read.text ?? "");
  if (figures.revenue != null && Object.keys(figures).length >= 2) {
    drafts.push({
      surface: "waterfall",
      patch: figures,
      reason: `Figures read from ${name}. Draft only. A person confirms on the profitability waterfall before the books change.`,
      applied: false,
      requires_human_approval: true,
    });
  }
  return drafts;
}

export function sourceExtractionHasBody(extraction: unknown): boolean {
  const row = asRecord(extraction);
  if (!row) return false;
  if (typeof row.doc_type === "string" && row.doc_type.trim()) return true;
  if (Array.isArray(row.line_items) && row.line_items.length > 0) return true;
  const fields = asRecord(row.fields);
  return Boolean(fields && Object.keys(fields).length > 0);
}

/** Bank-statement source rows stay readable even when no ledger bill was proposed. */
export function sourceLibraryStatement(extraction: unknown): LibraryStatementRead | null {
  const row = asRecord(extraction);
  if (!row || row.doc_type !== "bank_statement" || !Array.isArray(row.line_items)) return null;
  const transactions: LibraryTransaction[] = [];
  for (const item of row.line_items) {
    const line = asRecord(item);
    if (!line) continue;
    const amount = typeof line.amount === "number" ? line.amount : parseMoneyToken(String(line.amount ?? ""));
    if (amount == null || !Number.isFinite(amount)) continue;
    transactions.push({
      date: typeof line.date === "string" ? parseStatementDate(line.date) : null,
      description: clip(typeof line.description === "string" ? line.description : "Transaction", 160),
      amount: roundMoney(amount),
      balance: null,
    });
    if (transactions.length >= LIBRARY_READ_TX_MAX) break;
  }
  return statementFromTransactions(transactions, "");
}

export const LIBRARY_READ_PROMPT =
  "list_client_library and get_client_library_doc read Client library files. A file name in the prompt is not the file body. Call get_client_library_doc before you say a file has not been read. When that tool returns read true, the file has been read: quote content or statement transactions, money in, money out, and balances. Do not say it has not been read. A bank statement is cash context. It does not need to be a profit-and-loss extract or a ledger bill. figure_drafts are not saved and are not posted to Xero, QuickBooks, or Sage. Only the Financial Manager may call propose_figure_adjustment, and only when the person asks to apply or change a figure. That call stays pending until a person confirms. Do not say the cash forecast, budget, or waterfall was updated.";
