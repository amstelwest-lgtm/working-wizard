import type { ResolvedMarket } from "./types";

export type CopyKey =
  | "receivables"
  | "payables"
  | "dso"
  | "dpo"
  | "revenue"
  | "checking"
  | "ach"
  | "indirectTax"
  | "indirectTaxNet"
  | "fy"
  | "sharePrimary"
  | "entityExample"
  | "emailExample"
  | "nameExample"
  | "phoneExample"
  | "currencyWord"
  | "currencyWordPlural";

const ZA: Record<CopyKey, string> = {
  receivables: "Debtors",
  payables: "Creditors",
  dso: "Debtor days",
  dpo: "Creditor days",
  revenue: "Turnover",
  checking: "Cheque account",
  ach: "Debit order",
  indirectTax: "VAT",
  indirectTaxNet: "VAT net",
  fy: "Financial year",
  sharePrimary: "WhatsApp",
  entityExample: "Karoo Traders (Pty) Ltd",
  emailExample: "owner@business.co.za",
  nameExample: "Thabo Nkosi",
  phoneExample: "+27821234567",
  currencyWord: "rand",
  currencyWordPlural: "rands",
};

const US: Record<CopyKey, string> = {
  receivables: "Accounts receivable",
  payables: "Accounts payable",
  dso: "Days sales outstanding",
  dpo: "Days payable outstanding",
  revenue: "Revenue",
  checking: "Checking account",
  ach: "ACH / autopay",
  indirectTax: "Sales tax",
  indirectTaxNet: "Sales tax remitted",
  fy: "Fiscal year",
  sharePrimary: "Email",
  entityExample: "Acme LLC",
  emailExample: "owner@business.com",
  nameExample: "Jordan Hale",
  phoneExample: "+1 512 555 0100",
  currencyWord: "dollar",
  currencyWordPlural: "dollars",
};

export function t(key: CopyKey, market: Pick<ResolvedMarket, "copyPack">): string {
  return (market.copyPack === "us" ? US : ZA)[key];
}

/**
 * Rewrite ZA-authored user copy for a US workspace. Safe no-op for ZA.
 * Longer phrases first so "Debtor Days" does not become "Receivable Days".
 */
export function localizeCopy(
  text: string,
  market: Pick<ResolvedMarket, "copyPack" | "currency">,
): string {
  if (market.copyPack !== "us") return text;
  const sym = market.currency === "USD" ? "$" : "R";
  return text
    .replace(/\bR100\b/g, `${sym}100`)
    .replace(/\bR1\b/g, `${sym}1`)
    .replace(/\bR0\.50\b/g, `${sym}0.50`)
    .replace(/\brands\b/gi, "dollars")
    .replace(/\brand\b/gi, "dollar")
    .replace(/\bDebtor Days\b/g, "Days sales outstanding")
    .replace(/\bCreditor Days\b/g, "Days payable outstanding")
    .replace(/\bdebtor days\b/gi, "days sales outstanding")
    .replace(/\bcreditor days\b/gi, "days payable outstanding")
    .replace(/\bDebtors\b/g, "Accounts receivable")
    .replace(/\bCreditors\b/g, "Accounts payable")
    .replace(/\bdebtors\b/g, "accounts receivable")
    .replace(/\bcreditors\b/g, "accounts payable")
    .replace(/\bDebtor\b/g, "Receivable")
    .replace(/\bCreditor\b/g, "Payable")
    .replace(/\bCheque account\b/gi, "Checking account")
    .replace(/\bdebit order\b/gi, "ACH / autopay")
    .replace(/\bLabour\b/g, "Labor")
    .replace(/\blabour\b/g, "labor")
    .replace(/\bVAT\b/g, "sales tax");
}

export const SALES_TAX_HONESTY =
  "Milōn uses your home state combined rate (state + average local, which you can edit) for budgets and cash. It does not file returns, model economic nexus in other states, or compute destination tax per invoice. If you sell into many states, set the blended rate you actually remitted last year.";
