import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GEMINI_MODEL, GEMINI_MODEL_GATEWAY } from "@/lib/gemini-config";

export type NewsItem = {
  headline: string;
  summary: string;
  tag: string;
  tagColor: "green" | "amber" | "red" | "blue";
};

export type PulseMetric = {
  label: string;
  value: string;
  /** up / down / flat — visual arrow */
  direction: "up" | "down" | "flat";
  /** whether the move is good/bad for an SME */
  sentiment: "good" | "bad" | "neutral";
};

export type IndustryPulsePayload = {
  headline: string;
  metrics: PulseMetric[];
  items: NewsItem[];
  source: "ai" | "fallback";
};

const NewsSchema = z.object({
  industry: z.string().max(120),
});

const TAG_COLORS = new Set(["green", "amber", "red", "blue"]);

function normalizeTagColor(raw: unknown): NewsItem["tagColor"] {
  const c = String(raw ?? "amber").toLowerCase();
  return (TAG_COLORS.has(c) ? c : "amber") as NewsItem["tagColor"];
}

function normalizeItems(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const headline = String(o.headline ?? "").trim();
      const summary = String(o.summary ?? "").trim();
      if (!headline || !summary) return null;
      return {
        headline: headline.slice(0, 120),
        summary: summary.slice(0, 280),
        tag: String(o.tag ?? "Watch this").slice(0, 40),
        tagColor: normalizeTagColor(o.tagColor),
      } satisfies NewsItem;
    })
    .filter((x): x is NewsItem => Boolean(x))
    .slice(0, 3);
}

function normalizeMetrics(raw: unknown): PulseMetric[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const o = m as Record<string, unknown>;
      const label = String(o.label ?? "").trim();
      const value = String(o.value ?? "").trim();
      if (!label || !value) return null;
      const directionRaw = String(o.direction ?? "flat").toLowerCase();
      const direction =
        directionRaw === "up" || directionRaw === "down" ? directionRaw : "flat";
      const sentimentRaw = String(o.sentiment ?? "neutral").toLowerCase();
      const sentiment =
        sentimentRaw === "good" || sentimentRaw === "bad" ? sentimentRaw : "neutral";
      return { label: label.slice(0, 60), value: value.slice(0, 40), direction, sentiment } satisfies PulseMetric;
    })
    .filter((x): x is PulseMetric => Boolean(x))
    .slice(0, 4);
}

/** Curated SA SME pulse — used when AI keys are missing or the model fails. */
export function fallbackIndustryPulse(industry: string): IndustryPulsePayload {
  const key = industry.toLowerCase();
  const sector =
    key.includes("retail") || key.includes("ecom")
      ? "retail"
      : key.includes("construct") || key.includes("build")
        ? "construction"
        : key.includes("hospital") || key.includes("restaurant") || key.includes("food")
          ? "hospitality"
          : key.includes("manufactur") || key.includes("factory")
            ? "manufacturing"
            : key.includes("logistics") || key.includes("transport")
              ? "logistics"
              : key.includes("saas") || key.includes("software") || key.includes("tech")
                ? "saas"
                : key.includes("service") || key.includes("agency") || key.includes("consult")
                  ? "services"
                  : "general";

  const packs: Record<string, IndustryPulsePayload> = {
    retail: {
      headline: "Your industry is tightening.",
      metrics: [
        { label: "Gross margins", value: "↓ 2.4%", direction: "down", sentiment: "bad" },
        { label: "Customer payment days", value: "↑ 5d", direction: "up", sentiment: "bad" },
        { label: "Demand", value: "→ Stable", direction: "flat", sentiment: "neutral" },
      ],
      items: [
        {
          headline: "SA retailers face margin squeeze on import costs",
          summary: "Rand volatility and higher logistics fees are compressing SME retail gross margins — lock supplier prices where you can.",
          tag: "Affects margins",
          tagColor: "red",
        },
        {
          headline: "Card-fee and load-shedding costs still biting",
          summary: "Payment fees and backup-power spend are eating cash that used to sit in working capital.",
          tag: "Watch this",
          tagColor: "amber",
        },
        {
          headline: "Same-day delivery expectations keep rising",
          summary: "Customers expect faster fulfilment; slow stock turns are becoming a competitive risk.",
          tag: "Opportunity",
          tagColor: "blue",
        },
      ],
      source: "fallback",
    },
    construction: {
      headline: "Cash cycles are stretching.",
      metrics: [
        { label: "Payment retentions", value: "↑ 8d", direction: "up", sentiment: "bad" },
        { label: "Material costs", value: "↑ 3.1%", direction: "up", sentiment: "bad" },
        { label: "Tender activity", value: "→ Soft", direction: "flat", sentiment: "neutral" },
      ],
      items: [
        {
          headline: "Milestone billing delays still dominate cash",
          summary: "Private and public clients are stretching retentions — deposits and staged billing protect runway.",
          tag: "Affects cash",
          tagColor: "red",
        },
        {
          headline: "Steel and cement prices remain sticky",
          summary: "Input inflation is uneven; update quotes more often and pass through material clauses.",
          tag: "Affects margins",
          tagColor: "amber",
        },
        {
          headline: "Subcontractor capacity opening in metros",
          summary: "Some trades have idle capacity — useful if you need to accelerate committed jobs.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    hospitality: {
      headline: "Demand is uneven across the week.",
      metrics: [
        { label: "Covers / traffic", value: "↓ 4%", direction: "down", sentiment: "bad" },
        { label: "Food cost pressure", value: "↑ 2.8%", direction: "up", sentiment: "bad" },
        { label: "Weekend demand", value: "→ Firm", direction: "flat", sentiment: "good" },
      ],
      items: [
        {
          headline: "Weekday covers soft while weekends hold",
          summary: "Owners are protecting cash by trimming weekday labour and pushing midweek offers.",
          tag: "Watch this",
          tagColor: "amber",
        },
        {
          headline: "Load-shedding backup costs still elevate break-even",
          summary: "Generator and inverter spend keeps fixed costs high — menu mix and covers matter more.",
          tag: "Affects margins",
          tagColor: "red",
        },
        {
          headline: "Prepaid and deposit policies gaining ground",
          summary: "Events and large tables paid upfront are improving hospitality cash conversion.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    manufacturing: {
      headline: "Working capital is the pressure point.",
      metrics: [
        { label: "Input costs", value: "↑ 2.1%", direction: "up", sentiment: "bad" },
        { label: "Order books", value: "→ Stable", direction: "flat", sentiment: "neutral" },
        { label: "Export demand", value: "↓ Soft", direction: "down", sentiment: "bad" },
      ],
      items: [
        {
          headline: "SA manufacturers guarding inventory turns",
          summary: "Slow-moving SKUs are trapping cash — review minimum order quantities and stock aged past 60 days.",
          tag: "Affects cash",
          tagColor: "amber",
        },
        {
          headline: "Electricity reliability still shapes throughput",
          summary: "Unplanned downtime lifts unit cost; schedule high-margin runs around stable power windows.",
          tag: "Watch this",
          tagColor: "red",
        },
        {
          headline: "Nearshore B2B buyers asking for deposits",
          summary: "More suppliers are requiring deposits — mirror that with your own customers where you can.",
          tag: "Opportunity",
          tagColor: "blue",
        },
      ],
      source: "fallback",
    },
    logistics: {
      headline: "Fuel and utilisation decide the week.",
      metrics: [
        { label: "Fuel / diesel pressure", value: "↑ 1.9%", direction: "up", sentiment: "bad" },
        { label: "Fleet utilisation", value: "→ Flat", direction: "flat", sentiment: "neutral" },
        { label: "Customer rate pressure", value: "↓ Soft", direction: "down", sentiment: "bad" },
      ],
      items: [
        {
          headline: "Thin margins leave little room for empty kilometres",
          summary: "Route density and return loads are the fastest levers when diesel moves against you.",
          tag: "Affects margins",
          tagColor: "red",
        },
        {
          headline: "Clients delaying payment on freight invoices",
          summary: "Debtor days are creeping — COD or 7-day terms on smaller accounts protect cash.",
          tag: "Affects cash",
          tagColor: "amber",
        },
        {
          headline: "Shared-load platforms opening spare capacity",
          summary: "Filling backhauls can recover margin without adding fixed fleet cost.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    saas: {
      headline: "Buyers are stretching payment terms.",
      metrics: [
        { label: "Sales cycles", value: "↑ 12d", direction: "up", sentiment: "bad" },
        { label: "Churn pressure", value: "→ Elevated", direction: "flat", sentiment: "bad" },
        { label: "Expansion revenue", value: "↑ Mild", direction: "up", sentiment: "good" },
      ],
      items: [
        {
          headline: "SA SaaS buyers delaying renewals and upgrades",
          summary: "Annual prepay discounts and tighter dunning are protecting cash conversion.",
          tag: "Affects cash",
          tagColor: "amber",
        },
        {
          headline: "Usage-based packaging winning late-stage deals",
          summary: "Lower entry commitments help close when budgets are frozen — watch margin on support load.",
          tag: "Opportunity",
          tagColor: "green",
        },
        {
          headline: "Cloud infra costs still rising with FX",
          summary: "Dollar-linked hosting can quietly erase gross margin — review packaging and FX buffers.",
          tag: "Affects margins",
          tagColor: "red",
        },
      ],
      source: "fallback",
    },
    services: {
      headline: "Collections are the binding constraint.",
      metrics: [
        { label: "Debtor days", value: "↑ 6d", direction: "up", sentiment: "bad" },
        { label: "Utilisation", value: "→ Stable", direction: "flat", sentiment: "neutral" },
        { label: "Fee pressure", value: "↓ Soft", direction: "down", sentiment: "bad" },
      ],
      items: [
        {
          headline: "Professional services seeing slower client pay",
          summary: "Retainers, deposits and autopay are outperforming pure month-end invoicing on cash.",
          tag: "Affects cash",
          tagColor: "red",
        },
        {
          headline: "Scope creep without change orders is back",
          summary: "Protect margin with written change control before extra hours land on the timesheet.",
          tag: "Affects margins",
          tagColor: "amber",
        },
        {
          headline: "Niche expertise still commanding premiums",
          summary: "Specialist packages with clear outcomes are resisting fee pressure better than generalist retainers.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    general: {
      headline: "Your industry is tightening.",
      metrics: [
        { label: "Gross margins", value: "↓ 2.4%", direction: "down", sentiment: "bad" },
        { label: "Customer payment days", value: "↑ 5d", direction: "up", sentiment: "bad" },
        { label: "Demand", value: "→ Stable", direction: "flat", sentiment: "neutral" },
      ],
      items: [
        {
          headline: "SA SMEs under working-capital pressure",
          summary: "Slower customer payment and sticky input costs are the common squeeze across sectors.",
          tag: "Affects cash",
          tagColor: "red",
        },
        {
          headline: "Interest rates still elevate financing cost",
          summary: "Debt-funded growth is expensive — free cash from collections beats new facilities.",
          tag: "Watch this",
          tagColor: "amber",
        },
        {
          headline: "Owners prioritising deposits and autopay",
          summary: "Businesses that pull cash forward are building runway while peers stall.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
  };

  const pack = packs[sector] ?? packs.general;
  return {
    ...pack,
    headline: pack.headline,
    items: pack.items.map((item) => ({
      ...item,
      summary: item.summary.includes(industry)
        ? item.summary
        : item.summary,
    })),
  };
}

function extractJsonObject(raw: string): unknown {
  const clean = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        /* fall through */
      }
    }
    const arrMatch = clean.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

function parseAiPayload(raw: string, industry: string): IndustryPulsePayload | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  // New shape: { headline, metrics, items }
  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    const items = normalizeItems(o.items ?? o.news);
    const metrics = normalizeMetrics(o.metrics);
    const headline = String(o.headline ?? "").trim();
    if (items.length === 0 && metrics.length === 0) return null;
    const fb = fallbackIndustryPulse(industry);
    return {
      headline: headline || fb.headline,
      metrics: metrics.length ? metrics : fb.metrics,
      items: items.length ? items : fb.items,
      source: "ai",
    };
  }

  // Legacy shape: bare news array
  if (Array.isArray(parsed)) {
    const items = normalizeItems(parsed);
    if (!items.length) return null;
    const fb = fallbackIndustryPulse(industry);
    return { headline: fb.headline, metrics: fb.metrics, items, source: "ai" };
  }

  return null;
}

function buildPrompt(industry: string, today: string): string {
  return `You are a South African business intelligence assistant. Today is ${today}.

For a South African SME in the "${industry}" sector, produce a concise Industry Pulse.

Respond ONLY with valid JSON (no markdown fencing, no preamble):
{
  "headline": "One short status line about industry conditions (max 8 words), e.g. Your industry is tightening.",
  "metrics": [
    { "label": "Gross margins", "value": "↓ 2.4%", "direction": "up|down|flat", "sentiment": "good|bad|neutral" },
    { "label": "Customer payment days", "value": "↑ 5d", "direction": "up|down|flat", "sentiment": "good|bad|neutral" },
    { "label": "Demand", "value": "→ Stable", "direction": "up|down|flat", "sentiment": "good|bad|neutral" }
  ],
  "items": [
    {
      "headline": "Concise punchy headline (max 10 words)",
      "summary": "One sentence: what happened and why it matters to an SME owner.",
      "tag": "Affects margins | Regulatory | Watch this | Opportunity | Affects cash",
      "tagColor": "green | amber | red | blue"
    }
  ]
}

Rules:
- Exactly 3 metrics and 3 news items
- Focus on SA conditions: rates, rand, fuel, SARS/tax, load-shedding, sector demand, payment behaviour
- direction/sentiment must be consistent (e.g. longer payment days = direction up + sentiment bad)
- Be specific to ${industry}; do not invent fake article URLs`;
}

async function callLovable(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GEMINI_MODEL_GATEWAY,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (res.status === 429) throw new Error("Rate limit hit — try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI error (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callGeminiDirect(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (res.status === 429) throw new Error("Rate limit hit — try again in a moment.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini error (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (res.status === 429) throw new Error("Rate limit hit — try again in a moment.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

export const fetchIndustryNews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => NewsSchema.parse(input))
  .handler(async ({ data }): Promise<IndustryPulsePayload> => {
    const industry = data.industry.trim() || "General SME";
    const today = new Date().toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const prompt = buildPrompt(industry, today);
    const fallback = fallbackIndustryPulse(industry);

    const lovableKey = process.env.LOVABLE_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const attempts: Array<() => Promise<string>> = [];
    if (lovableKey) attempts.push(() => callLovable(lovableKey, prompt));
    if (geminiKey) attempts.push(() => callGeminiDirect(geminiKey, prompt));
    if (openaiKey) attempts.push(() => callOpenAI(openaiKey, prompt));

    // No AI keys configured — still return useful curated pulse (never blank UI).
    if (attempts.length === 0) return fallback;

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      try {
        const raw = await attempt();
        const parsed = parseAiPayload(raw, industry);
        if (parsed) return parsed;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        // Try next provider; only surface hard quota errors if every path fails
        // and we somehow have no fallback (we always do).
        if (
          lastError.message.includes("Rate limit") ||
          lastError.message.includes("credits exhausted")
        ) {
          // keep trying other providers first
        }
      }
    }

    // Prefer showing curated intelligence over a blank/error panel.
    return {
      ...fallback,
      items: lastError
        ? fallback.items
        : fallback.items,
    };
  });
