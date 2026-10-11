/**
 * Production canonical origin for public metadata, sitemap locs, and robots.
 * Always the www host. Do not derive this from the request: apex, localhost,
 * and preview hosts must never appear in canonical, Open Graph, or schema.
 */
export const SITE_ORIGIN = "https://www.milonfinance.com";

export type SeoPage = {
  path: string;
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  /** Versioned path. /og.png stays in place because it is cached for a year. */
  image: string;
  imageAlt: string;
  /** Default true. App, auth, and tokenized URLs must be false. */
  index?: boolean;
};

const OG_HOME = "/og/og-home-v11.png";
const OG_HOME_ALT =
  "MILŌN: Your AI finance team. You sign off. Milōn Financial Manager, Milōn Analyst, Milōn Advisor.";

export const SEO_PAGES = {
  home: {
    path: "/",
    title: "AI Finance Team & AI CFO for QuickBooks & Xero | MILŌN",
    description:
      "Your AI finance team. You sign off. Milōn Financial Manager, Analyst and Advisor work from QuickBooks Online or Xero, for accounting firms and owners.",
    ogTitle: "Your AI finance team. You sign off. | MILŌN",
    ogDescription:
      "Milōn Financial Manager, Analyst and Advisor work from QuickBooks Online or Xero. Your accountant signs off. 14-day free trial · up to 3 clients.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
  },
  forAccountants: {
    path: "/for-accountants",
    title: "AI Finance Team for Accounting Firms, QBO & Xero | MILŌN",
    description:
      "Not an AI accountant or AI bookkeeper that replaces you. Milōn Financial Manager, Analyst and Advisor draft from QBO or Xero. Your firm signs off.",
    ogTitle: "An AI finance team for accounting firms | MILŌN",
    ogDescription:
      "Three AI agents draft the cash forecast, variances and advisory pack from QBO or Xero. Your firm signs off. 14-day free trial · up to 3 clients.",
    image: "/og/og-accountants-v11.png",
    imageAlt:
      "MILŌN: An AI finance team for accounting firms. Milōn Financial Manager, Milōn Analyst, Milōn Advisor.",
  },
  forOwners: {
    path: "/for-owners",
    title: "AI CFO for Small Business Owners, QuickBooks & Xero | MILŌN",
    description:
      "An AI finance team for your business: health score, 13-week cash and next moves from QuickBooks or Xero. $39/mo, free if your accountant is on Milōn.",
    ogTitle: "An AI finance team for small business owners | MILŌN",
    ogDescription:
      "Milōn Financial Manager, Analyst and Advisor read QuickBooks or Xero and tell you what to do next. Free when your accountant is on Milōn.",
    image: "/og/og-owners-v11.png",
    imageAlt:
      "MILŌN: An AI finance team for small business owners. Milōn Financial Manager, Milōn Analyst, Milōn Advisor.",
  },
  faq: {
    path: "/faq",
    title: "MILŌN FAQ: AI Finance Team, Pricing, Data & Sign-off",
    description:
      "Straight answers on pricing, data and the AI finance team: Milōn Financial Manager, Analyst and Advisor on QBO or Xero. A qualified accountant signs off.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
  },
  about: {
    path: "/about",
    title: "About MILŌN: An AI Finance Team Accountants Sign Off",
    description:
      "Why MILŌN exists: three AI agents give small businesses a finance function, and a qualified accountant signs off. Works with QuickBooks and Xero.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
  },
  privacy: {
    path: "/privacy",
    title: "Privacy — How MILŌN Handles Financial Data",
    description:
      "How MILŌN stores, encrypts, and processes financial data — and why your clients' numbers are never used to train AI models.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
  },
  terms: {
    path: "/terms",
    title: "Terms of Use | MILŌN",
    description:
      "Terms for using MILŌN: your figures stay yours, AI prepares the work, and a qualified accountant signs off. Not a substitute for licensed advice.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
  },
  ai: {
    path: "/ai",
    title: "How Milōn's AI Agents Handle Financial Data | MILŌN",
    description:
      "How Milōn's AI agents use financial data: identifiers stripped before model calls, amounts kept, never used to train third-party models. People sign off.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
  },
  auth: {
    path: "/auth",
    title: "Sign in | MILŌN",
    description: "Sign in to MILŌN.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
    index: false,
  },
  app: {
    path: "/app",
    title: "MILŌN",
    description: "MILŌN workspace.",
    image: OG_HOME,
    imageAlt: OG_HOME_ALT,
    index: false,
  },
} as const satisfies Record<string, SeoPage>;

export const INDEXABLE_PATHS = Object.values(SEO_PAGES)
  .filter((p) => p.index !== false)
  .map((p) => p.path);

export type FaqItem = { question: string; answer: string };

export function faqPageJson(items: FaqItem[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  });
}

/** Absolute www URL for a public path. Home is `/`; other paths keep their route path. */
export function canonicalUrl(path: string): string {
  if (path === "/" || path === "") return `${SITE_ORIGIN}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_ORIGIN}${normalized}`;
}

export function pageHead(page: SeoPage) {
  const path = page.path;
  const url = canonicalUrl(path);
  const og = page.ogTitle ?? page.title;
  const ogDescription = page.ogDescription ?? page.description;
  const image = `${SITE_ORIGIN}${page.image}`;
  const index = page.index !== false;
  const robots = index
    ? "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
    : "noindex, nofollow";

  return {
    meta: [
      { title: page.title },
      { name: "description", content: page.description },
      { name: "robots", content: robots },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "MILŌN" },
      { property: "og:locale", content: "en_US" },
      { property: "og:title", content: og },
      { property: "og:description", content: ogDescription },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: page.imageAlt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: og },
      { name: "twitter:description", content: ogDescription },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: page.imageAlt },
    ],
    links: [
      { rel: "canonical", href: url },
      { rel: "alternate", hrefLang: "en-us", href: url },
      { rel: "alternate", hrefLang: "x-default", href: url },
    ],
  };
}

/** Unmatched URLs (including /blog and /pricing, which are not pages). No homepage title, description, or og:url. */
export const NOT_FOUND_TITLE = "Page not found | MILŌN";
export const NOT_FOUND_DESCRIPTION =
  "This address is not a page on MILŌN. It may be mistyped, or the page may have been moved.";

export function notFoundHead() {
  return {
    meta: [
      { title: NOT_FOUND_TITLE },
      { name: "description", content: NOT_FOUND_DESCRIPTION },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: NOT_FOUND_TITLE },
      { property: "og:description", content: NOT_FOUND_DESCRIPTION },
      { property: "og:type", content: "website" },
    ],
    links: [] as Array<{ rel: string; href: string }>,
  };
}

export function organizationGraphJson(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: "MILŌN",
        url: SITE_ORIGIN,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_ORIGIN}/icons/icon-512.png`,
          width: 512,
          height: 512,
        },
        legalName: "Milon Inc",
        alternateName: ["MILON Finance", "Milōn"],
        description:
          "MILŌN gives accounting firms and the businesses they advise an AI finance team: Milōn Financial Manager, Milōn Analyst and Milōn Advisor work from QuickBooks Online or Xero, and a qualified accountant reviews and signs off.",
        // Omit sameAs until the LinkedIn company page and X profile are live.
        // Pointing crawlers at 404 / unverified URLs is worse than omitting the field.
        areaServed: [{ "@type": "Country", name: "United States" }],
        knowsAbout: [
          "AI finance team",
          "AI CFO",
          "Client advisory services",
          "13-week cash flow forecasting",
          "Budget vs actual variance analysis",
          "Financial ratio analysis",
          "Small business financial management",
          "QuickBooks Online",
          "Xero",
        ],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_ORIGIN}/#software`,
        name: "MILŌN",
        alternateName: "Milōn Bot",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "AI finance team for accounting firms and small businesses",
        operatingSystem: "Web browser",
        url: SITE_ORIGIN,
        image: `${SITE_ORIGIN}/og/og-home-v11.png`,
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        description:
          "Your AI finance team. You sign off. Three AI agents work in Milōn Bot from QuickBooks Online, Xero or uploaded statements: Milōn Financial Manager (data quality, 13-week cash and budget, action points, accountant hand-off), Milōn Analyst (health score, ratios, variances, diagnosis) and Milōn Advisor (next moves and advisory deliverables). A qualified accountant reviews and signs off.",
        featureList: [
          "Milōn Financial Manager: data quality from QuickBooks Online or Xero, 13-week cash forecast and budget, action points and accountant hand-off",
          "Milōn Analyst: financial health score, 19 ratios with workings, budget vs actual variances and diagnosis",
          "Milōn Advisor: next moves and client-ready advisory deliverables for accountant sign-off",
          "Connect QuickBooks Online or Xero, or upload PDF, Excel, CSV or a bank statement",
          "Every sign-off logged with the accountant's name and time",
          "Assignable action plans with email-based task completion",
        ],
        offers: [
          {
            "@type": "Offer",
            name: "Firm plan: Solo (up to 15 active clients)",
            priceCurrency: "USD",
            price: "99",
            url: `${SITE_ORIGIN}/for-accountants`,
            availability: "https://schema.org/InStock",
          },
          {
            "@type": "Offer",
            name: "Owner plan",
            priceCurrency: "USD",
            price: "39",
            url: `${SITE_ORIGIN}/for-owners`,
            availability: "https://schema.org/InStock",
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        url: SITE_ORIGIN,
        name: "MILŌN",
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        inLanguage: "en-US",
      },
    ],
  });
}

export const ROBOTS_TXT = `User-agent: *
Allow: /
Allow: /favicon.ico
Allow: /icons/
Allow: /og.png
Allow: /og/

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

Disallow: /app/
Disallow: /api/
Disallow: /auth/
Disallow: /dashboard/
Disallow: /clients/
Disallow: /*?*token=
Disallow: /*?*session=
Disallow: /*?*invite=

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;

export const LLMS_TXT = `# MILŌN

> Your AI finance team. You sign off. MILŌN gives accounting firms and the
> small businesses they advise three AI agents that work in Milōn Bot from
> QuickBooks Online, Xero or uploaded statements. A qualified accountant
> reviews and signs off every advisory pack before it reaches the client.

## The AI finance team
- Milōn Financial Manager: checks data quality from QuickBooks Online or Xero, runs the 13-week cash forecast and budget, sets action points and hands the pack to the accountant
- Milōn Analyst: financial health score across four pillars (profit, assets, financing, cash), 19 ratios with workings, budget vs actual variances and diagnosis
- Milōn Advisor: next moves and client-ready advisory deliverables for accountant sign-off
- MILŌN is not a ledger and does not file returns or make payments

## Pricing (USD)
- Accounting firms: flat bands by active client count, Solo $99/mo to Scale $999/mo; 14-day free trial · up to 3 clients
- Business owners: $39/mo, free when their accountant is on MILŌN

## Who it is for
- Accounting firms, CPA firms and bookkeeping firms launching or scaling client advisory services
- Small, midsize and family-owned businesses that want to understand their numbers

## Key pages
- Home: ${SITE_ORIGIN}/
- For accounting firms: ${SITE_ORIGIN}/for-accountants
- For business owners: ${SITE_ORIGIN}/for-owners
- About: ${SITE_ORIGIN}/about
- FAQ: ${SITE_ORIGIN}/faq
- AI notice: ${SITE_ORIGIN}/ai
- Privacy: ${SITE_ORIGIN}/privacy

## Markets
Primary: United States. Also serving South Africa.
`;

export function sitemapXml(lastmod: string): string {
  const urls = INDEXABLE_PATHS.map((path) => {
    const loc = canonicalUrl(path);
    const priority = path === "/" ? "1.0" : "0.8";
    return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
