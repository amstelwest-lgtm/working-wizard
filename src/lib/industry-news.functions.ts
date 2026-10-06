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

/** Section/homepage dumps — not specific articles. Falls back to headline search. */
const GENERIC_NEWS_URL = [
  /businesslive\.co\.za\/bd\/economy\/?$/i,
  /businesslive\.co\.za\/bd\/companies\/[^/?#]+\/?$/i,
  /moneyweb\.co\.za\/?$/i,
  /news24\.com\/business\/?$/i,
  /resbank\.co\.za\/?$/i,
  /engineeringnews\.co\.za\/?$/i,
  /freightnews\.co\.za\/?$/i,
  /tourismupdate\.co\.za\/?$/i,
  /reuters\.com\/business\/?$/i,
];

function sanitizeNewsUrl(raw: unknown): string | null {
  const url = normalizeUrl(raw);
  if (!url) return null;
  if (GENERIC_NEWS_URL.some((pattern) => pattern.test(url))) return null;
  return url;
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
        url: sanitizeNewsUrl(o.url),
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
        /businesslive\.co\.za|moneyweb\.co\.za|news24\.com|resbank\.co\.za|engineeringnews\.co\.za|freightnews\.co\.za|tourismupdate\.co\.za/i.test(
          item.url,
        )
          ? null
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
          headline: "Weaker rand still pushes up producer and import costs",
          summary:
            "BusinessLive reports rand weakness feeds through to factory-gate prices, raising shelf costs on imported stock.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.businesslive.co.za/bd/economy/2018-10-25-struggling-rand-means-producer-inflation-could-well-spike/",
        },
        {
          headline: "Small retailers face rising backup-power and equipment costs",
          summary:
            "Moneyweb profiles salons and food shops spending tens of thousands on inverters and generators to stay open.",
          tag: "Costs",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/news/south-africa/load-shedding-is-not-normal/",
        },
        {
          headline: "Last-mile delivery costs run far above global averages",
          summary:
            "News24 reports crime, fuel and poor roads push SA courier costs 50–100% above global norms.",
          tag: "Demand",
          tagColor: "green",
          url: "https://www.news24.com/citypress/news/crime-makes-delivery-of-online-purchases-more-expensive-20241103",
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
          headline: "Government late payments top R12.4bn, Business Partners warns",
          summary:
            "Engineering News cites Treasury data showing 95,000+ invoices over 30 days unpaid, threatening contractor cash flow.",
          tag: "Payments",
          tagColor: "red",
          url: "https://www.engineeringnews.co.za/article/late-payment-crisis-detrimental-to-smes-business-partners-says-2026-03-11",
        },
        {
          headline: "Producer inflation quickens as fuel and steel inputs rise",
          summary:
            "BusinessLive notes March PPI hit 6.2% as Brent oil and a weaker rand lifted construction input costs.",
          tag: "Costs",
          tagColor: "amber",
          url: "https://www.businesslive.co.za/bd/economy/2019-04-25-producer-inflation-climbs-above-6-in-march/",
        },
        {
          headline: "Construction leaders warn stalled public spend is starving pipeline",
          summary:
            "Engineering News veterans say under-spent infrastructure budgets and procurement delays leave fewer new jobs.",
          tag: "Demand",
          tagColor: "blue",
          url: "https://www.engineeringnews.co.za/article/the-south-african-construction-industry-didnt-collapse-it-was-allowed-to-fail-2026-02-23",
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
          headline: "Restaurants struggle to pass rising food and energy costs",
          summary:
            "News24 reports menu prices are highly visible, so operators absorb inflation on food, wages and logistics.",
          tag: "Demand",
          tagColor: "amber",
          url: "https://www.news24.com/brandstory/partner-content/the-new-economics-of-eating-out-20260623-0854",
        },
        {
          headline: "Small food businesses say rent hikes are blocking expansion",
          summary:
            "News24 vendors report Cape Town monthly rents of R40k–R70k make scaling sit-down restaurants unaffordable.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.news24.com/southafrica/news/rising-cape-town-rentals-creating-a-pressure-cooker-for-small-food-businesses-vendors-say-20260821-1067",
        },
        {
          headline: "Restaurant groups warn tax and supplier hikes threaten viability",
          summary:
            "Moneyweb quotes hospitality leaders saying beer makes up to 70% of beverage sales and rising excise hurts margins.",
          tag: "Payments",
          tagColor: "green",
          url: "https://www.moneyweb.co.za/in-depth/south-african-breweries/balancing-the-tax-bottle-rethinking-sas-beer-taxation/",
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
          headline: "Energy tariffs now the main cost risk for SA manufacturers",
          summary:
            "Moneyweb reports executives say escalating electricity prices threaten local plants' global competitiveness.",
          tag: "Cash",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/news/economy/is-sa-pricing-itself-out-of-global-manufacturing-markets-because-of-energy-costs/",
        },
        {
          headline: "Load-shedding disruptions still lift unit costs at SA factories",
          summary:
            "Moneyweb notes plants using heavy machinery face long outages that cut output and raise cost per unit.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.moneyweb.co.za/in-depth/nedbank-manufacturing/how-sa-manufacturers-are-handling-the-load-shedding-disruptions/",
        },
        {
          headline: "Four in 10 small manufacturers doubt 12-month survival",
          summary:
            "Moneyweb cites an Absa-backed survey flagging liquidity gaps, late payments and patchy demand as top pressures.",
          tag: "Demand",
          tagColor: "blue",
          url: "https://www.moneyweb.co.za/news/south-africa/four-in-10-south-africa-small-firms-to-last-a-year-survey-finds/",
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
          headline: "Fuel price swings still dominate haulage contract margins",
          summary:
            "News24 tracks wholesale diesel near R18–20/litre in 2024, keeping fuel the swing cost on thin freight deals.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.news24.com/business/economy/confirmed-large-petrol-diesel-cuts-on-wednesday-20240930",
        },
        {
          headline: "Carriers wait 60 days while freight costs hit in real time",
          summary:
            "Moneyweb lenders say logistics SMEs fund customer orders upfront while invoice payments arrive weeks later.",
          tag: "Payments",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/in-depth/merchant-west/the-challenges-for-smes-seeking-working-capital/",
        },
        {
          headline: "Security and empty return trips inflate last-mile delivery costs",
          summary:
            "News24 reports hijacking risk and route rework push SA courier costs well above global averages.",
          tag: "Demand",
          tagColor: "blue",
          url: "https://www.news24.com/citypress/news/crime-makes-delivery-of-online-purchases-more-expensive-20241103",
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
          headline: "SaaS CFOs stretch renewals when cash-flow visibility is weak",
          summary:
            "Moneyweb notes cloud accounting vendors see buyers delaying non-critical renewals and proof periods.",
          tag: "Demand",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/in-depth/sage/cash-flow-visibility-rather-than-cash-flow-is-the-key-to-business-success/",
        },
        {
          headline: "Weaker rand lifts dollar-denominated cloud and licence costs",
          summary:
            "BusinessLive explains imported inputs priced in USD keep rising in rand terms, squeezing local software margins.",
          tag: "Costs",
          tagColor: "red",
          url: "https://www.businesslive.co.za/bd/national/health/2017-04-12-weak-rand-expected-to-push-up-prices-of-medicine/",
        },
        {
          headline: "Subscription cloud models replace heavy upfront licence spend",
          summary:
            "Moneyweb says pay-as-you-go SaaS lets smaller firms scale capacity without large hardware capex.",
          tag: "Sales",
          tagColor: "green",
          url: "https://www.moneyweb.co.za/news/tech/cloud-solutions-increase-business-efficiencies-in-the-new-normal/",
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
          headline: "Government late payments top R12.4bn, Business Partners warns",
          summary:
            "Engineering News cites Treasury data showing 95,000+ invoices over 30 days unpaid, hitting agency cash flow.",
          tag: "Payments",
          tagColor: "red",
          url: "https://www.engineeringnews.co.za/article/late-payment-crisis-detrimental-to-smes-business-partners-says-2026-03-11",
        },
        {
          headline: "Four in 10 small service firms doubt 12-month survival",
          summary:
            "Moneyweb cites an Absa-backed survey where cost and liquidity pressures top the list for professional SMEs.",
          tag: "Fees",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/news/south-africa/four-in-10-south-africa-small-firms-to-last-a-year-survey-finds/",
        },
        {
          headline: "Small Business Institute calls for action on late payments",
          summary:
            "Moneyweb reports the SBI wants faster dispute resolution as 90-day terms leave owners funding client work.",
          tag: "Demand",
          tagColor: "green",
          url: "https://www.moneyweb.co.za/moneyweb-radio/safm-market-update/call-for-action-on-late-payments-by-the-state/",
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
          headline: "Four in 10 SA small firms doubt they can last a year",
          summary:
            "Moneyweb reports an Absa-backed survey where late client payments and liquidity gaps remain the top constraint.",
          tag: "Payments",
          tagColor: "red",
          url: "https://www.moneyweb.co.za/news/south-africa/four-in-10-south-africa-small-firms-to-last-a-year-survey-finds/",
        },
        {
          headline: "SMEs face a R550bn working-capital funding gap",
          summary:
            "Moneyweb lenders say many viable smaller firms still cannot qualify for bank finance and rely on invoice discounting.",
          tag: "Finance",
          tagColor: "amber",
          url: "https://www.moneyweb.co.za/in-depth/merchant-west/the-challenges-for-smes-seeking-working-capital/",
        },
        {
          headline: "Energy tariffs now the main cost risk for SA businesses",
          summary:
            "Moneyweb reports rising electricity prices are eroding margins even where sales volumes hold steady.",
          tag: "Costs",
          tagColor: "blue",
          url: "https://www.moneyweb.co.za/news/economy/is-sa-pricing-itself-out-of-global-manufacturing-markets-because-of-energy-costs/",
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
