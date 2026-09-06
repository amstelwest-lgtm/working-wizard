/**
 * Financial statement extraction server functions.
 *
 * extractFinancials        — legacy CSV/Excel/text path (pattern + AI text)
 * extractPDFsWithAI        — AI-powered PDF path via Claude Sonnet 4.6 (document)
 *                            Accepts up to 3 PDFs, merges, normalises, returns full schema
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callClaudeMessages, parseClaudeJson } from "@/lib/claude-messages";
import { INLINE_BASE64_MAX } from "@/lib/staged-upload";
import { resolvePdfBase64 } from "@/lib/staged-upload.server";
import type {
  RawExtraction,
  MergedExtractionResult,
  MergeConflict,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
} from "@/lib/extraction-types";
import { assessFlatExtraction, assessMergedExtraction, assertUsable } from "@/lib/upload-quality";
import {
  financialExtractionPrompt,
  marketInputSchema,
  resolvePromptMarket,
  textExtractionSystem,
  ZA_MARKET,
} from "@/lib/market";

// ─── Claude extraction prompt ──────────────────────────────────────────────────

async function callClaudePDF(
  base64: string,
  fileName: string,
  prompt: string,
): Promise<RawExtraction> {
  const raw = await callClaudeMessages({
    content: [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      },
      { type: "text", text: `File name: ${fileName}\n\n${prompt}` },
    ],
    maxTokens: 8192,
    timeoutMs: 90_000,
  });
  return parseClaudeJson<RawExtraction>(raw);
}

// ─── Merge multiple extractions ────────────────────────────────────────────────

function mergeExtractions(
  extractions: Array<{ raw: RawExtraction; fileName: string }>,
): Pick<
  MergedExtractionResult,
  | "current_period"
  | "prior_period"
  | "document_metadata"
  | "top_expenses"
  | "top_income_sources"
  | "data_quality"
  | "source_map"
  | "conflicts"
> {
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
    if (
      (conf[raw.data_quality?.overall_confidence] ?? 0) >
      (conf[merged.data_quality?.overall_confidence] ?? 0)
    ) {
      merged.data_quality = raw.data_quality;
    }
  }

  return { ...merged, source_map, conflicts };
}

// ─── Normalise to 12-month annualised values ───────────────────────────────────

const FLOW_FIELDS_IS = [
  "revenue",
  "cogs",
  "gross_profit",
  "fixed_costs",
  "labor_cost",
  "depreciation",
  "amortisation",
  "depreciation_amortisation_total",
  "ebitda",
  "ebit",
  "interest_expense",
  "ebt",
  "tax",
  "net_income",
  "director_remuneration",
  "dividends_declared",
] as const;

const FLOW_FIELDS_CFS = ["operating_cash_flow", "capex", "dividends_paid"] as const;

function normaliseExtraction<T extends Pick<RawExtraction, "current_period" | "document_metadata">>(
  extraction: T,
): T & {
  normalisation_applied: boolean;
  original_period_months?: number;
  annualisation_factor?: number;
} {
  const periodMonths = extraction.document_metadata?.period_months ?? 12;
  const annualisationFactor = 12 / periodMonths;

  if (periodMonths === 12) {
    return { ...extraction, normalisation_applied: false };
  }

  const normalised = JSON.parse(JSON.stringify(extraction)) as T;

  for (const field of FLOW_FIELDS_IS) {
    const is = normalised.current_period.income_statement as unknown as Record<
      string,
      number | null
    >;
    if (is[field] != null) is[field] = Math.round(is[field]! * annualisationFactor * 100) / 100;
  }

  for (const field of FLOW_FIELDS_CFS) {
    const cfs = normalised.current_period.cash_flow_statement as unknown as Record<
      string,
      number | null
    >;
    if (cfs[field] != null) cfs[field] = Math.round(cfs[field]! * annualisationFactor * 100) / 100;
  }

  return {
    ...normalised,
    normalisation_applied: true,
    original_period_months: periodMonths,
    annualisation_factor: annualisationFactor,
  };
}

// ─── Server function: AI PDF extraction ───────────────────────────────────────

// Exactly one of storagePath (staged PDF) or base64 (small inline PDF).
const PDFFileSchema = z
  .object({
    storagePath: z.string().max(200).optional(),
    base64: z.string().max(INLINE_BASE64_MAX).optional(),
    fileName: z.string().max(255),
  })
  .refine((f) => Boolean(f.storagePath) !== Boolean(f.base64), {
    message: "Send either storagePath or base64 for each file.",
  });

export const extractPDFsWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        files: z.array(PDFFileSchema).min(1).max(3),
        market: marketInputSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const prompt = financialExtractionPrompt(resolvePromptMarket(data.market));
    const files = await Promise.all(
      data.files.map(async (f) => ({
        fileName: f.fileName,
        base64: await resolvePdfBase64(context.supabase.storage, context.userId, f),
      })),
    );
    for (const f of files) {
      const sizeBytes = Math.ceil((f.base64.length * 3) / 4);
      if (sizeBytes > 32 * 1024 * 1024) {
        throw new Error(`"${f.fileName}" exceeds 32 MB. Please compress or split the file.`);
      }
    }

    // Call Claude for each PDF in parallel
    const extractions = await Promise.all(
      files.map(async (f) => ({
        raw: await callClaudePDF(f.base64, f.fileName, prompt),
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

    assertUsable(assessMergedExtraction(result));

    return result;
  });

// ─── Legacy server function: CSV / Excel / text ────────────────────────────────

const FIELDS = [
  "revenue",
  "cogs",
  "ebit",
  "ebt",
  "netIncome",
  "ebitda",
  "operatingCashflow",
  "totalAssets",
  "equity",
  "receivables",
  "inventory",
  "payables",
  "fixedCosts",
  "variableCosts",
  "top5Revenue",
  "laborCost",
  "employees",
  "founderHours",
];

const KEYWORDS: Record<string, string[]> = {
  revenue: ["total revenue", "total turnover", "revenue", "turnover", "net sales", "total sales"],
  cogs: ["cost of goods sold", "cost of sales", "cost of revenue", "direct costs"],
  ebit: ["operating profit", "profit from operations", "ebit"],
  ebt: ["profit before tax", "income before tax", "profit before income tax", "ebt"],
  netIncome: [
    "profit after tax",
    "net income",
    "net profit",
    "profit for the year",
    "profit for the period",
  ],
  ebitda: ["ebitda"],
  operatingCashflow: [
    "net cash from operating",
    "cash from operating activities",
    "cash generated from operations",
  ],
  totalAssets: ["total assets"],
  equity: [
    "total equity",
    "shareholders equity",
    "stockholders equity",
    "total shareholders",
    "net assets",
  ],
  receivables: [
    "accounts receivable",
    "trade receivables",
    "trade and other receivables",
    "debtors",
  ],
  inventory: ["inventories", "inventory", "stock"],
  payables: ["accounts payable", "trade payables", "trade and other payables", "creditors"],
  fixedCosts: ["fixed costs", "fixed overhead", "fixed expenses"],
  variableCosts: ["variable costs", "variable expenses"],
  laborCost: [
    "employee costs",
    "staff costs",
    "salaries and wages",
    "payroll",
    "personnel costs",
    "remuneration",
  ],
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
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Record<string, string> = {};
  for (const [field, kws] of Object.entries(KEYWORDS)) {
    if (kws.length === 0 || out[field]) continue;
    for (const line of lines) {
      const lc = line.toLowerCase();
      if (kws.some((kw) => lc.includes(kw))) {
        const n = extractNumber(line);
        if (n !== null) {
          out[field] = String(n);
          break;
        }
      }
    }
  }
  return out;
}

async function aiExtractText(
  text: string,
  fileName: string,
  market = ZA_MARKET,
): Promise<Record<string, string>> {
  if (!process.env.ANTHROPIC_API_KEY) return {};

  try {
    const raw = await callClaudeMessages({
      content: [
        {
          type: "text",
          text: `${textExtractionSystem(market)}\n\nFile: ${fileName}\n\nContents:\n${text.slice(0, 80_000)}`,
        },
      ],
      maxTokens: 4096,
      timeoutMs: 60_000,
    });
    const parsed = parseClaudeJson<Record<string, unknown>>(raw);
    const out: Record<string, string> = {};
    for (const k of FIELDS) {
      const val = parsed[k];
      if (typeof val === "number" && isFinite(val)) out[k] = String(Math.round(val * 100) / 100);
      else if (typeof val === "string" && val.trim()) {
        const n = parseFloat(val.replace(/[^0-9.-]/g, ""));
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
    z
      .object({
        fileName: z.string(),
        mimeType: z.string().optional(),
        text: z.string().max(500_000).optional(),
        market: marketInputSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!data.text?.trim()) throw new Error("No usable content provided");
    const docText = data.text.slice(0, 120_000);
    const aiResult = await aiExtractText(docText, data.fileName, resolvePromptMarket(data.market));
    const patternResult = patternExtract(docText);
    const merged: Record<string, string> = { ...patternResult, ...aiResult };
    assertUsable(assessFlatExtraction(Object.keys(merged).length));
    return { financials: merged, fieldCount: Object.keys(merged).length };
  });
