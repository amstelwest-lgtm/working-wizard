/**
 * Financial statement extraction server functions.
 *
 * extractFinancials        — legacy CSV/Excel/text path (pattern + AI text)
 * extractPDFsWithAI        — new AI-powered PDF path via Gemini native PDF support
 *                            Accepts up to 3 PDFs, merges, normalises, returns full schema
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  RawExtraction,
  MergedExtractionResult,
  MergeConflict,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
} from "@/lib/extraction-types";

// ─── Gemini extraction prompt ──────────────────────────────────────────────────

const GEMINI_PROMPT = `You are a financial data extraction specialist for South African SME financial statements.

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

Return this EXACT JSON structure with no deviations:

{
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

// ─── Call Gemini with native PDF support ───────────────────────────────────────

async function callGeminiPDF(base64: string, fileName: string): Promise<RawExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured. Please add it in your project secrets.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: base64,
                },
              },
              { text: GEMINI_PROMPT },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini API error (${res.status}): ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    const rawText: string | undefined = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("No response content from Gemini");

    try {
      return JSON.parse(rawText) as RawExtraction;
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as RawExtraction;
      throw new Error("Could not parse JSON from Gemini response");
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Merge multiple extractions ────────────────────────────────────────────────

function mergeExtractions(
  extractions: Array<{ raw: RawExtraction; fileName: string }>,
): Pick<MergedExtractionResult, "current_period" | "prior_period" | "document_metadata" | "top_expenses" | "top_income_sources" | "data_quality" | "source_map" | "conflicts"> {
  const source_map: Record<string, string> = {};
  const conflicts: MergeConflict[] = [];

  const merged: RawExtraction = {
    document_metadata: { ...extractions[0].raw.document_metadata },
    current_period: {
      income_statement: {} as IncomeStatement,
      balance_sheet: {} as BalanceSheet,
      cash_flow_statement: {} as CashFlowStatement,
    },
    prior_period: { ...extractions[0].raw.prior_period },
    top_expenses: [],
    top_income_sources: [],
    data_quality: { ...extractions[0].raw.data_quality },
  };

  const sections = ["income_statement", "balance_sheet", "cash_flow_statement"] as const;

  for (const [idx, { raw, fileName }] of extractions.entries()) {
    const docLabel = `document_${idx + 1}`;

    for (const section of sections) {
      const src = raw.current_period?.[section] ?? {};
      for (const [field, value] of Object.entries(src)) {
        if (value === null || value === undefined) continue;
        const path = `${section}.${field}`;
        const sectionObj = merged.current_period[section] as unknown as Record<string, unknown>;
        const existing = sectionObj[field];

        if (existing !== null && existing !== undefined && existing !== value) {
          conflicts.push({
            field: path,
            value_1: existing as number,
            source_1: source_map[path] ?? "document_1",
            value_2: value as number,
            source_2: docLabel,
          });
        }

        sectionObj[field] = value;
        source_map[path] = docLabel;
      }
    }

    // Last non-empty top_expenses wins
    if (raw.top_expenses?.length) {
      merged.top_expenses = raw.top_expenses;
      source_map["top_expenses"] = docLabel;
    }
    if (raw.top_income_sources?.length) {
      merged.top_income_sources = raw.top_income_sources;
      source_map["top_income_sources"] = docLabel;
    }

    // Merge metadata: take non-null values
    for (const [k, v] of Object.entries(raw.document_metadata)) {
      if (v !== null && v !== undefined) {
        (merged.document_metadata as unknown as Record<string, unknown>)[k] = v;
      }
    }

    // Keep highest confidence overall
    const conf = { high: 3, medium: 2, low: 1 };
    if ((conf[raw.data_quality?.overall_confidence] ?? 0) > (conf[merged.data_quality?.overall_confidence] ?? 0)) {
      merged.data_quality = raw.data_quality;
    }
  }

  return { ...merged, source_map, conflicts };
}

// ─── Normalise to 12-month annualised values ───────────────────────────────────

const FLOW_FIELDS_IS = [
  "revenue", "cogs", "gross_profit", "fixed_costs", "labor_cost",
  "depreciation", "amortisation", "depreciation_amortisation_total",
  "ebitda", "ebit", "interest_expense", "ebt", "tax", "net_income",
  "director_remuneration", "dividends_declared",
] as const;

const FLOW_FIELDS_CFS = [
  "operating_cash_flow", "capex", "dividends_paid",
] as const;

function normaliseExtraction<T extends Pick<RawExtraction, "current_period" | "document_metadata">>(
  extraction: T,
): T & { normalisation_applied: boolean; original_period_months?: number; annualisation_factor?: number } {
  const periodMonths = extraction.document_metadata?.period_months ?? 12;
  const annualisationFactor = 12 / periodMonths;

  if (periodMonths === 12) {
    return { ...extraction, normalisation_applied: false };
  }

  const normalised = JSON.parse(JSON.stringify(extraction)) as T;

  for (const field of FLOW_FIELDS_IS) {
    const is = normalised.current_period.income_statement as unknown as Record<string, number | null>;
    if (is[field] != null) is[field] = Math.round((is[field]! * annualisationFactor) * 100) / 100;
  }

  for (const field of FLOW_FIELDS_CFS) {
    const cfs = normalised.current_period.cash_flow_statement as unknown as Record<string, number | null>;
    if (cfs[field] != null) cfs[field] = Math.round((cfs[field]! * annualisationFactor) * 100) / 100;
  }

  return {
    ...normalised,
    normalisation_applied: true,
    original_period_months: periodMonths,
    annualisation_factor: annualisationFactor,
  };
}

// ─── Server function: AI PDF extraction ───────────────────────────────────────

const PDFFileSchema = z.object({
  base64: z.string().max(45_000_000),
  fileName: z.string().max(255),
});

export const extractPDFsWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      files: z.array(PDFFileSchema).min(1).max(3),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    for (const f of data.files) {
      const sizeBytes = Math.ceil((f.base64.length * 3) / 4);
      if (sizeBytes > 32 * 1024 * 1024) {
        throw new Error(`"${f.fileName}" exceeds 32 MB. Please compress or split the file.`);
      }
    }

    // Call Gemini for each PDF in parallel
    const extractions = await Promise.all(
      data.files.map(async (f) => ({
        raw: await callGeminiPDF(f.base64, f.fileName),
        fileName: f.fileName,
      })),
    );

    // Merge
    const merged = mergeExtractions(extractions);

    // Normalise
    const normalised = normaliseExtraction(merged);

    const result: MergedExtractionResult = {
      ...normalised,
      document_count: data.files.length,
      file_names: data.files.map((f) => f.fileName),
    };

    return result;
  });

// ─── Legacy server function: CSV / Excel / text ────────────────────────────────

const FIELDS = [
  "revenue", "cogs", "ebit", "ebt", "netIncome", "ebitda",
  "operatingCashflow", "totalAssets", "equity", "receivables",
  "inventory", "payables", "fixedCosts", "variableCosts",
  "top5Revenue", "laborCost", "employees", "founderHours",
];

const SYSTEM = `You are a financial-statement parser. Extract the following figures from the supplied document and return ONLY valid JSON, no prose, no markdown.

Required keys (all numbers, in the same currency unit as the document). If a value is not present, omit the key.

Keys:
- revenue (turnover / sales / total revenue)
- cogs (cost of sales / cost of goods sold)
- ebit (operating profit)
- ebt (profit before tax)
- netIncome (profit after tax / net profit)
- ebitda
- operatingCashflow (cash generated from operations)
- totalAssets
- equity (total equity / shareholders funds)
- receivables (trade debtors / accounts receivable)
- inventory (stock)
- payables (trade creditors / accounts payable)
- fixedCosts (rent + salaries + insurance + recurring overheads)
- variableCosts
- top5Revenue (revenue from top-5 customers if disclosed)
- laborCost (employee costs / wages / payroll)
- employees (headcount)
- founderHours (annual founder hours; omit if not stated)

Use the most recent period if multiple are shown. Negative numbers stay negative. Return strictly: {"revenue": 1234, "cogs": 567, ...}`;

const KEYWORDS: Record<string, string[]> = {
  revenue: ["total revenue", "total turnover", "revenue", "turnover", "net sales", "total sales"],
  cogs: ["cost of goods sold", "cost of sales", "cost of revenue", "direct costs"],
  ebit: ["operating profit", "profit from operations", "ebit"],
  ebt: ["profit before tax", "income before tax", "profit before income tax", "ebt"],
  netIncome: ["profit after tax", "net income", "net profit", "profit for the year", "profit for the period"],
  ebitda: ["ebitda"],
  operatingCashflow: ["net cash from operating", "cash from operating activities", "cash generated from operations"],
  totalAssets: ["total assets"],
  equity: ["total equity", "shareholders equity", "stockholders equity", "total shareholders", "net assets"],
  receivables: ["accounts receivable", "trade receivables", "trade and other receivables", "debtors"],
  inventory: ["inventories", "inventory", "stock"],
  payables: ["accounts payable", "trade payables", "trade and other payables", "creditors"],
  fixedCosts: ["fixed costs", "fixed overhead", "fixed expenses"],
  variableCosts: ["variable costs", "variable expenses"],
  laborCost: ["employee costs", "staff costs", "salaries and wages", "payroll", "personnel costs", "remuneration"],
  employees: ["number of employees", "total employees", "headcount", "full-time equivalent"],
  top5Revenue: [],
  founderHours: [],
};

function extractNumber(segment: string): number | null {
  const matches = segment.match(/[-−(]?\d[\d ,]*(?:\.\d+)?[)]?/g);
  if (!matches) return null;
  const raw = matches[matches.length - 1]
    .replace(/[, ]/g, "")
    .replace(/\(([^)]+)\)/, "-$1")
    .replace("−", "-");
  const n = parseFloat(raw);
  return isFinite(n) ? n : null;
}

function patternExtract(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Record<string, string> = {};
  for (const [field, kws] of Object.entries(KEYWORDS)) {
    if (kws.length === 0 || out[field]) continue;
    for (const line of lines) {
      const lc = line.toLowerCase();
      if (kws.some((kw) => lc.includes(kw))) {
        const n = extractNumber(line);
        if (n !== null) { out[field] = String(n); break; }
      }
    }
  }
  return out;
}

async function aiExtractText(text: string, fileName: string): Promise<Record<string, string>> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const apiKey = openaiKey || lovableKey;
  if (!apiKey) return {};

  const endpoint = openaiKey
    ? "https://api.openai.com/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const model = openaiKey ? "gpt-4o-mini" : "google/gemini-2.5-flash";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `File: ${fileName}\n\nContents:\n${text.slice(0, 80_000)}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
    const out: Record<string, string> = {};
    for (const k of FIELDS) {
      const val = parsed[k];
      if (typeof val === "number" && isFinite(val)) out[k] = String(Math.round(val * 100) / 100);
      else if (typeof val === "string" && val.trim()) {
        const n = parseFloat(val.replace(/[^0-9.\-]/g, ""));
        if (isFinite(n)) out[k] = String(n);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export const extractFinancials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      fileName: z.string(),
      mimeType: z.string().optional(),
      text: z.string().max(500_000).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!data.text?.trim()) throw new Error("No usable content provided");
    const docText = data.text.slice(0, 120_000);
    const aiResult = await aiExtractText(docText, data.fileName);
    const patternResult = patternExtract(docText);
    const merged: Record<string, string> = { ...patternResult, ...aiResult };
    return { financials: merged, fieldCount: Object.keys(merged).length };
  });
