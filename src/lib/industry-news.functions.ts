import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLAUDE_MODEL } from "@/lib/claude-config";
import {
  formatDate,
  industryPulsePrompt,
  localizeCopy,
  marketInputSchema,
  newsSearchUrl,
  resolvePromptMarket,
  ZA_MARKET,
  type ResolvedMarket,
} from "@/lib/market";

export type NewsItem = {
  headline: string;
  summary: string;
  tag: string;
  tagColor: "green" | "amber" | "red" | "blue";
  /** Public article / coverage URL when available */
  url: string | null;
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
  market: marketInputSchema,
});

const TAG_COLORS = new Set(["green", "amber", "red", "blue"]);

function normalizeTagColor(raw: unknown): NewsItem["tagColor"] {
  const c = String(raw ?? "amber").toLowerCase();
  return (TAG_COLORS.has(c) ? c : "amber") as NewsItem["tagColor"];
}

function normalizeUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Prefer a real URL; otherwise a Google News search for the headline. */
export function resolveNewsUrl(
  item: Pick<NewsItem, "headline" | "url">,
  market: Pick<ResolvedMarket, "copyPack"> = ZA_MARKET,
): string {
  if (item.url) return item.url;
  return newsSearchUrl(item.headline, market);
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
        url: normalizeUrl(o.url),
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
      const direction = directionRaw === "up" || directionRaw === "down" ? directionRaw : "flat";
      const sentimentRaw = String(o.sentiment ?? "neutral").toLowerCase();
      const sentiment =
        sentimentRaw === "good" || sentimentRaw === "bad" ? sentimentRaw : "neutral";
      return {
        label: label.slice(0, 60),
        value: value.slice(0, 40),
        direction,
        sentiment,
      } satisfies PulseMetric;
    })
    .filter((x): x is PulseMetric => Boolean(x))
    .slice(0, 4);
}

function adaptPulseForMarket(
  payload: IndustryPulsePayload,
  market: ResolvedMarket,
): IndustryPulsePayload {
  if (market.copyPack !== "us") return payload;
  const usHome = "https://www.reuters.com/business/";
  return {
    ...payload,
    headline: localizeCopy(payload.headline, market),
    items: payload.items.map((item) => ({
      ...item,
      headline: localizeCopy(item.headline, market)
        .replace(/\bSA\b/g, "US")
        .replace(/South African/g, "US")
        .replace(/South Africa/g, "the US"),
      summary: localizeCopy(item.summary, market)
        .replace(/\bSA\b/g, "US")
        .replace(/South African/g, "US")
        .replace(/South Africa/g, "the US"),
      tag:
        item.tag === "Rand" || item.tag === "Power" || item.tag === "Labour" ? "Costs" : item.tag,
      url:
        item.url &&
        /businesslive\.co\.za|moneyweb\.co\.za|news24\.com|resbank\.co\.za/i.test(item.url)
          ? usHome
          : item.url,
    })),
  };
}

/** Plain-English SME pulse — used when AI keys are missing or the model fails. */
export function fallbackIndustryPulse(
  industry: string,
  market: ResolvedMarket = ZA_MARKET,
): IndustryPulsePayload {
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
          headline: "Rand weakness lifts import and shipping costs for SA retailers",
          summary:
            "Weaker currency and higher courier rates are squeezing shelf margins on imported goods.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.businesslive.co.za/bd/economy/",
        },
        {
          headline: "Card fees and backup-power bills keep rising for stores",
          summary:
            "Payment charges and generator/inverter spend are showing up as a bigger share of monthly costs.",
          tag: "Costs",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/",
        },
        {
          headline: "Shoppers reward same-day and next-day fulfilment",
          summary:
            "Retail surveys show faster delivery is winning repeat purchases even when prices are similar.",
          tag: "Demand",
          tagColor: "green",
          url: "https://www.news24.com/business",
        },
      ],
      source: "fallback",
    },
    construction: {
      headline: "Jobs are fine — getting paid on time is the hard part.",
      metrics: [
        {
          label: "How long clients take to pay",
          value: "Slower",
          direction: "up",
          sentiment: "bad",
        },
        { label: "Material costs", value: "Rising", direction: "up", sentiment: "bad" },
        { label: "New tender activity", value: "Soft", direction: "flat", sentiment: "neutral" },
      ],
      items: [
        {
          headline: "Contractors report longer payment holds on completed work",
          summary:
            "Retention and late certificates are stretching cash cycles across residential and commercial jobs.",
          tag: "Payments",
          tagColor: "red",
          url: "https://www.engineeringnews.co.za/",
        },
        {
          headline: "Steel and cement prices remain volatile month to month",
          summary:
            "Builders say quote validity windows are shortening as material input costs keep swinging.",
          tag: "Costs",
          tagColor: "amber",
          url: "https://www.businesslive.co.za/bd/companies/industrials/",
        },
        {
          headline: "Private tender volumes soften while public works stay patchy",
          summary:
            "New private project starts are quieter; public pipelines remain uneven by province and sector.",
          tag: "Demand",
          tagColor: "blue",
          url: "https://www.news24.com/business",
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
          headline: "Midweek covers soften while weekend bookings hold",
          summary:
            "Restaurants and venues report a sharper split between busy weekends and quieter weekdays.",
          tag: "Demand",
          tagColor: "amber",
          url: "https://www.tourismupdate.co.za/",
        },
        {
          headline: "Food inflation and backup power lift break-even covers",
          summary:
            "Higher ingredient prices plus generator costs mean more seats must sell before a shift turns a profit.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.businesslive.co.za/bd/economy/",
        },
        {
          headline: "Events and functions still book earlier with deposits",
          summary:
            "Operators say larger bookings are more reliable when deposits are taken at confirmation.",
          tag: "Payments",
          tagColor: "green",
          url: "https://www.news24.com/business",
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
          headline: "Factories report cash tied up in slow-moving stock",
          summary:
            "Inventory days are stretching as buyers order smaller batches and delay restocks.",
          tag: "Cash",
          tagColor: "amber",
          url: "https://www.engineeringnews.co.za/",
        },
        {
          headline: "Load-shedding still raises unit cost on local production runs",
          summary:
            "Interrupted shifts and backup-power spend continue to push cost per unit higher for many plants.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.businesslive.co.za/bd/economy/",
        },
        {
          headline: "Export orders soften as global buyers delay shipments",
          summary:
            "Manufacturers say overseas demand is patchy, with longer gaps between confirmed orders.",
          tag: "Demand",
          tagColor: "blue",
          url: "https://www.moneyweb.co.za/",
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
          headline: "Diesel prices keep freight margins under pressure",
          summary:
            "Fuel remains the swing cost on thin haulage contracts, especially on longer corridors.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.freightnews.co.za/",
        },
        {
          headline: "Shippers take longer to settle freight invoices",
          summary:
            "Carriers report slower payment from mid-size accounts as clients stretch working capital.",
          tag: "Payments",
          tagColor: "amber",
          url: "https://www.businesslive.co.za/bd/economy/",
        },
        {
          headline: "Backhaul demand stays uneven across main SA routes",
          summary:
            "Empty return trips remain common where inbound and outbound volumes don’t match.",
          tag: "Demand",
          tagColor: "blue",
          url: "https://www.moneyweb.co.za/",
        },
      ],
      source: "fallback",
    },
    saas: {
      headline: "Deals take longer — get paid sooner when you can.",
      metrics: [
        { label: "Time to close a sale", value: "Longer", direction: "up", sentiment: "bad" },
        {
          label: "Customer cancellations",
          value: "Higher risk",
          direction: "up",
          sentiment: "bad",
        },
        { label: "Upsell / expansion", value: "Mild growth", direction: "up", sentiment: "good" },
      ],
      items: [
        {
          headline: "SA buyers stretch software renewal and upgrade cycles",
          summary:
            "Procurement teams are delaying non-critical SaaS renewals and asking for longer proof periods.",
          tag: "Demand",
          tagColor: "amber",
          url: "https://www.businesslive.co.za/bd/companies/telecoms-and-technology/",
        },
        {
          headline: "Dollar-priced cloud costs squeeze local software margins",
          summary:
            "Hosting and tooling billed in USD continue to rise relative to rand subscription revenue.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.moneyweb.co.za/",
        },
        {
          headline: "Starter packages and annual prepay still close faster",
          summary:
            "Vendors report simpler entry plans and prepaid annual deals converting better than large custom quotes.",
          tag: "Sales",
          tagColor: "green",
          url: "https://www.news24.com/business",
        },
      ],
      source: "fallback",
    },
    services: {
      headline: "Clients are paying slower — cash is the pressure point.",
      metrics: [
        {
          label: "How fast clients pay",
          value: "6 days slower",
          direction: "up",
          sentiment: "bad",
        },
        { label: "Team billable time", value: "Steady", direction: "flat", sentiment: "neutral" },
        {
          label: "Client fee pressure",
          value: "Clients pushing down",
          direction: "down",
          sentiment: "bad",
        },
      ],
      items: [
        {
          headline: "Professional-services invoices settle more slowly across SA",
          summary:
            "Agencies and consultancies report longer average days-to-pay as clients stretch supplier terms.",
          tag: "Payments",
          tagColor: "red",
          url: "https://www.businesslive.co.za/bd/economy/",
        },
        {
          headline: "Clients push back on fees while still expanding project scope",
          summary:
            "Firms say briefs grow mid-engagement even as rate increases meet tougher resistance.",
          tag: "Fees",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/",
        },
        {
          headline: "Specialist and outcome-based offers hold price better",
          summary:
            "Niche packages with clear deliverables are outperforming open-ended generalist retainers on fee defence.",
          tag: "Demand",
          tagColor: "green",
          url: "https://www.news24.com/business",
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
          headline: "SA SMEs report customers taking longer to pay",
          summary:
            "Late settlement remains a top cash-flow complaint for smaller firms across most sectors.",
          tag: "Payments",
          tagColor: "red",
          url: "https://www.businesslive.co.za/bd/economy/",
        },
        {
          headline: "Borrowing costs stay elevated for small firms",
          summary:
            "Bank funding remains expensive, so many owners lean harder on customer collections than new debt.",
          tag: "Finance",
          tagColor: "amber",
          url: "https://www.resbank.co.za/",
        },
        {
          headline: "Demand holds, but margins stay under cost pressure",
          summary:
            "Sales volumes are steadier than profits as fuel, power, and input costs keep eating margin.",
          tag: "Costs",
          tagColor: "blue",
          url: "https://www.moneyweb.co.za/",
        },
      ],
      source: "fallback",
    },
  };

  return adaptPulseForMarket(packs[sector] ?? packs.general, market);
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

function parseAiPayload(
  raw: string,
  industry: string,
  market: ResolvedMarket = ZA_MARKET,
): IndustryPulsePayload | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  // New shape: { headline, metrics, items }
  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    const items = normalizeItems(o.items ?? o.news);
    const metrics = normalizeMetrics(o.metrics);
    const headline = String(o.headline ?? "").trim();
    if (items.length === 0 && metrics.length === 0) return null;
    const fb = fallbackIndustryPulse(industry, market);
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
    const fb = fallbackIndustryPulse(industry, market);
    return { headline: fb.headline, metrics: fb.metrics, items, source: "ai" };
  }

  return null;
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
    const market = resolvePromptMarket(data.market);
    const today = formatDate(new Date(), market, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const prompt = industryPulsePrompt(industry, today, market);
    const fallback = fallbackIndustryPulse(industry, market);

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return fallback;

    try {
      const raw = await callClaude(anthropicKey, prompt);
      const parsed = parseAiPayload(raw, industry, market);
      if (parsed) return parsed;
    } catch {
      // Prefer curated baseline over a blank/error panel.
    }

    return fallback;
  });
