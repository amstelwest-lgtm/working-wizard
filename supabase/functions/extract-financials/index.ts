// Extracts a structured financials JSON from an uploaded financial statement
// (CSV text, Excel-as-CSV text, or PDF as base64) using the Lovable AI Gateway.
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIELDS = [
  "revenue", "cogs", "ebit", "ebt", "netIncome", "ebitda",
  "operatingCashflow", "totalAssets", "equity", "receivables",
  "inventory", "payables", "fixedCosts", "variableCosts",
  "top5Revenue", "laborCost", "employees", "founderHours",
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
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).slice(0, 60_000);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { mimeType, base64, text, fileName } = await req.json();
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI gateway not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve to plain text — extract from PDF server-side via unpdf.
    let docText = "";
    if (text && text.trim().length > 0) {
      docText = text.slice(0, 120_000);
    } else if (base64 && (mimeType === "application/pdf" || (fileName ?? "").toLowerCase().endsWith(".pdf"))) {
      try {
        docText = await pdfToText(base64);
      } catch (e) {
        return new Response(JSON.stringify({ error: `PDF parse failed: ${(e as Error).message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!docText.trim()) {
        return new Response(JSON.stringify({ error: "PDF appears to be scanned/image-only — no text could be extracted. Re-export as a text PDF or upload a CSV/Excel." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      return new Response(JSON.stringify({ error: "No usable text or PDF provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `File: ${fileName ?? "statement"}\n\nContents:\n${docText}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a moment." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Lovable Cloud." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!aiRes.ok) {
      const t = await aiRes.text();
      return new Response(JSON.stringify({ error: `AI gateway: ${aiRes.status} ${t.slice(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
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

    return new Response(JSON.stringify({ financials: out, debug: { textChars: docText.length } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
