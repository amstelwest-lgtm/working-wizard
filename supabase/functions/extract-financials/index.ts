// Extracts a structured financials JSON from an uploaded financial statement
// (CSV text, Excel-as-CSV text, or PDF as base64) using Claude Sonnet 5.5.
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import {
  CONTRA_ASSET_EXTRACTION_RULE,
  reconcileFlatFinancials,
} from "../../../src/lib/contra-assets.ts";
import { statementModelParts } from "../../../src/lib/statement-text-layer.ts";
import { claudeRequestFields } from "../../../src/lib/claude-request.ts";
import { CLAUDE_MODEL } from "../_shared/claude-model.ts";
import { buildTextExtractionPayload } from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

const SYSTEM = `You are a financial-statement parser. Extract the following figures from the supplied document and return ONLY valid JSON, no prose, no markdown.

Required keys (all numbers, in the same currency unit as the document — typically thousands or millions; preserve whatever the document uses). If a value is not present, omit the key.

Keys:
- revenue (turnover / sales / total revenue)
- cogs (cost of sales / cost of goods sold)
- ebit (operating profit)
- ebt (profit before tax)
- netIncome (profit after tax / net profit)
- ebitda (operating profit + depreciation + amortisation; estimate if not stated)
- operatingCashflow (cash generated from operations)
- totalAssets
- equity (total equity / shareholders' funds)
- receivables (trade debtors / accounts receivable)
- inventory (stock)
- payables (trade creditors / accounts payable)
- fixedCosts (rent + salaries + insurance + other recurring overheads if itemised)
- variableCosts (variable opex; often ≈ COGS if not separately stated)
- top5Revenue (revenue from top-5 customers if disclosed)
- laborCost (employee costs / wages / payroll)
- employees (headcount)
- founderHours (annual founder hours; usually not in statements — omit)

${CONTRA_ASSET_EXTRACTION_RULE}

Use the most recent period if multiple are shown. Negative numbers stay negative. Return strictly: {"revenue": 1234, "cogs": 567, ...}`;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pdfToText(b64: string): Promise<string> {
  const bytes = base64ToBytes(b64);
  if (bytes.byteLength > 15 * 1024 * 1024) {
    throw new Error(`PDF too large: ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB (max 15MB)`);
  }
  const pdf = await getDocumentProxy(bytes);
  try {
    // mergePages replaces every newline with a space, which detaches statement rows.
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } finally {
    try {
      await pdf.destroy();
    } catch {
      // Destroy is best-effort. A failed cleanup must not drop the text.
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { mimeType, base64, text, fileName } = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "AI is not configured (ANTHROPIC_API_KEY missing)" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // PDF: text layer first. A good extract is redacted and sent as text.
    // Scans and scrambled columns fall back to the original PDF bytes.
    const isPdf = mimeType === "application/pdf" || (fileName ?? "").toLowerCase().endsWith(".pdf");

    let content: Array<Record<string, unknown>>;
    let debugTextChars = 0;
    let usedTextLayer = false;
    let pdfText = "";

    if (base64 && isPdf) {
      let extracted = "";
      try {
        extracted = await pdfToText(base64);
      } catch {
        extracted = "";
      }
      pdfText = extracted;
      const prepared = statementModelParts({
        extractedText: extracted,
        document: { mediaType: "application/pdf", base64 },
        fileName,
        instructions: SYSTEM,
        layout: "financial",
      });
      content = prepared.parts;
      usedTextLayer = prepared.usedTextLayer;
      debugTextChars = usedTextLayer ? prepared.quality.chars : 0;
    } else if (text && text.trim().length > 0) {
      const docText = text.slice(0, 120_000);
      debugTextChars = docText.length;
      const sealed = buildTextExtractionPayload({
        instructions: SYSTEM,
        fileName,
        text: docText,
      });
      content = [
        {
          type: "text",
          text: sealed.text,
        },
      ];
    } else {
      return new Response(JSON.stringify({ error: "No usable text or PDF provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content }],
        ...claudeRequestFields({ model: CLAUDE_MODEL }),
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a moment." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiRes.ok) {
      const t = await aiRes.text();
      return new Response(JSON.stringify({ error: `Claude: ${aiRes.status} ${t.slice(0, 300)}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const raw =
      ((aiJson?.content ?? []) as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim() || "{}";
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    const out: Record<string, string> = {};
    for (const k of FIELDS) {
      const val = parsed[k];
      if (typeof val === "number" && isFinite(val)) out[k] = String(Math.round(val * 100) / 100);
      else if (typeof val === "string" && val.trim() !== "") {
        const n = parseFloat(val.replace(/[^0-9.\-]/g, ""));
        if (isFinite(n)) out[k] = String(n);
      }
    }
    if (usedTextLayer && pdfText) {
      const reconciled = reconcileFlatFinancials(out, pdfText);
      if (reconciled.totalAssets) out.totalAssets = reconciled.totalAssets;
      if (reconciled.equity) out.equity = reconciled.equity;
    }

    return new Response(
      JSON.stringify({
        financials: out,
        debug: { textChars: debugTextChars, textLayer: usedTextLayer, model: CLAUDE_MODEL },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
