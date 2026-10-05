/**
 * Structural detector for a bank-transaction export (CSV / spreadsheet text).
 * A dated ledger is not an income statement or trial balance and must not be
 * offered as a financial-statement import.
 */

export const BANK_LEDGER_MESSAGE =
  "This file is a bank statement, not an income statement or balance sheet. It has dated transactions, so it cannot be imported as financial figures. Use the bank statement upload instead.";

const DATE_HEADERS = new Set([
  "date",
  "txn date",
  "transaction date",
  "trans date",
  "posting date",
  "value date",
  "datum",
]);

const DESC_HEADERS = new Set([
  "description",
  "narrative",
  "details",
  "detail",
  "payee",
  "memo",
  "particulars",
  "beskrywing",
  "narratief",
]);

const AMOUNT_HEADERS = new Set(["amount", "amt", "value", "bedrag"]);
const DEBIT_HEADERS = new Set([
  "debit",
  "debits",
  "withdrawal",
  "withdrawals",
  "money out",
  "paid out",
  "debet",
]);
const CREDIT_HEADERS = new Set([
  "credit",
  "credits",
  "deposit",
  "deposits",
  "money in",
  "paid in",
  "krediet",
]);
const BALANCE_HEADERS = new Set(["balance", "running balance", "closing balance", "saldo"]);

const ACCOUNT_CODE_HEADERS = new Set([
  "account code",
  "account no",
  "account number",
  "acc code",
  "acc no",
  "nominal",
  "nominal code",
  "gl code",
  "gl account",
  "ledger account",
]);

function normHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function delimiterOf(line: string): "," | ";" | "\t" {
  const commas = (line.match(/,/g) ?? []).length;
  const semis = (line.match(/;/g) ?? []).length;
  const tabs = (line.match(/\t/g) ?? []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return "\t";
  if (semis > commas) return ";";
  return ",";
}

function splitRow(line: string, delimiter: "," | ";" | "\t"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function looksLikeDate(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}\b/.test(text)) return true;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(text)) return true;
  if (/^\d{1,2}\s+[A-Za-z]{3,12}\s+\d{2,4}$/.test(text)) return true;
  return false;
}

function isAccountCodeHeader(header: string): boolean {
  if (ACCOUNT_CODE_HEADERS.has(header)) return true;
  return header.startsWith("account code") || header.startsWith("nominal");
}

/**
 * True when the text is a bank ledger: a date column, a description column,
 * an amount / debit / credit / balance column, and many dated rows, without
 * an account-code or trial-balance layout.
 */
export function looksLikeBankLedger(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^---\s*sheet:/i.test(line));
  if (lines.length < 6) return false;

  const prelude = lines.slice(0, 6).join(" ").toLowerCase();
  let headerIndex = -1;
  let headers: string[] = [];
  let delimiter: "," | ";" | "\t" = ",";

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const delim = delimiterOf(lines[i]!);
    const cells = splitRow(lines[i]!, delim).map(normHeader).filter(Boolean);
    if (cells.length < 3) continue;
    const hasDate = cells.some((cell) => DATE_HEADERS.has(cell));
    const hasDesc = cells.some((cell) => DESC_HEADERS.has(cell));
    const hasMoney = cells.some(
      (cell) =>
        AMOUNT_HEADERS.has(cell) ||
        DEBIT_HEADERS.has(cell) ||
        CREDIT_HEADERS.has(cell) ||
        BALANCE_HEADERS.has(cell),
    );
    if (hasDate && hasDesc && hasMoney) {
      headerIndex = i;
      headers = cells;
      delimiter = delim;
      break;
    }
  }
  if (headerIndex < 0) return false;
  if (headers.some(isAccountCodeHeader)) return false;
  if (/\btrial balance\b/.test(prelude)) return false;

  const dateCol = headers.findIndex((cell) => DATE_HEADERS.has(cell));
  const data = lines.slice(headerIndex + 1);
  let dated = 0;
  for (const line of data) {
    const cells = splitRow(line, delimiter);
    const cell = dateCol >= 0 ? (cells[dateCol] ?? "") : "";
    if (looksLikeDate(cell) || cells.some(looksLikeDate)) dated += 1;
  }
  if (dated < 5) return false;
  return dated / data.length >= 0.6;
}
