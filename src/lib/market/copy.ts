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
  | "emailExample";

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
};

export function t(key: CopyKey, market: Pick<ResolvedMarket, "copyPack">): string {
  return (market.copyPack === "us" ? US : ZA)[key];
}

export const SALES_TAX_HONESTY =
  "Milōn uses your home state combined rate (state + average local, which you can edit) for budgets and cash. It does not file returns, model economic nexus in other states, or compute destination tax per invoice. If you sell into many states, set the blended rate you actually remitted last year.";
