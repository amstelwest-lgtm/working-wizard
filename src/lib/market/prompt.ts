/**
 * Prompt fragments derived from ResolvedMarket. ZA strings stay the current
 * specialist copy; US swaps locale, tax, and label hints. JSON field names
 * (debtors, vat bucket, etc.) stay stable so extractors do not fork schemas.
 */

import { z } from "zod";
import { coerceMarketSelection, parseMarketSelection } from "./parse";
import { resolveMarket, ZA_MARKET } from "./resolve";
import { t } from "./copy";
import type { MarketSelection, ResolvedMarket } from "./types";

export const marketInputSchema = z
  .object({
    country: z.enum(["ZA", "US"]),
    regionCode: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

export function resolvePromptMarket(raw: unknown): ResolvedMarket {
  const parsed = parseMarketSelection(raw);
  if (parsed) return resolveMarket(parsed);
  return ZA_MARKET;
}

export function selectionPayload(sel: MarketSelection): {
  country: MarketSelection["country"];
  regionCode: MarketSelection["regionCode"];
} {
  return { country: sel.country, regionCode: sel.regionCode };
}

export function isUsCopy(market: Pick<ResolvedMarket, "copyPack">): boolean {
  return market.copyPack === "us";
}

/** Specialist framing for extraction / bank / cash prompts. */
export function promptJurisdiction(market: ResolvedMarket): string {
  if (isUsCopy(market)) {
    const state = market.regionCode ? ` (${market.regionCode})` : "";
    return `United States${state} SME`;
  }
  return "South African SME";
}

export function promptCurrencyCode(market: ResolvedMarket): "ZAR" | "USD" {
  return market.currency === "USD" ? "USD" : "ZAR";
}

export function promptIndirectTax(market: ResolvedMarket): string {
  return t("indirectTax", market);
}

export function promptReceivables(market: ResolvedMarket): string {
  return t("receivables", market);
}

export function promptPayables(market: ResolvedMarket): string {
  return t("payables", market);
}

export function promptChecking(market: ResolvedMarket): string {
  return t("checking", market);
}

// ── Financial statement PDF extraction (nested schema) ───────────────────────

const ZA_FINANCIAL_EXTRACTION = `You are a financial data extraction specialist for South African SME financial statements.

Extract ALL financial figures from this document.

EXTRACTION RULES:
- Return ONLY a valid JSON object. No explanation, no markdown, no backticks, no preamble whatsoever.
- All monetary values must be numbers only — no R, $, commas, or currency symbols
- Negative values (losses, expenses shown in brackets) must be returned as negative numbers
- If a value cannot be found or is genuinely ambiguous, return null for that field — do not guess
- If comparative/prior period figures exist, extract both
- If values appear in thousands (R'000 or "000"), multiply ALL values by 1000 before returning and set values_appear_in_thousands to true
- Look for figures under any reasonable label variant:
  "Turnover" or "Sales" = revenue
  "Cost of Sales" or "Cost of Goods Sold" = cogs
  "Trade and other receivables" = debtors
  "Trade and other payables" = creditors
  "Property plant and equipment" = fixed_assets
  "Profit before tax" = ebt
  "Profit after tax" = net_income
  "Staff costs" or "Payroll" = labor_cost
- For top_expenses: use the ACTUAL line item labels from the document — do not rename them
- For top_income_sources: extract revenue breakdown lines if shown
- Verify arithmetic where possible: gross profit should equal revenue minus cogs
- South African statements may use comma as decimal separator (1.234,56) — handle both formats
- Director remuneration is often shown in notes, not the main statement — check notes pages
- Shareholder loans may appear as both assets and liabilities — capture both

Return this EXACT JSON structure with no deviations:`;

export function financialExtractionPrompt(market: ResolvedMarket = ZA_MARKET): string {
  const schemaTail = ZA_FINANCIAL_EXTRACTION_SCHEMA;
  if (!isUsCopy(market)) return `${ZA_FINANCIAL_EXTRACTION}\n\n${schemaTail}`;
  const preamble = `You are a financial data extraction specialist for United States SME financial statements.

Extract ALL financial figures from this document.

EXTRACTION RULES:
- Return ONLY a valid JSON object. No explanation, no markdown, no backticks, no preamble whatsoever.
- All monetary values must be numbers only — no R, $, commas, or currency symbols
- Negative values (losses, expenses shown in brackets) must be returned as negative numbers
- If a value cannot be found or is genuinely ambiguous, return null for that field — do not guess
- If comparative/prior period figures exist, extract both
- If values appear in thousands ("in thousands" or "000"), multiply ALL values by 1000 before returning and set values_appear_in_thousands to true
- Look for figures under any reasonable label variant:
  "Sales" or "Net sales" or "Revenue" = revenue
  "Cost of Sales" or "Cost of Goods Sold" = cogs
  "Accounts receivable" / "Trade receivables" = debtors (keep JSON key debtors)
  "Accounts payable" / "Trade payables" = creditors (keep JSON key creditors)
  "Property plant and equipment" = fixed_assets
  "Profit before tax" / "Income before tax" = ebt
  "Net income" / "Profit after tax" = net_income
  "Payroll" or "Compensation" or "Staff costs" = labor_cost
- Sales tax collected is not revenue — do not fold it into income
- For top_expenses: use the ACTUAL line item labels from the document — do not rename them
- For top_income_sources: extract revenue breakdown lines if shown
- Verify arithmetic where possible: gross profit should equal revenue minus cogs
- US statements use comma thousands and period decimals (1,234.56); also handle European comma-decimals if they appear
- Officer compensation is often shown in notes, not the main statement — check notes pages
- Shareholder / member loans may appear as both assets and liabilities — capture both

Return this EXACT JSON structure with no deviations:`;
  return `${preamble}\n\n${schemaTail.replace('"functional_currency": "ZAR"', '"functional_currency": "USD"')}`;
}

const ZA_FINANCIAL_EXTRACTION_SCHEMA = `{
  "document_metadata": {
    "company_name": null,
    "registration_number": null,
    "period_start_date": null,
    "period_end_date": null,
    "period_months": null,
    "prior_period_start_date": null,
    "prior_period_end_date": null,
    "document_type": "unknown",
    "financial_statement_type": "unknown",
    "prepared_by": null,
    "auditor_firm": null,
    "approval_date": null,
    "industry_description": null,
    "functional_currency": "ZAR",
    "foreign_currency_exposure": null,
    "headcount": null,
    "accounting_basis": "unknown",
    "values_appear_in_thousands": false,
    "contains_income_statement": false,
    "contains_balance_sheet": false,
    "contains_cash_flow_statement": false,
    "contains_notes": false
  },
  "current_period": {
    "income_statement": {
      "revenue": null, "cogs": null, "gross_profit": null, "other_income": null,
      "fixed_costs": null, "labor_cost": null, "depreciation": null,
      "amortisation": null, "depreciation_amortisation_total": null,
      "ebitda": null, "ebit": null, "interest_expense": null,
      "interest_income": null, "ebt": null, "tax": null,
      "net_income": null, "director_remuneration": null, "dividends_declared": null
    },
    "balance_sheet": {
      "total_assets": null, "fixed_assets": null, "goodwill": null,
      "intangible_assets": null, "right_of_use_assets": null,
      "current_assets": null, "inventory": null, "wip": null,
      "debtors": null, "provision_bad_debts": null, "cash": null,
      "other_current_assets": null, "total_liabilities": null,
      "current_liabilities": null, "creditors": null, "short_term_debt": null,
      "lease_liabilities_current": null, "other_current_liabilities": null,
      "non_current_liabilities": null, "long_term_debt": null,
      "lease_liabilities_non_current": null, "deferred_tax_liability": null,
      "deferred_tax_asset": null, "equity": null, "share_capital": null,
      "retained_earnings_opening": null, "retained_earnings_closing": null,
      "shareholder_loans_asset": null, "shareholder_loans_liability": null,
      "contingent_liabilities_notes": null
    },
    "cash_flow_statement": {
      "operating_cash_flow": null, "working_capital_movement_debtors": null,
      "working_capital_movement_inventory": null, "working_capital_movement_creditors": null,
      "capex": null, "asset_disposal_proceeds": null, "investing_cash_flow": null,
      "debt_drawdowns": null, "debt_repayments": null, "dividends_paid": null,
      "financing_cash_flow": null, "net_cash_movement": null,
      "cash_opening_balance": null, "cash_closing_balance": null
    }
  },
  "prior_period": {
    "revenue": null, "gross_profit": null, "net_income": null,
    "total_assets": null, "equity": null, "cash": null,
    "debtors": null, "inventory": null, "creditors": null, "operating_cash_flow": null
  },
  "top_expenses": [],
  "top_income_sources": [],
  "data_quality": {
    "gross_profit_reconciles": null,
    "net_income_reconciles": null,
    "balance_sheet_balances": null,
    "cash_flow_reconciles": null,
    "retained_earnings_reconciles": null,
    "prior_period_available": false,
    "confidence_by_section": {
      "income_statement": "not_found",
      "balance_sheet": "not_found",
      "cash_flow": "not_found",
      "expenses_detail": "not_found",
      "income_detail": "not_found",
      "notes": "not_found"
    },
    "overall_confidence": "low",
    "extraction_notes": ""
  }
}`;

export function portalExtractionPrompt(market: ResolvedMarket = ZA_MARKET): string {
  const za = `You are extracting figures from a South African financial statement PDF for an
accounting platform. Follow these rules exactly:`;
  const us = `You are extracting figures from a United States financial statement PDF for an
accounting platform. Follow these rules exactly:`;
  const rest = `
1. Transcribe ONLY numbers that are physically printed in the document.
   Never calculate, estimate, or infer a value. If a line item is not present,
   return null for it. Do not fill gaps with 0.
2. Amounts shown in brackets ( ) or with a trailing "-" are NEGATIVE.
3. For "expense" style lines (cost of sales, operating expenses, finance costs,
   income tax) return them as POSITIVE magnitudes unless the statement itself
   shows them as negative in a subtotal column.
4. Report the presentation scale in "units" (actual / thousands / millions).
   Do NOT rescale the numbers yourself — leave them exactly as printed.
5. Map each printed line to the closest field in the schema. If several small
   lines roll into one schema field, sum only the lines that clearly belong
   there; otherwise put the remainder in the relevant "other" field.
6. Capture the comparative (prior year) column too when it is present.
7. If anything is ambiguous or you had to make a judgement call, say so briefly
   in extraction_notes so a human can check it.
${
  isUsCopy(market)
    ? "8. Prefer USD. Accounts receivable maps to trade_and_other_receivables; accounts payable to trade_and_other_payables. Sales tax collected is not revenue."
    : ""
}

Return ONLY valid JSON matching this shape (no markdown, no prose):`;
  return `${isUsCopy(market) ? us : za}${rest}`;
}

export function textExtractionSystem(market: ResolvedMarket = ZA_MARKET): string {
  const ar = isUsCopy(market)
    ? "receivables (accounts receivable / trade receivables / debtors)"
    : "receivables (trade debtors / accounts receivable)";
  const ap = isUsCopy(market)
    ? "payables (accounts payable / trade payables / creditors)"
    : "payables (trade creditors / accounts payable)";
  const rev = isUsCopy(market)
    ? "revenue (sales / net sales / total revenue)"
    : "revenue (turnover / sales / total revenue)";
  return `You are a financial-statement parser. Extract the following figures from the supplied document and return ONLY valid JSON, no prose, no markdown.

Required keys (all numbers, in the same currency unit as the document). If a value is not present, omit the key.

Keys:
- ${rev}
- cogs (cost of sales / cost of goods sold)
- ebit (operating profit)
- ebt (profit before tax)
- netIncome (profit after tax / net profit)
- ebitda
- operatingCashflow (cash generated from operations)
- totalAssets
- equity (total equity / shareholders funds)
- ${ar}
- inventory (stock)
- ${ap}
- fixedCosts (rent + salaries + insurance + recurring overheads)
- variableCosts
- top5Revenue (revenue from top-5 customers if disclosed)
- laborCost (employee costs / wages / payroll)
- employees (headcount)
- founderHours (annual founder hours; omit if not stated)

Use the most recent period if multiple are shown. Negative numbers stay negative. Return strictly: {"revenue": 1234, "cogs": 567, ...}`;
}

export function bankDraftPrompt(market: ResolvedMarket = ZA_MARKET): string {
  const checking = promptChecking(market).toLowerCase();
  const currency = promptCurrencyCode(market);
  const taxExclude = isUsCopy(market)
    ? "payments that are clearly federal or state income tax (NOT sales tax — treat sales tax remittances to the state as excluded, noting them)"
    : "payments that are clearly income tax / provisional tax (NOT VAT — treat VAT payments to the revenue service as excluded, noting them)";
  const excludeList = isUsCopy(market)
    ? "inter-account transfers, loan principal drawdowns/repayments (principal portion), owner drawings/injections, asset purchases (capex), sales tax remittances/refunds"
    : "inter-account transfers, loan principal drawdowns/repayments (principal portion), owner drawings/injections, asset purchases (capex), VAT payments/refunds";
  const where = isUsCopy(market)
    ? `United States context; currency is usually ${currency} unless the statements clearly show otherwise`
    : `South African context; currency is usually ${currency} unless the statements clearly show otherwise`;
  return `
You are an accountant's assistant. You are given one or more BANK STATEMENTS
for a small business (${where}). Files may cover MULTIPLE bank accounts
(${checking}, credit card, savings) — treat them as one consolidated business cash
picture. Build a draft basic income statement from the transaction activity,
following these rules exactly:

1. Classify every transaction. Money IN that is clearly trading income =
   revenue. Money OUT that is clearly direct cost of goods/services sold
   (suppliers, stock, raw materials, direct subcontractors) = cost_of_sales.
2. other_income = non-trading inflows that are genuine income (interest
   received, rebates, insurance payouts) — NOT capital injections, loan
   drawdowns, inter-account transfers, or owner deposits.
3. Group ALL remaining operating outflows into EXACTLY 5 opex categories,
   choosing the 5 most significant deductible expense groupings present in the
   data (typical examples: Salaries & wages; Rent & utilities; Bank charges &
   insurance; Marketing & advertising; Professional & admin fees; Motor &
   travel; Repairs & maintenance). Use an "Other operating costs" bucket as the
   5th category if needed so nothing is dropped. Each amount is a POSITIVE
   magnitude.
4. interest_paid = loan/overdraft/finance interest outflows. tax_paid =
   ${taxExclude}.
5. EXCLUDE and list in excluded_items: ${excludeList}. Never count these in revenue or
   expenses.
6. Compute: gross_profit = revenue - cost_of_sales.
   net_profit = gross_profit + other_income - total_opex - interest_paid - tax_paid.
   total_opex must equal the sum of opex_breakdown amounts.
7. Report the ACTUAL period covered: period_start (earliest transaction date),
   period_end (latest), months_covered (rounded to 1 decimal). Do NOT annualise
   any figure — report actuals for the period only.
8. Flag every judgement call briefly in notes (e.g. ambiguous counterparties,
   possible personal expenses, cash deposits assumed to be sales, multi-account
   consolidation). Silently cross-check that major bank outflows classified as
   expenses are consistent with statement activity — call out material gaps.

Return ONLY a JSON object with exactly these keys and types, no prose, no
markdown fences:
{"period_start": "YYYY-MM-DD"|null, "period_end": "YYYY-MM-DD"|null,
 "months_covered": number|null, "currency": string|null, "revenue": number,
 "cost_of_sales": number, "gross_profit": number, "other_income": number,
 "opex_breakdown": [{"category": string, "amount": number} x5],
 "total_opex": number, "interest_paid": number, "tax_paid": number,
 "net_profit": number, "excluded_items": string[], "notes": string|null}
`.trim();
}

export function cashExtractPrompt(market: ResolvedMarket = ZA_MARKET): string {
  const checking = promptChecking(market).toLowerCase();
  const currency = promptCurrencyCode(market);
  const who = promptJurisdiction(market);
  const vatHint = isUsCopy(market)
    ? `ai_bucket "vat" means sales tax remittances or refunds (keep the key vat)`
    : `ai_bucket "vat" means VAT payments or refunds`;
  return `
You are a cash-flow analyst for ${who}s. You are given one or more
BANK STATEMENTS that may cover MULTIPLE bank accounts (${checking}, credit card,
savings, etc.). Each file may be labelled with an account name. Extract a
transaction-level cash view (NOT an income statement).

Rules:
1. List individual transactions (or tightly grouped same-day same-counterparty
   movements). Prefer the most material lines — up to 200 transactions.
2. amount is always a POSITIVE number. direction is "in" (money received) or
   "out" (money paid).
3. ai_bucket must be one of:
   trading, cos, opex, payroll, rent, loan, interest, tax, vat, owner, capex,
   transfer, other
   (${vatHint})
4. Mark excluded=true for pure inter-account transfers that are not business
   cash movement. Still include them in the list with ai_bucket "transfer".
5. counterparty = merchant / payee / payer name when clear, else null.
6. For EACH distinct bank account, fill accounts[] with account_label,
   opening_balance, closing_balance (printed statement balances), and the
   file_names that belong to that account. Also set consolidated
   opening_balance / closing_balance as the SUM across accounts.
7. Tag every transaction with account_label matching accounts[].
8. period_start / period_end = earliest and latest transaction dates (YYYY-MM-DD).
9. BALANCE CHECK (required): For each account, mentally verify
   opening + sum(in) - sum(out) ≈ closing (including transfers). If it does
   not tie, explain the gap in balance_check_notes (missing pages, uncleared
   items, OCR uncertainty). Never invent transactions to force a tie.
10. Do NOT annualise. Do NOT invent transactions. If unsure of bucket, use
    "other" and mention it in notes.

Return ONLY JSON (no markdown) matching:
{
  "period_start": "YYYY-MM-DD"|null,
  "period_end": "YYYY-MM-DD"|null,
  "opening_balance": number|null,
  "closing_balance": number|null,
  "currency": "${currency}"|null,
  "accounts": [
    {
      "account_label": string,
      "opening_balance": number|null,
      "closing_balance": number|null,
      "file_names": string[]
    }
  ],
  "transactions": [
    {
      "txn_date": "YYYY-MM-DD",
      "amount": number,
      "direction": "in"|"out",
      "description": string,
      "counterparty": string|null,
      "ai_bucket": "trading"|...,
      "excluded": boolean,
      "account_label": string|null
    }
  ],
  "notes": string|null,
  "balance_check_notes": string|null
}
`.trim();
}

export function inviteDraftPrompt(
  market: ResolvedMarket,
  input: {
    clientName: string;
    clientCode: string | null;
    inviteUrl: string;
    firmName: string;
    accountantName: string;
  },
): string {
  const who = isUsCopy(market)
    ? "a US accountant to their SME client"
    : "a South African accountant to their SME client";
  const english = isUsCopy(market)
    ? "US English (organization, not organisation) is fine but keep it simple."
    : "South African English (organisation, not organization) is fine but keep it simple.";
  return `You write a short email from ${who}, inviting them to claim a MILŌN workspace.

Rules:
- Warm, calm, professional. No hype, no emojis, no "excited to partner", no sales pitch.
- Plain text only. ${english}
- Body under 140 words.
- MUST include this exact URL on its own line, unchanged: ${input.inviteUrl}
- ${input.clientCode ? `MUST mention the client code ${input.clientCode} once.` : "No client code."}
- Sign off as ${input.accountantName || "the accountant"}${input.firmName ? `, ${input.firmName}` : ""}.
- Do not invent extra links, prices, or product claims.

Context:
- Business: ${input.clientName}
- Firm: ${input.firmName || "the practice"}
- Accountant: ${input.accountantName || "the accountant"}

Return ONLY JSON: {"subject":"...","body":"..."}
The body must already be signed off and ready to paste into email.`;
}

export function newsSearchUrl(
  headline: string,
  market: Pick<ResolvedMarket, "copyPack"> = ZA_MARKET,
): string {
  if (isUsCopy(market)) {
    const q = `${headline} United States`;
    return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  }
  const q = `${headline} South Africa`;
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=en-ZA&gl=ZA&ceid=ZA:en`;
}

export function industryPulsePrompt(
  industry: string,
  today: string,
  market: ResolvedMarket = ZA_MARKET,
): string {
  if (!isUsCopy(market)) {
    return `You write Industry Pulse for South African small-business owners. Today is ${today}.
Sector: "${industry}".

This panel sits next to a separate "Your Next Move" action block. Do NOT give coaching, to-dos, or "do this week" advice.
Your job is situational awareness: what is happening in the sector.

Write for a busy owner — Grade 8 English. No jargon. No MBA speak.
Bad: "Collections are the binding constraint", "utilisation", "fee pressure", "scope creep", "cash conversion".
Good: "Clients are paying slower", "Team billable time", "Clients pushing fees down".

Respond ONLY with valid JSON (no markdown, no preamble):
{
  "headline": "One clear sentence about what matters most right now (max 14 words).",
  "metrics": [
    { "label": "How fast clients pay", "value": "↓ 6 days slower", "direction": "up|down|flat", "sentiment": "good|bad|neutral" },
    { "label": "Profit per sale", "value": "↓ Down", "direction": "up|down|flat", "sentiment": "good|bad|neutral" },
    { "label": "Customer demand", "value": "→ Steady", "direction": "up|down|flat", "sentiment": "good|bad|neutral" }
  ],
  "items": [
    {
      "headline": "News-style sector headline (max 14 words)",
      "summary": "One sentence on what is happening and why owners in this sector should care. No instructions.",
      "tag": "Payments | Costs | Demand | Fees | Labour | Rand | Power | Regulation | Finance | Sales",
      "tagColor": "green | amber | red | blue",
      "url": "https://… real public article or reputable SA business-news section URL"
    }
  ]
}

Rules:
- Exactly 3 metrics and 3 news items
- Metric labels must be everyday words (not debtor days, utilisation, fee pressure, working capital)
- Metric values must be readable words or simple numbers (e.g. "↓ Slower", "↑ Rising", "→ Steady")
- items[] must read like industry news / sector briefings, not tips
- Forbidden in items: imperative advice ("Ask for…", "Send…", "Cut…", "Turn on…", "Review…", "Offer…")
- Each item MUST include a url: prefer a real https article on Business Day, Moneyweb, News24 Business, Engineering News, SARB, or SARS. If no specific article is known, use the relevant section homepage (e.g. https://www.businesslive.co.za/bd/economy/). Never invent fake article paths.
- Focus on SA realities: payment delays, rand, fuel, power cuts, SARS/tax, demand, labour, costs
- Specific to ${industry}
- Prefer plausible current sector developments over fake newspaper mastheads or invented company names
- Do not use: utilisation, debtor days, fee pressure, scope creep, binding constraint, cash conversion, working capital, ROIC`;
  }

  return `You write Industry Pulse for United States small-business owners. Today is ${today}.
Sector: "${industry}".

This panel sits next to a separate "Your Next Move" action block. Do NOT give coaching, to-dos, or "do this week" advice.
Your job is situational awareness: what is happening in the sector.

Write for a busy owner — Grade 8 English. No jargon. No MBA speak.
Bad: "Collections are the binding constraint", "utilization", "fee pressure", "scope creep", "cash conversion".
Good: "Clients are paying slower", "Team billable time", "Clients pushing fees down".

Respond ONLY with valid JSON (no markdown, no preamble):
{
  "headline": "One clear sentence about what matters most right now (max 14 words).",
  "metrics": [
    { "label": "How fast clients pay", "value": "↓ 6 days slower", "direction": "up|down|flat", "sentiment": "good|bad|neutral" },
    { "label": "Profit per sale", "value": "↓ Down", "direction": "up|down|flat", "sentiment": "good|bad|neutral" },
    { "label": "Customer demand", "value": "→ Steady", "direction": "up|down|flat", "sentiment": "good|bad|neutral" }
  ],
  "items": [
    {
      "headline": "News-style sector headline (max 14 words)",
      "summary": "One sentence on what is happening and why owners in this sector should care. No instructions.",
      "tag": "Payments | Costs | Demand | Fees | Labor | Inflation | Rates | Regulation | Finance | Sales",
      "tagColor": "green | amber | red | blue",
      "url": "https://… real public article or reputable US business-news section URL"
    }
  ]
}

Rules:
- Exactly 3 metrics and 3 news items
- Metric labels must be everyday words (not DSO, utilization, fee pressure, working capital)
- Metric values must be readable words or simple numbers (e.g. "↓ Slower", "↑ Rising", "→ Steady")
- items[] must read like industry news / sector briefings, not tips
- Forbidden in items: imperative advice ("Ask for…", "Send…", "Cut…", "Turn on…", "Review…", "Offer…")
- Each item MUST include a url: prefer a real https article on Reuters, WSJ, Bloomberg, Fed, or IRS. If no specific article is known, use a section homepage (e.g. https://www.reuters.com/business/). Never invent fake article paths.
- Focus on US realities: payment delays, inflation, labor, rates, IRS/tax, demand, costs. Do not mention rand, load-shedding, SARS, or South Africa.
- Specific to ${industry}
- Prefer plausible current sector developments over fake newspaper mastheads or invented company names
- Do not use: utilisation, debtor days, fee pressure, scope creep, binding constraint, cash conversion, working capital, ROIC`;
}

export function askAiSystemBase(copyPack: "za" | "us"): string {
  const taxWord = copyPack === "us" ? "EIN / tax IDs" : "VAT numbers";
  const currencyWord = copyPack === "us" ? "dollar/currency amounts" : "rand/currency amounts";
  const locale =
    copyPack === "us"
      ? "- US English. Sales tax is not income tax. Do not assume VAT or SARS."
      : "- South African English is fine. VAT and SARS context is allowed when the numbers support it.";
  const benches =
    copyPack === "us"
      ? "\n- Days and percentage bands are global SME bands, not US industry medians. Do not invent US money benchmarks."
      : "";
  return `You are a sharp, concise SME CFO copilot.
Rules:
- Answer in 3–6 short sentences or a tight bullet list.
- Be specific and grounded in the numbers provided.
- Never fabricate figures. If data is missing, say so plainly and name the one input needed.
- Do NOT reference company names, ${taxWord}, or raw ${currencyWord} — refer to them as "your revenue", "your margin" etc.
- Currency references: use "your local currency" not specific amounts.
- Offer 1–2 concrete next actions the owner can take today.
- Ground answers in filled deliverables: profile answers, ratios, profitability waterfall (% of revenue), cash-forecast outlook, product lines, next moves, and action-plan tasks — not raw statement line items.
${locale}${benches}`;
}

export { coerceMarketSelection };
