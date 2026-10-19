import { COMPANY_POSTAL_ADDRESS, LEGAL_ENTITY } from "./legal";
import { LIST_PRICES } from "./market/marketing";
import { FIRM_TRIAL_SENTENCE } from "./stripe-plans";

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
  /** Social description. Falls back to `description` when omitted. */
  ogDescription?: string;
  /** Path under the site origin, e.g. `/og/og-home-v11.png`. */
  image?: string;
  imageAlt: string;
  /** Default true. App, auth, and tokenized URLs must be false. */
  index?: boolean;
};

const USD_LIST_PRICE = LIST_PRICES.us.firmSolo.replace(/[^0-9.]/g, "") || "99";
const HOME_OG = "/og/og-home-v11.png";
const HOME_OG_ALT =
  "Milōn: Your AI finance team. You sign off. Milōn Financial Manager, Milōn Analyst, Milōn Advisor.";

export const SEO_PAGES = {
  home: {
    path: "/",
    title: "AI Finance Team & AI CFO for QuickBooks, Xero & Sage | MILŌN",
    description:
      "Milōn gives accounting firms an AI finance team: health score, 13-week cash forecast and advisory drafts from QuickBooks, Xero or Sage. You sign off.",
    ogTitle: "Your AI finance team. You sign off. | MILŌN",
    ogDescription:
      "Milōn Financial Manager, Analyst and Advisor prepare the work from QuickBooks, Xero or Sage. Your accountant signs off. 14-day free trial.",
    image: HOME_OG,
    imageAlt: HOME_OG_ALT,
  },
  forAccountants: {
    path: "/for-accountants",
    title: "AI Finance Team for Firms on QuickBooks, Xero & Sage | MILŌN",
    description:
      "Not an AI accountant or bookkeeper that replaces your firm. Three agents draft from QuickBooks, Xero or Sage. Your firm signs off.",
    ogTitle: "An AI finance team for accounting firms | MILŌN",
    ogDescription:
      "Milōn Financial Manager, Analyst and Advisor prepare the cash view and advisory pack from QuickBooks, Xero or Sage. Your firm signs off.",
    image: "/og/og-accountants-v11.png",
    imageAlt:
      "Milōn: An AI finance team for accounting firms. Milōn Financial Manager, Milōn Analyst, Milōn Advisor.",
  },
  forOwners: {
    path: "/for-owners",
    title: "AI CFO for Small Business on QuickBooks, Xero & Sage | MILŌN",
    description:
      "An AI finance team for your business: health score, 13-week cash and next moves from QuickBooks, Xero or Sage. $39 a month, or free with your accountant.",
    ogTitle: "An AI finance team for small business owners | MILŌN",
    ogDescription:
      "Milōn Financial Manager, Analyst and Advisor read QuickBooks, Xero or Sage and tell you what to do next. Free when your accountant is on Milōn.",
    image: "/og/og-owners-v11.png",
    imageAlt:
      "Milōn: An AI finance team for small business owners. Milōn Financial Manager, Milōn Analyst, Milōn Advisor.",
  },
  faq: {
    path: "/faq",
    title: "Milōn FAQ: AI Finance Team, Pricing, Data & Sign-off",
    description:
      "Straight answers on Milōn pricing, data and sign-off. Three AI agents draft from QuickBooks, Xero or Sage. An accountant signs off.",
    image: HOME_OG,
    imageAlt: HOME_OG_ALT,
  },
  about: {
    path: "/about",
    title: "About Milōn: An AI Finance Team Accountants Sign Off",
    description:
      "Why Milōn exists: three AI agents give small businesses a finance function, and a qualified accountant signs off. Works with QuickBooks, Xero and Sage.",
    image: HOME_OG,
    imageAlt: HOME_OG_ALT,
  },
  privacy: {
    path: "/privacy",
    title: "Privacy — How Milōn Handles Financial Data",
    description:
      "How Milōn stores, encrypts, and processes financial data, and why your clients' numbers are never used to train AI models.",
    image: HOME_OG,
    imageAlt: HOME_OG_ALT,
  },
  terms: {
    path: "/terms",
    title: "Terms of Use | MILŌN",
    description:
      "Terms for using Milōn: your figures stay yours, AI prepares the work, and a qualified accountant signs off. Not a substitute for licensed advice.",
    image: HOME_OG,
    imageAlt: HOME_OG_ALT,
  },
  ai: {
    path: "/ai",
    title: "How Milōn's AI Agents Handle Financial Data | MILŌN",
    description:
      "How Milōn's AI agents use financial data: identifiers stripped before model calls, amounts kept, never used to train third-party models. People sign off.",
    image: HOME_OG,
    imageAlt: HOME_OG_ALT,
  },
  auth: {
    path: "/auth",
    title: "Sign in | MILŌN",
    description: "Sign in to Milōn.",
    imageAlt: "Milōn sign in",
    index: false,
  },
  app: {
    path: "/app",
    title: "Milōn",
    description: "Milōn workspace.",
    imageAlt: "Milōn workspace",
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
  const socialDescription = page.ogDescription ?? page.description;
  const image = `${SITE_ORIGIN}${page.image ?? "/og.png"}`;
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
      { property: "og:description", content: socialDescription },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: page.imageAlt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: og },
      { name: "twitter:description", content: socialDescription },
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
  "This address is not a page on Milōn. It may be mistyped, or the page may have been moved.";

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
        name: LEGAL_ENTITY,
        legalName: LEGAL_ENTITY,
        alternateName: ["Milōn", "MILŌN", "MILON Finance"],
        url: SITE_ORIGIN,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_ORIGIN}/icons/icon-512.png`,
          width: 512,
          height: 512,
        },
        description:
          "Milōn gives accounting firms and the businesses they advise an AI finance team: Milōn Financial Manager, Milōn Analyst and Milōn Advisor work from QuickBooks, Xero or Sage, and a qualified accountant reviews and signs off.",
        address: {
          "@type": "PostalAddress",
          streetAddress: COMPANY_POSTAL_ADDRESS.streetAddress,
          addressLocality: COMPANY_POSTAL_ADDRESS.addressLocality,
          addressRegion: COMPANY_POSTAL_ADDRESS.addressRegion,
          postalCode: COMPANY_POSTAL_ADDRESS.postalCode,
          addressCountry: COMPANY_POSTAL_ADDRESS.addressCountry,
        },
        // Omit sameAs until the LinkedIn company page and X profile are live.
        // Pointing crawlers at 404 / unverified URLs is worse than omitting the field.
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
          "Sage",
        ],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_ORIGIN}/#software`,
        name: "Milōn",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "AI finance team for accounting firms and small businesses",
        operatingSystem: "Web",
        url: SITE_ORIGIN,
        image: `${SITE_ORIGIN}/og/og-home-v11.png`,
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        description:
          "Your AI finance team. You sign off. Milōn Financial Manager keeps the books data clean from QuickBooks, Xero or Sage, the 13-week cash view and the budget. Milōn Analyst diagnoses why margins moved and where cash is leaking. Milōn Advisor drafts the next moves. A qualified accountant reviews and approves.",
        featureList: [
          "Milōn Financial Manager: clean books data from QuickBooks, Xero or Sage, 13-week cash view, budget, action points and accountant hand-off",
          "Milōn Analyst: health score, 19 financial ratios and variances explained as a diagnosis",
          "Milōn Advisor: next moves and advisory deliverables ready for accountant sign-off",
          "Connect QuickBooks, Xero or Sage, or upload PDF, Excel, CSV or a bank statement",
          "Source documents post to the books only after a named person approves",
          "Assignable action plans the accountant reviews with the client",
        ],
        offers: [
          {
            "@type": "Offer",
            name: "Firm plan: Starter (up to 5 active clients)",
            priceCurrency: "USD",
            price: "39",
            url: `${SITE_ORIGIN}/for-accountants`,
            availability: "https://schema.org/InStock",
          },
          {
            "@type": "Offer",
            name: "Firm plan: Solo (up to 15 active clients)",
            priceCurrency: "USD",
            price: USD_LIST_PRICE,
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
        name: "Milōn",
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

export const LLMS_TXT = `# Milōn

> Your AI finance team. You sign off. Milōn gives accounting firms and the
> small businesses they advise a Financial Manager, an Analyst and an Advisor.
> They prepare the work from QuickBooks, Xero, Sage or uploaded statements.
> A qualified accountant reviews and approves every advisory pack.

## The AI finance team
- Milōn Financial Manager: keeps books data clean from QuickBooks Online, Xero or Sage, runs the 13-week cash view and budget, sets action points and hands the pack to the accountant
- Milōn Analyst: health score, ratios and variances explained as a diagnosis of why margins moved and where cash is leaking
- Milōn Advisor: next moves and advisory deliverables ready for accountant sign-off
- Milōn is not a ledger and does not file returns or make payments
- Source documents post to the books only after a named person approves

## Pricing (USD)
- Accounting firms: flat bands by active client count, Starter $39/mo to Scale $999/mo; ${FIRM_TRIAL_SENTENCE} on Starter. A card is required at signup.
- Business owners: $39/mo, free when their accountant is on Milōn

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
- AI notice: ${SITE_ORIGIN}/ai
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
