import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLAUDE_MODEL } from "@/lib/claude-config";

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

/** Plain-English SA SME pulse — used when AI keys are missing or the model fails. */
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
      headline: "Customers are spending, but profit per sale is thinner.",
      metrics: [
        { label: "Profit per sale", value: "Down", direction: "down", sentiment: "bad" },
        { label: "How fast customers pay", value: "Slower", direction: "up", sentiment: "bad" },
        { label: "Customer demand", value: "Steady", direction: "flat", sentiment: "neutral" },
      ],
      items: [
        {
          headline: "Import and delivery costs are eating retail profit",
          summary: "A weaker rand and higher delivery fees mean you keep less from each sale. Lock supplier prices for 30–90 days where you can.",
          tag: "Affects profit",
          tagColor: "red",
        },
        {
          headline: "Card fees and backup power quietly drain cash",
          summary: "Payment fees and generators add up every month. Check these costs — they often grow unnoticed.",
          tag: "Watch this",
          tagColor: "amber",
        },
        {
          headline: "Faster delivery wins more repeat buyers",
          summary: "Customers expect quicker fulfilment. Faster stock turns free cash and keep you competitive.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    construction: {
      headline: "Jobs are fine — getting paid on time is the hard part.",
      metrics: [
        { label: "How long clients take to pay", value: "Slower", direction: "up", sentiment: "bad" },
        { label: "Material costs", value: "Rising", direction: "up", sentiment: "bad" },
        { label: "New tender activity", value: "Soft", direction: "flat", sentiment: "neutral" },
      ],
      items: [
        {
          headline: "Clients are holding back payment longer",
          summary: "Ask for a deposit before work starts, and bill in stages. Waiting until the end traps your cash.",
          tag: "Affects cash",
          tagColor: "red",
        },
        {
          headline: "Steel and cement prices keep moving",
          summary: "Update quotes more often, and add a materials price clause so cost jumps don’t wipe your margin.",
          tag: "Affects profit",
          tagColor: "amber",
        },
        {
          headline: "Some trades have spare capacity right now",
          summary: "If a job is delayed, you may find subcontractors available sooner — useful for catching up.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    hospitality: {
      headline: "Weekends are busy — weekdays need tighter cost control.",
      metrics: [
        { label: "Customer traffic", value: "Softer midweek", direction: "down", sentiment: "bad" },
        { label: "Food & drink costs", value: "Rising", direction: "up", sentiment: "bad" },
        { label: "Weekend demand", value: "Strong", direction: "flat", sentiment: "good" },
      ],
      items: [
        {
          headline: "Weekdays are quiet while weekends hold up",
          summary: "Cut midweek labour where you can, and run simple midweek specials to fill empty seats.",
          tag: "Watch this",
          tagColor: "amber",
        },
        {
          headline: "Backup power is raising your break-even",
          summary: "Generators and inverters cost money even when sales are flat. Push higher-margin menu items.",
          tag: "Affects profit",
          tagColor: "red",
        },
        {
          headline: "Take deposits for events and large bookings",
          summary: "Upfront payment for functions improves cash and reduces no-shows.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    manufacturing: {
      headline: "Orders are steady — cash is stuck in stock and receivables.",
      metrics: [
        { label: "Input costs", value: "Rising", direction: "up", sentiment: "bad" },
        { label: "Order book", value: "Steady", direction: "flat", sentiment: "neutral" },
        { label: "Export demand", value: "Softer", direction: "down", sentiment: "bad" },
      ],
      items: [
        {
          headline: "Slow-moving stock is trapping your cash",
          summary: "Review items sitting longer than 60 days. Smaller order quantities free money faster.",
          tag: "Affects cash",
          tagColor: "amber",
        },
        {
          headline: "Power cuts raise your cost per unit",
          summary: "Plan high-margin production for more reliable power windows when you can.",
          tag: "Watch this",
          tagColor: "red",
        },
        {
          headline: "Ask customers for deposits on big orders",
          summary: "Many suppliers already do this. Matching that with your customers protects cash flow.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    logistics: {
      headline: "Fuel costs are up — empty trips hurt the most.",
      metrics: [
        { label: "Diesel / fuel cost", value: "Rising", direction: "up", sentiment: "bad" },
        { label: "Truck / vehicle use", value: "Flat", direction: "flat", sentiment: "neutral" },
        { label: "Customer pricing pressure", value: "Soft", direction: "down", sentiment: "bad" },
      ],
      items: [
        {
          headline: "Empty return trips wipe out thin margins",
          summary: "Fill return loads wherever possible. Empty kilometres are often your biggest profit leak.",
          tag: "Affects profit",
          tagColor: "red",
        },
        {
          headline: "Customers are paying freight invoices later",
          summary: "For smaller accounts, use cash-on-delivery or 7-day payment terms to protect cash.",
          tag: "Affects cash",
          tagColor: "amber",
        },
        {
          headline: "Shared loads can fill spare capacity",
          summary: "Matching spare space with other shippers can lift profit without buying more vehicles.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    saas: {
      headline: "Deals take longer — get paid sooner when you can.",
      metrics: [
        { label: "Time to close a sale", value: "Longer", direction: "up", sentiment: "bad" },
        { label: "Customer cancellations", value: "Higher risk", direction: "up", sentiment: "bad" },
        { label: "Upsell / expansion", value: "Mild growth", direction: "up", sentiment: "good" },
      ],
      items: [
        {
          headline: "Buyers are delaying renewals and upgrades",
          summary: "Offer a discount for annual prepay, and follow up unpaid invoices quickly.",
          tag: "Affects cash",
          tagColor: "amber",
        },
        {
          headline: "Simple starter packages help close deals",
          summary: "When budgets are tight, a lower entry price with clear upgrade paths wins more often.",
          tag: "Opportunity",
          tagColor: "green",
        },
        {
          headline: "Dollar hosting costs can erase your margin",
          summary: "If your tools are priced in dollars, check that your SA pricing still leaves enough profit.",
          tag: "Affects profit",
          tagColor: "red",
        },
      ],
      source: "fallback",
    },
    services: {
      headline: "Clients are paying slower — cash is the pressure point.",
      metrics: [
        { label: "How fast clients pay", value: "6 days slower", direction: "up", sentiment: "bad" },
        { label: "Team billable time", value: "Steady", direction: "flat", sentiment: "neutral" },
        { label: "Client fee pressure", value: "Clients pushing down", direction: "down", sentiment: "bad" },
      ],
      items: [
        {
          headline: "Clients are taking longer to pay invoices",
          summary: "Ask for a deposit or monthly retainer, and turn on autopay. Waiting until month-end hurts cash.",
          tag: "Affects cash",
          tagColor: "red",
        },
        {
          headline: "Extra unpaid work is wiping out profit",
          summary: "If the brief grows, send a written change request before the extra hours start.",
          tag: "Affects profit",
          tagColor: "amber",
        },
        {
          headline: "Specialist packages still win higher fees",
          summary: "Clear outcome-based offers hold price better than open-ended generalist retainers.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
    general: {
      headline: "Cash is tighter — get paid faster and watch costs.",
      metrics: [
        { label: "Profit per sale", value: "Down a bit", direction: "down", sentiment: "bad" },
        { label: "How fast customers pay", value: "Slower", direction: "up", sentiment: "bad" },
        { label: "Customer demand", value: "Steady", direction: "flat", sentiment: "neutral" },
      ],
      items: [
        {
          headline: "Customers are paying SA businesses slower",
          summary: "Send invoices the same day, follow up early, and ask for deposits on bigger jobs.",
          tag: "Affects cash",
          tagColor: "red",
        },
        {
          headline: "Borrowing is still expensive",
          summary: "Collecting cash from customers is usually cheaper than taking on more debt right now.",
          tag: "Watch this",
          tagColor: "amber",
        },
        {
          headline: "Deposits and autopay are helping owners",
          summary: "Businesses that get paid upfront or automatically usually sleep better than those waiting 30–60 days.",
          tag: "Opportunity",
          tagColor: "green",
        },
      ],
      source: "fallback",
    },
  };

  return packs[sector] ?? packs.general;
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
  return `You write Industry Pulse for South African small-business owners. Today is ${today}.
Sector: "${industry}".

Write for a busy owner — Grade 8 English. No jargon. No MBA speak.
Bad: "Collections are the binding constraint", "utilisation", "fee pressure", "scope creep", "cash conversion".
Good: "Clients are paying slower", "Team billable time", "Clients pushing fees down", "Extra unpaid work is eating profit".

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
      "headline": "Plain headline a business owner gets instantly (max 12 words)",
      "summary": "One sentence: what is happening + one practical action they can take this week.",
      "tag": "Affects cash | Affects profit | Watch this | Opportunity",
      "tagColor": "green | amber | red | blue"
    }
  ]
}

Rules:
- Exactly 3 metrics and 3 news items
- Metric labels must be everyday words (not debtor days, utilisation, fee pressure, working capital)
- Metric values must be readable words or simple numbers (e.g. "↓ Slower", "↑ Rising", "→ Steady") — not cryptic codes
- Each news summary must end with a concrete action
- Focus on SA realities: payment delays, rand, fuel, power cuts, SARS/tax, demand
- Specific to ${industry}
- Do not invent fake article titles that sound like press releases
- Do not use the words: utilisation, debtor days, fee pressure, scope creep, binding constraint, cash conversion, working capital, ROIC`;
}

/** Primary provider: Claude Sonnet 4.6 via Anthropic Messages API. */
async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (res.status === 429) throw new Error("Rate limit hit — try again in a moment.");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude error (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
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

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return fallback;

    try {
      const raw = await callClaude(anthropicKey, prompt);
      const parsed = parseAiPayload(raw, industry);
      if (parsed) return parsed;
    } catch {
      // Prefer curated baseline over a blank/error panel.
    }

    return fallback;
  });
