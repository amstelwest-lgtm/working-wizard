import { LIST_PRICES } from "./market/marketing";

/** Canonical public origin. Trailing slash lives on paths, not here. */
export const SITE_ORIGIN = "https://milonfinance.com";

export type SeoPage = {
  path: string;
  title: string;
  description: string;
  ogTitle?: string;
  imageAlt: string;
  /** Default true. App, auth, and tokenized URLs must be false. */
  index?: boolean;
};

const USD_LIST_PRICE = LIST_PRICES.us.firmSolo.replace(/[^0-9.]/g, "") || "99";

export const SEO_PAGES = {
  home: {
    path: "/",
    title: "AI Finance Function for Accountants & Businesses | MILŌN",
    description:
      "Accountants run an AI finance function for clients in MILŌN. Works with QuickBooks Online and Xero. Your accountant reviews and signs off.",
    imageAlt: "MILŌN — AI-powered finance function for accounting firms and businesses",
  },
  forAccountants: {
    path: "/for-accountants",
    title: "AI Advisory Software for Accounting Firms | MILŌN",
    description:
      "Launch advisory without extra headcount. Connect QuickBooks Online or Xero — MILŌN drafts the analysis; your team reviews and signs off.",
    imageAlt: "MILŌN for accounting firms — advisory delivery without extra headcount",
  },
  forOwners: {
    path: "/for-owners",
    title: "Know Your Numbers: Financial Clarity for Owners | MILŌN",
    description:
      "Health score, 13-week cash forecast, and next moves from QuickBooks Online, Xero, or an upload — reviewed by your accountant.",
    imageAlt: "MILŌN for business owners — health score, cash forecast, and next moves",
  },
  faq: {
    path: "/faq",
    title: "MILŌN FAQ — Pricing, Data, and How Advisory Works",
    description:
      "Answers on pricing, data, and connecting QuickBooks Online or Xero. AI prepares the analysis; a qualified accountant reviews and signs off.",
    imageAlt: "Frequently asked questions about the MILŌN finance platform",
  },
  about: {
    path: "/about",
    title: "About MILŌN — Built by a Big 4-Trained Auditor",
    description:
      "MILŌN was built by a Big 4-trained auditor who saw the same thing in every set of books: the numbers existed, the guidance didn't.",
    imageAlt: "About MILŌN — founder story and why the product exists",
  },
  privacy: {
    path: "/privacy",
    title: "Privacy — How MILŌN Handles Financial Data",
    description:
      "How MILŌN stores, encrypts, and processes financial data — and why your clients' numbers are never used to train AI models.",
    imageAlt: "MILŌN privacy notice",
  },
  terms: {
    path: "/terms",
    title: "Terms of Use | MILŌN",
    description:
      "Terms for using MILŌN: your figures stay yours, AI is a work-preparation tool, and a qualified accountant reviews and signs off. Not a substitute for licensed advice.",
    imageAlt: "MILŌN terms of use",
  },
  ai: {
    path: "/ai",
    title: "AI Data Handling | MILŌN",
    description:
      "How MILŌN uses AI on financial data. Identifiers (company names, tax IDs, account numbers) are stripped before model calls; amounts stay. Client numbers are never used to train third-party models.",
    imageAlt: "MILŌN AI notice",
  },
  auth: {
    path: "/auth",
    title: "Sign in | MILŌN",
    description: "Sign in to MILŌN.",
    imageAlt: "MILŌN sign in",
    index: false,
  },
  app: {
    path: "/app",
    title: "MILŌN",
    description: "MILŌN workspace.",
    imageAlt: "MILŌN workspace",
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

export function canonicalUrl(path: string): string {
  if (path === "/") return `${SITE_ORIGIN}/`;
  return `${SITE_ORIGIN}${path.endsWith("/") ? path : `${path}/`}`;
}

function slugFor(path: string): string {
  if (path === "/") return "home";
  return path.replace(/^\/|\/$/g, "").replace(/\//g, "-");
}

export function pageHead(page: SeoPage) {
  const path = page.path;
  const url = `${SITE_ORIGIN}${path}`;
  const og = page.ogTitle ?? page.title;
  const slug = slugFor(path);
  const image = `${SITE_ORIGIN}/og.png`;
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
      { property: "og:description", content: page.description },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: page.imageAlt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: og },
      { name: "twitter:description", content: page.description },
      { name: "twitter:image", content: image },
    ],
    links: [
      { rel: "canonical", href: url },
      { rel: "alternate", hrefLang: "en-us", href: url },
      { rel: "alternate", hrefLang: "x-default", href: url },
    ],
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
        alternateName: "MILON Finance",
        url: SITE_ORIGIN,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_ORIGIN}/icons/icon-512.png`,
          width: 512,
          height: 512,
        },
        description:
          "MILŌN is an AI-automated finance function and advisory platform for accounting firms and the businesses they serve. It generates financial health scoring, cash flow forecasting, budget variance analysis, and actionable advisory plans that a qualified accountant reviews and signs off.",
        // Omit sameAs until the LinkedIn company page and X profile are live.
        // Pointing crawlers at 404 / unverified URLs is worse than omitting the field.
        areaServed: [
          { "@type": "Country", name: "United States" },
          { "@type": "Country", name: "South Africa" },
        ],
        knowsAbout: [
          "Client Advisory Services",
          "Cash flow forecasting",
          "Financial planning and analysis",
          "Financial ratio analysis",
          "Budget variance analysis",
          "Artificial intelligence in accounting",
          "Small business financial management",
          "QuickBooks Online",
          "Xero",
        ],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_ORIGIN}/#software`,
        name: "MILŌN",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Financial Analysis and Advisory Software",
        operatingSystem: "Web browser",
        url: SITE_ORIGIN,
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        description:
          "AI-automated finance function for accounting firms and small businesses. Connect QuickBooks Online or Xero, or upload statements. Financial health scoring, 13-week cash flow forecasting, budget vs actual variance analysis, white-label reporting, and assignable action plans.",
        featureList: [
          "Connect QuickBooks Online or Xero, or upload PDF, Excel, or CSV statements",
          "Business financial health score across profit, assets, financing and cash",
          "19 financial ratios with workings shown and repair playbooks",
          "13-week rolling cash flow forecast",
          "Budget vs actual variance reporting with AI commentary",
          "AI extraction of financial statements from PDF, Excel, or CSV",
          "White-label client-ready PDF reports",
          "Assignable action plans with email-based task completion",
          "Ask AI over your own financial data",
        ],
        offers: {
          "@type": "Offer",
          priceCurrency: "USD",
          price: USD_LIST_PRICE,
          url: `${SITE_ORIGIN}/for-accountants`,
          availability: "https://schema.org/InStock",
        },
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

> MILŌN is an AI-automated finance function and advisory platform for
> accounting firms and the small and midsize businesses they serve. It
> generates financial health scoring, 13-week cash flow forecasting,
> budget vs actual variance analysis, and assignable action plans —
> which a qualified accountant reviews and signs off before they reach
> the client.

## What MILŌN does
- Connects to QuickBooks Online or Xero, or reads an uploaded PDF, Excel, CSV, or bank statement
- Scores business financial health across four pillars: profit, assets, financing, cash
- Calculates and explains 19 financial ratios with workings shown and repair playbooks
- Builds rolling 13-week direct cash flow forecasts
- Produces budget vs actual variance reporting with written commentary
- Extracts financial data from PDF, Excel, CSV, or a bank statement
- Generates white-label client-ready reports for accounting firms
- Converts recommendations into assigned tasks completable from email

## Who it is for
- Accounting firms, CPA firms and bookkeeping firms launching or scaling client advisory services
- Small, midsize and family-owned businesses that want to understand their numbers

## Key pages
- Home: ${SITE_ORIGIN}/
- For accounting firms: ${SITE_ORIGIN}/for-accountants
- For business owners: ${SITE_ORIGIN}/for-owners
- About: ${SITE_ORIGIN}/about
- FAQ: ${SITE_ORIGIN}/faq
- Privacy: ${SITE_ORIGIN}/privacy

## Markets
Primary: United States. Also serving South Africa.
`;

export function sitemapXml(lastmod: string): string {
  const urls = INDEXABLE_PATHS.map((path) => {
    const loc = path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
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
