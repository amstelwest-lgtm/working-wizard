/**
 * US-first marketing SEO foundation (phase 1).
 * Run: pnpm test:seo-foundation
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  INDEXABLE_PATHS,
  LLMS_TXT,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
  ROBOTS_TXT,
  SEO_PAGES,
  SITE_ORIGIN,
  canonicalUrl,
  faqPageJson,
  notFoundHead,
  organizationGraphJson,
  pageHead,
  sitemapXml,
} from "../src/lib/seo";
import {
  ACCOUNTING_SOFTWARE_ANSWER,
  AI_IDENTIFIERS_LINE,
  HOMEPAGE_FAQ_ITEMS,
  LEDGER_CONNECT_ANSWER,
  LEDGER_CONNECT_QUESTION,
  publicFaqUsItems,
  WATCHLIST_DEFINITION,
} from "../src/lib/marketing-faq";
import {
  HERO_BADGE,
  HERO_H1_GOLD,
  HERO_LEDE,
  PRICING_H2_USD,
  homepageFaqItems,
  publicFaqItems,
  SA_FOUNDING_LINE,
  SA_ZAR_LINE,
  TRUST_IDENTIFIERS,
} from "../src/lib/landing-copy";
import { visitorCopyPack } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SITE_ORIGIN === "https://www.milonfinance.com", "canonical origin is www");
assert(!SITE_ORIGIN.includes("://milonfinance.com"), "canonical origin is not the apex host");
assert(visitorCopyPack({ country: null }) === "us", "unset visitors get US copy");
assert(visitorCopyPack({ country: "ZA" }) === "za", "ZA opt-in still works");

const home = pageHead(SEO_PAGES.home);
assert(
  home.meta.some((m) => "title" in m && m.title === SEO_PAGES.home.title),
  "home title from spec",
);
assert(
  home.meta.some((m) => "name" in m && m.name === "robots" && String(m.content).includes("index")),
  "home is indexable",
);
assert(
  home.links.some((l) => l.rel === "canonical" && l.href === `${SITE_ORIGIN}/`),
  "home canonical",
);
assert(
  home.meta.some((m) => "property" in m && m.property === "og:url" && m.content === `${SITE_ORIGIN}/`),
  "home og:url",
);

function assertPublicHost(text: string, label: string) {
  assert(!text.includes("https://milonfinance.com"), `${label} must not use the apex host`);
  assert(!text.includes("localhost"), `${label} must not use localhost`);
  assert(!text.includes("vercel.app"), `${label} must not use a preview host`);
  assert(text.includes("https://www.milonfinance.com"), `${label} must use the www host`);
}

for (const page of Object.values(SEO_PAGES)) {
  const head = pageHead(page);
  const url = canonicalUrl(page.path);
  assert(
    head.links.some((l) => l.rel === "canonical" && l.href === url),
    `${page.path} canonical is www + path`,
  );
  assert(
    head.meta.some((m) => "property" in m && m.property === "og:url" && m.content === url),
    `${page.path} og:url matches canonical`,
  );
  assertPublicHost(JSON.stringify(head), `${page.path} head`);
}

const app = pageHead(SEO_PAGES.app);
assert(
  app.meta.some((m) => "name" in m && m.name === "robots" && String(m.content).includes("noindex")),
  "app is noindex",
);
const auth = pageHead(SEO_PAGES.auth);
assert(
  auth.meta.some((m) => "name" in m && m.name === "robots" && String(m.content).includes("noindex")),
  "auth is noindex",
);

const graph = organizationGraphJson();
assert(graph.includes('"@type":"Organization"') || graph.includes('"@type": "Organization"'), "org schema");
assert(graph.includes("SoftwareApplication"), "software schema");
assert(graph.includes("en-US"), "website inLanguage");
assert(graph.includes('"priceCurrency": "USD"') || graph.includes('"priceCurrency":"USD"'), "USD offer");
assert(!graph.includes("ZAR"), "primary schema is not ZAR");
assert(!graph.includes("sameAs"), "org schema omits sameAs until live social profiles exist");
assert(!graph.includes("linkedin.com"), "org schema does not list a LinkedIn profile");
assert(!graph.includes("x.com/milonfinance"), "org schema does not list a dead X profile");
assert(
  home.meta.some((m) => "name" in m && m.name === "twitter:card" && m.content === "summary_large_image"),
  "twitter:card meta stays for OG previews",
);

assert(ROBOTS_TXT.includes("Allow: /"), "robots allow site");
assert(ROBOTS_TXT.includes("GPTBot"), "robots allow AI crawlers");
assert(ROBOTS_TXT.includes("Disallow: /app/"), "robots hide the workspace");
assert(ROBOTS_TXT.includes("Disallow: /auth/"), "robots hide auth");
assert(ROBOTS_TXT.includes("Sitemap: https://www.milonfinance.com/sitemap.xml"), "robots points at the www sitemap");
assert(!ROBOTS_TXT.includes("https://milonfinance.com"), "robots does not advertise the apex host");

assert(LLMS_TXT.includes("AI-automated finance function"), "llms.txt positioning");
assert(LLMS_TXT.includes("QuickBooks Online"), "llms.txt names QuickBooks Online");
assert(LLMS_TXT.includes("Xero"), "llms.txt names Xero");
assert(LLMS_TXT.includes("/for-accountants"), "llms.txt keeps existing firm URL");
assert(LLMS_TXT.includes("/about"), "llms.txt includes about");
assert(LLMS_TXT.includes("Primary: United States"), "llms.txt US-first");
assert(!LLMS_TXT.includes("photographed"), "llms.txt does not claim photo ingest");
assert(!LLMS_TXT.includes("Canada"), "llms.txt does not claim Canada");
assert(!graph.includes("Canada"), "org schema does not claim Canada");
assert(!graph.includes("photographed"), "schema does not claim photo ingest");
assert(graph.includes("19 financial ratios"), "schema uses the real ratio count");
assert(graph.includes("QuickBooks Online"), "schema names QuickBooks Online");
assert(graph.includes("Xero"), "schema names Xero");
assert(!graph.includes("certified"), "schema does not claim certification");
assert(!graph.includes("Intuit"), "schema does not claim an Intuit relationship");
assert(INDEXABLE_PATHS.includes("/about"), "about is indexable");

const map = sitemapXml("2026-09-14");
for (const path of INDEXABLE_PATHS) {
  const loc = path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
  assert(map.includes(`<loc>${loc}</loc>`), `sitemap includes ${path}`);
}
assert(!map.includes("/app"), "sitemap excludes /app");
assert(!map.includes("/auth"), "sitemap excludes /auth");

const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
assert(root.includes('lang="en-US"'), "html lang is en-US");
assert(root.includes("organizationGraphJson"), "root emits org JSON-LD");
assert(root.includes("notFoundHead"), "unmatched URLs get the 404 head");
assert(root.includes("match._notFound"), "404 head is limited to unmatched routes");
assert(!root.includes("pageHead(SEO_PAGES.home)"), "root does not stamp homepage meta on every URL");
assert(!root.includes("SEO_PAGES.home"), "root does not import homepage SEO");
assert(root.includes('href: "/favicon.ico"'), "root uses /favicon.ico");
assert(!root.includes("favicon-32"), "old favicon-32 is gone");
assert(!root.includes("?v=2"), "icon URLs are not cache-busted");
assert(root.includes('href: "/icons/icon-192.png"'), "png app icon is under /icons");
assert(root.includes('href: "/icons/apple-touch-icon.png"'), "apple touch icon is under /icons");
assert(root.includes('href: "/manifest.json"'), "manifest is /manifest.json");
assert(root.includes('content: "#0A0A0A"'), "theme-color matches the new mark");

assert(
  home.meta.some((m) => "property" in m && m.property === "og:image" && m.content === `${SITE_ORIGIN}/og.png`),
  "og:image is the 1200x630 card",
);
assertPublicHost(graph, "organization schema");
assert(graph.includes("https://www.milonfinance.com/#organization"), "org @id is www");
assert(graph.includes("https://www.milonfinance.com/#software"), "software @id is www");
assert(graph.includes("https://www.milonfinance.com/#website"), "website @id is www");
assertPublicHost(ROBOTS_TXT, "robots.txt");
assertPublicHost(LLMS_TXT, "llms.txt");
assertPublicHost(map, "sitemap");
assert(!map.includes("https://milonfinance.com/"), "sitemap locs are not apex");

const missing = notFoundHead();
const missingJson = JSON.stringify(missing);
assert(missing.meta.some((m) => "title" in m && m.title === NOT_FOUND_TITLE), "404 title is unique");
assert(NOT_FOUND_TITLE !== SEO_PAGES.home.title, "404 title is not the homepage title");
assert(
  missing.meta.some((m) => "name" in m && m.name === "description" && m.content === NOT_FOUND_DESCRIPTION),
  "404 description is unique",
);
assert(NOT_FOUND_DESCRIPTION !== SEO_PAGES.home.description, "404 description is not the homepage description");
assert(
  missing.meta.some((m) => "name" in m && m.name === "robots" && String(m.content).includes("noindex")),
  "404 is noindex",
);
assert(!missingJson.includes(SEO_PAGES.home.title), "404 head does not repeat the homepage title");
assert(!missingJson.includes(SEO_PAGES.home.description), "404 head does not repeat the homepage description");
assert(!missingJson.includes('"og:url"'), "404 head does not emit og:url");
assert(missing.links.length === 0, "404 head does not emit a canonical");
assert(!existsSync(resolve("src/routes/blog.tsx")), "/blog is not a homepage stub route");
assert(!existsSync(resolve("src/routes/pricing.tsx")), "/pricing is not a homepage stub route");

assert(graph.includes("/icons/icon-512.png"), "org schema logo is the 512 icon");
assert(!graph.includes(`${SITE_ORIGIN}/icon-512.png"`), "org schema does not use the old root icon path");

assert(ROBOTS_TXT.includes("Allow: /favicon.ico"), "robots allow the favicon");
assert(ROBOTS_TXT.includes("Allow: /icons/"), "robots allow /icons/");
assert(!/Disallow: \/icons/.test(ROBOTS_TXT), "robots do not block /icons/");
assert(!/Disallow: \/favicon/.test(ROBOTS_TXT), "robots do not block the favicon");

const manifest = JSON.parse(readFileSync(resolve("public/manifest.json"), "utf8"));
assert(manifest.name === "MILŌN", "manifest name");
assert(manifest.icons.some((i: { src: string }) => i.src === "/icons/icon-maskable-512.png"), "maskable icon");

assert(existsSync(resolve("public/favicon.ico")), "favicon.ico is at the site root");
assert(existsSync(resolve("public/og.png")), "og.png is at the site root");
assert(existsSync(resolve("public/icons/icon-192.png")), "192 icon is under /icons");
assert(!existsSync(resolve("public/favicon-32.png")), "old favicon-32.png is deleted");
assert(!existsSync(resolve("public/icon-512.png")), "old root icon-512.png is deleted");
assert(!existsSync(resolve("public/manifest.webmanifest")), "old webmanifest is deleted");

const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
const landingQuiz = readFileSync(resolve("src/lib/landing-quiz.ts"), "utf8");
assert(!landing.includes("linkedin.com/company/milonfinance"), "landing does not hardcode a dead LinkedIn URL");
assert(!landing.includes("x.com/milonfinance"), "landing does not hardcode a dead X URL");
assert(landing.includes("SEO_PAGES.home"), "landing uses spec meta");
assert(!landing.includes("South African accounting"), "landing meta is not SA-first");
assert(
  landingQuiz.includes('country: "US" as const'),
  "quiz defaults to US when the visitor has no market pick",
);
assert(landing.includes('id="bridge"'), "landing keeps the dual-audience bridge");
assert(!landing.includes('id="features"'), "landing drops the duplicate features block");
assert(landing.includes("{HERO_BADGE}"), "hero badge comes from landing copy");
assert(
  HERO_BADGE === "For accounting firms and the businesses they advise",
  "hero badge is the audience, not the brand",
);
assert(landing.includes("{HERO_H1_GOLD}"), "hero gold line comes from landing copy");
assert(HERO_H1_GOLD === "plug-and-play.", "hero gold line is plug-and-play");
assert(landing.includes("{HERO_LEDE}"), "hero lede comes from landing copy");
assert(HERO_LEDE.includes("diagnoses the business"), "hero lede lists diagnosis as a deliverable");
assert(!landing.includes("health tool that diagnoses the"), "old run-on hero lede is gone");
assert(!landing.includes("Give every business"), "old give-every-business hero is gone");
assert(landing.includes("Create firm account"), "home has a firm signup CTA");
assert(landing.includes("{PRICING_H2_USD}"), "home pricing leads with firm bands");
assert(
  PRICING_H2_USD === "Flat USD pricing by active clients, Solo to Scale.",
  "USD band heading is the PR2 default",
);
assert(!landing.includes("Start free. <span className=\"gold-text\">Scale when it pays for itself."), "home pricing no longer leads with the owner Start-free story");
assert(landing.includes("Small businesses have the numbers"), "gap section is the strategic reposition");
assert(landing.includes("One shared workspace"), "shared-workspace framing is visible");
assert(landing.includes("AI prepares"), "AI-prepares pipeline is visible");
assert(landing.includes("reviews and signs off"), "accountant review/sign-off is visible");
assert(!landing.includes("don't fail"), "old drift headline is gone");
assert(!landing.includes("once a quarter"), "quarterly-accountant claim is gone");
assert(!landing.includes("no model for what comes next"), "old gap copy is gone");
assert(!landing.includes("borrowed SA bands"), "US median disclaimer is not landing copy");
assert(!landing.includes("the playbook"), "playbook is not the landing recommendation engine");
assert(landing.includes('id="integrations"'), "landing has an integrations callout");
assert(
  landing.includes("Works with QuickBooks Online and Xero"),
  "landing states both ledgers in crawlable text",
);
assert(
  landing.includes("Connect QuickBooks Online or Xero"),
  "landing tells visitors they can connect either ledger",
);
assert(!landing.includes("certified"), "landing does not claim certification");
assert(!landing.includes("Intuit"), "landing does not claim an Intuit relationship");
assert(!landing.includes("marketplace"), "landing does not claim marketplace approval");
assert(
  landing.includes("homepageFaqItems"),
  "landing renders homepage FAQ from the shared copy list",
);
assert(!landing.includes("930+"), "landing does not claim 930+ playbook steps");
assert(!landing.includes("31 ratios"), "landing does not claim 31 ratios");
assert(!landing.includes("13-Week Cash Forecast"), "marquee does not count the cash forecast as a ratio");
assert(!landing.includes("Current Ratio"), "marquee does not list Current Ratio");
assert(!landing.includes("Quick Ratio"), "marquee does not list Quick Ratio");
assert(!landing.includes("EBITDA Margin"), "marquee does not list EBITDA Margin");
assert(landing.includes("OCF / EBITDA"), "marquee lists OCF / EBITDA");
assert(landing.includes("Top-5 Customer Share"), "marquee lists Top-5 Customer Share");
assert(landing.includes("Degree of Operating Leverage"), "marquee lists Degree of Operating Leverage");
assert(landing.includes("Sales-per-Employee Ratio"), "marquee lists Sales-per-Employee Ratio");
assert(landing.includes("Working Capital Days"), "marquee lists Working Capital Days");
assert(landing.includes("Fixed Cost Ratio"), "marquee lists Fixed Cost Ratio");
assert(landing.includes("Interest Burden"), "marquee lists Interest Burden");
assert(landing.includes("Tax Burden"), "marquee lists Tax Burden");
assert(landing.includes("Inventory Days"), "marquee lists Inventory Days");
assert(landing.includes("Gross Profit / Labor"), "marquee lists Gross Profit / Labor");
assert(landing.includes("TRUST_ITEMS"), "trust strip uses the shared fact list");
assert(TRUST_IDENTIFIERS.includes("amounts stay"), "trust line keeps amounts");
assert(!/claude/i.test(TRUST_IDENTIFIERS), "trust line does not name a model vendor");
assert(landing.includes("showSaPricing"), "landing gates SA pricing on server geo");
assert(landing.includes("FirmBandPricingTable"), "landing pricing uses the shared band table");
assert(!landing.includes("FOUNDING_CALLOUT"), "landing does not render the ungated founding callout");
assert(!landing.includes("raw amounts removed"), "landing FAQ does not claim amounts are stripped");
assert(!landing.includes("End-to-end encrypted"), "landing does not claim E2E encryption");
assert(!landing.includes("Live sync"), "landing does not claim live ledger sync");
assert(landing.includes('href="/about"'), "landing links to about");
assert(landing.includes('href="/for-owners"'), "landing links to owners hub");
assert(landing.includes('id="home-faq"'), "landing has a visible FAQ block");
assert(landing.includes("faqPageJson(homepageFaqItems(showSaPricing))"), "landing emits homepage FAQ schema");
assert(HOMEPAGE_FAQ_ITEMS.length === 6, "homepage FAQ is six questions after the VERIFY-6 fallback");
assert(
  HOMEPAGE_FAQ_ITEMS[2].answer.includes("you do not need QuickBooks or Xero"),
  "homepage FAQ still says neither ledger is required",
);
assert(
  HOMEPAGE_FAQ_ITEMS[2].answer.includes("connect QuickBooks Online or Xero"),
  "homepage FAQ also says both ledgers can be connected",
);
assert(
  faqPageJson(HOMEPAGE_FAQ_ITEMS).includes("Does Milōn replace the accountant?"),
  "homepage FAQ schema includes the accountant question",
);
assert(!faqPageJson(publicFaqUsItems()).includes("https://milonfinance.com"), "faq schema does not use the apex host");
assert(faqPageJson(publicFaqUsItems()).includes("https://www.milonfinance.com/ai"), "faq schema points the AI notice at www");
assert(
  HOMEPAGE_FAQ_ITEMS[0].answer.includes("reviews and signs off every advisory pack"),
  "homepage FAQ keeps the accountant sign-off answer",
);

const firms = readFileSync(resolve("src/routes/for-accountants.tsx"), "utf8");
assert(firms.includes("SEO_PAGES.forAccountants"), "firm page uses spec meta");
assert(!firms.includes("South African accounting"), "firm page meta is not SA-first");
assert(firms.includes("your colors"), "firm page uses US spelling");
assert(firms.includes("Works with QuickBooks Online and Xero"), "firm page names both ledgers");
assert(firms.includes("Connect QuickBooks Online or Xero"), "firm page says connect either ledger");
assert(!firms.includes("certified"), "firm page does not claim certification");
assert(!firms.includes("Intuit"), "firm page does not claim an Intuit relationship");

const owners = readFileSync(resolve("src/routes/for-owners.tsx"), "utf8");
assert(owners.includes("SEO_PAGES.forOwners"), "owners page uses spec meta");
assert(!owners.includes("South African business owner"), "owners meta is not SA-first");
assert(owners.includes("QuickBooks Online"), "owners page names QuickBooks Online");
assert(owners.includes("Xero"), "owners page names Xero");
assert(!owners.includes("certified"), "owners page does not claim certification");

for (const page of [SEO_PAGES.home, SEO_PAGES.forAccountants, SEO_PAGES.forOwners, SEO_PAGES.faq]) {
  assert(page.description.includes("QuickBooks Online"), `${page.path} meta names QuickBooks Online`);
  assert(page.description.includes("Xero"), `${page.path} meta names Xero`);
  assert(page.description.length <= 170, `${page.path} meta description stays snippet-length`);
  assert(!page.description.includes("certified"), `${page.path} meta does not claim certification`);
}

const shell = readFileSync(resolve("src/components/marketing-shell.tsx"), "utf8");
const preferredAssets = readFileSync(resolve("src/lib/landing-assets.ts"), "utf8");
const preferredHref = "https://www.google.com/preferences/source?q=milonfinance.com";
assert(shell.includes("Works with QuickBooks Online and Xero."), "collateral footer names both ledgers");
assert(shell.includes("milonfinance.com"), "collateral footer uses the US domain");
assert(preferredAssets.includes(preferredHref), "preferred source is a plain Google preferences deeplink");
assert(
  preferredAssets.includes("Add milonfinance.com as a Preferred Source in Google"),
  "preferred source keeps the original label",
);
assert(landing.includes("PREFERRED_SOURCE_HREF"), "home footer renders the preferred source deeplink");
assert(landing.includes("PREFERRED_SOURCE_LABEL"), "home footer uses the preferred source label");
assert(landing.includes('target="_blank"'), "home preferred source opens in a new tab");
assert(landing.includes('rel="noopener"'), "home preferred source uses noopener");
assert(shell.includes("PREFERRED_SOURCE_HREF"), "collateral footer renders the preferred source deeplink");
assert(shell.includes("PREFERRED_SOURCE_LABEL"), "collateral footer uses the preferred source label");
assert(shell.includes('target="_blank"'), "collateral preferred source opens in a new tab");
assert(shell.includes('rel="noopener"'), "collateral preferred source uses noopener");
assert(!landing.includes("GooglePreferredSourceButton"), "home has no Preferred Source button component");
assert(!shell.includes("GooglePreferredSourceButton"), "collateral has no Preferred Source button component");
assert(!landing.includes("publisher.js"), "home does not load publisher.js");
assert(!shell.includes("publisher.js"), "collateral does not load publisher.js");
assert(!preferredAssets.includes("publisher.js"), "preferred source helper does not load publisher.js");
assert(!landing.includes("news.google.com/swg"), "home does not load Subscribe with Google");
assert(!shell.includes("news.google.com/swg"), "collateral does not load Subscribe with Google");
assert(!landing.includes("gstatic.com"), "home does not load a gstatic script");
assert(!landing.includes("/swg/"), "home does not load the swg bundle");
assert(!shell.includes("gstatic.com"), "collateral does not load gstatic scripts");
assert(!shell.includes("/swg/"), "collateral does not load the swg bundle");
assert(!existsSync(resolve("src/components/google-preferred-source-button.tsx")), "Preferred Source button component stays removed");
assert(!shell.includes(">milon.co.za<"), "collateral footer does not lead with milon.co.za");
assert(!shell.includes("linkedin.com"), "collateral footer does not hardcode LinkedIn");
assert(!shell.includes("x.com/milonfinance"), "collateral footer does not hardcode a dead X URL");

const mkCss = readFileSync(resolve("src/styles/marketing.css"), "utf8");
assert(mkCss.includes('html[data-market="za"] .mk-copy-us'), "ZA pack is opt-in in CSS");

const boot = readFileSync(resolve("src/lib/market/marketing.ts"), "utf8");
assert(boot.includes('d.dataset.market="us"'), "boot script defaults to US");
assert(boot.includes("Never geo-redirects"), "boot script does not geo-redirect");

const vercel = readFileSync(resolve("vercel.json"), "utf8");
assert(vercel.includes("/favicon.ico"), "Vercel caches the favicon");
assert(vercel.includes("/icons/(.*)"), "Vercel caches /icons/");
assert(!vercel.includes("favicon.ico?"), "favicon URL is not cache-busted");

const robotsRoute = readFileSync(resolve("src/routes/robots[.]txt.ts"), "utf8");
assert(robotsRoute.includes("ROBOTS_TXT"), "robots.txt is a real route");
assert(readFileSync(resolve("src/routes/llms[.]txt.ts"), "utf8").includes("LLMS_TXT"), "llms.txt route");
assert(
  readFileSync(resolve("src/routes/sitemap[.]xml.ts"), "utf8").includes("sitemapXml"),
  "sitemap.xml route",
);

assert(
  SEO_PAGES.about.title === "About MILŌN — Financial health for owners and their accountants",
  "about title is product-forward",
);
assert(
  SEO_PAGES.about.description ===
    "MILŌN turns a P&L and balance sheet into a health score, a cash forecast, and accountant-reviewed next steps.",
  "about description is product-forward",
);
assert(
  SEO_PAGES.about.imageAlt === "About MILŌN — financial health for owners and their accountants",
  "about image alt has no founder story",
);
assert(SEO_PAGES.about.description.length <= 170, "about meta description stays snippet-length");
const aboutSeo = `${SEO_PAGES.about.title}\n${SEO_PAGES.about.description}\n${SEO_PAGES.about.imageAlt}`;
assert(
  !/\bEY\b|Big 4|S&P|\bauditor\b|\bfounder\b|Outsourced CFO|\bOCFO\b/i.test(aboutSeo),
  "about SEO has no employer or founder-career claims",
);

const about = readFileSync(resolve("src/routes/about.tsx"), "utf8");
const aboutText = about.replace(/\s+/g, " ");
assert(about.includes("SEO_PAGES.about"), "about page uses spec meta");
assert(!about.includes("linkedin.com/company/milonfinance"), "about does not hardcode a dead LinkedIn URL");
assert(!about.includes("x.com/milonfinance"), "about does not hardcode a dead X URL");
assert(!about.includes("EY"), "about does not name EY");
assert(!about.includes("Big 4"), "about does not name Big 4");
assert(!about.includes("S&P"), "about does not name S&P");
assert(!about.includes("not affiliated"), "about does not carry the employer disclaimer");
assert(!about.includes("employment history"), "about does not describe employment history");
assert(!about.includes("former auditor"), "about does not describe a former auditor");
assert(!/Outsourced CFO|\bOCFO\b/.test(about), "about does not name an employer");
assert(!about.includes("founder"), "about has no founder career line");
assert(
  aboutText.includes("QuickBooks Online and Xero, plug-and-play."),
  "about weaves the approved ledger wedge",
);
assert(
  (aboutText.match(/QuickBooks Online and Xero, plug-and-play\./g) ?? []).length === 1,
  "about states the ledger wedge once",
);
assert(
  aboutText.includes(
    "Milōn Bot reads the numbers, diagnoses the business, and drafts the advisory deliverables.",
  ),
  "about keeps the Milōn Bot diagnosis line",
);
assert(aboutText.includes("The accountant reviews and signs off."), "about keeps accountant sign-off");
assert(about.includes("19 financial ratios"), "about keeps the ratio claim");
assert(about.includes("DuPont analysis"), "about keeps DuPont");
assert(about.includes("13-week cash forecast"), "about keeps the cash forecast");
assert(!about.includes("Delaware"), "about does not invent a US legal entity");

const faq = readFileSync(resolve("src/routes/faq.tsx"), "utf8");
assert(faq.includes("faqPageJson"), "faq emits FAQPage JSON-LD");
assert(faq.includes("ACCOUNTING_SOFTWARE_ANSWER"), "faq accounting-software answer is shared with schema");
assert(faq.includes("LEDGER_CONNECT_QUESTION"), "faq renders the ledger question from shared copy");
assert(faq.includes("LEDGER_CONNECT_ANSWER"), "faq renders the ledger answer from shared copy");
assert(ACCOUNTING_SOFTWARE_ANSWER.includes("not a ledger"), "accounting-software answer stays honest");
assert(ACCOUNTING_SOFTWARE_ANSWER.includes("QuickBooks Online"), "accounting-software answer names QBO");
assert(ACCOUNTING_SOFTWARE_ANSWER.includes("Xero"), "accounting-software answer names Xero");
assert(LEDGER_CONNECT_ANSWER.includes("Connect QuickBooks Online or Xero"), "ledger answer says connect");
assert(LEDGER_CONNECT_ANSWER.includes("do not need either system"), "ledger answer keeps upload as enough");
assert(!LEDGER_CONNECT_ANSWER.includes("certified"), "ledger answer does not claim certification");
assert(!LEDGER_CONNECT_ANSWER.includes("Intuit"), "ledger answer does not claim an Intuit relationship");
assert(
  publicFaqUsItems().some(
    (item) => item.question === LEDGER_CONNECT_QUESTION && item.answer === LEDGER_CONNECT_ANSWER,
  ),
  "public FAQ schema matches the visible QuickBooks and Xero answer",
);
assert(faq.includes("publicFaqItems"), "faq renders the shared answer list");
assert(faq.includes("showSaPricing"), "faq gates SA pricing on server geo");
assert(
  publicFaqUsItems().some((item) => item.answer.includes(AI_IDENTIFIERS_LINE)),
  "faq uses the identifier-only anonymisation line",
);
assert(
  publicFaqUsItems().some((item) => item.answer.includes(WATCHLIST_DEFINITION)),
  "faq defines watchlist clients",
);
assert(
  !publicFaqUsItems().some((item) => /FOUNDING|ZAR|Adaptive Pricing/i.test(item.answer)),
  "default public FAQ has no SA discount or ZAR",
);
assert(!faq.includes("raw amounts"), "faq does not claim raw amounts are stripped");
assert(
  HOMEPAGE_FAQ_ITEMS.every((item) => !item.answer.includes(AI_IDENTIFIERS_LINE)),
  "homepage FAQ does not use the identifiers-stripped line",
);
assert(
  HOMEPAGE_FAQ_ITEMS.some((item) => item.answer.includes("isn't used to train third-party AI models")),
  "homepage FAQ keeps the confirmed training answer",
);
assert(
  HOMEPAGE_FAQ_ITEMS.every((item) => !item.answer.includes("raw amounts")),
  "homepage FAQ does not claim raw amounts are removed",
);
assert(
  publicFaqUsItems().some((item) => item.answer.includes(WATCHLIST_DEFINITION)),
  "public FAQ defines watchlist",
);
assert(
  publicFaqItems(true).some((item) => item.answer.includes(SA_ZAR_LINE)),
  "ZA public FAQ includes the ZAR checkout line",
);
assert(
  publicFaqItems(true).some((item) => item.answer.includes(SA_FOUNDING_LINE)),
  "ZA public FAQ includes the founding line",
);
assert(
  !publicFaqItems(false).some((item) => /FOUNDING|50% off|ZAR|Adaptive Pricing/i.test(item.answer)),
  "US public FAQ omits founding and ZAR",
);
assert(
  publicFaqUsItems().every((item) => !item.answer.includes("raw amounts")),
  "public FAQ does not claim raw amounts are stripped",
);

const pricingTable = readFileSync(resolve("src/components/firm-band-pricing.tsx"), "utf8");
assert(pricingTable.includes("firm-trial-bar-za"), "firm pricing styles the ZA-only pricing notes");
assert(!pricingTable.includes("firm-bands-founding"), "US HTML stylesheet does not contain the FOUNDING class name");
assert(pricingTable.includes("SA_FOUNDING_LINE"), "firm pricing callout uses the ZA founding line");
assert(pricingTable.includes("showSaPricing = false"), "firm pricing hides the SA discount by default");
assert(pricingTable.includes("PRICING_WATCHLIST_NOTE"), "firm pricing defines watchlist");

const marqueeBlock = landing.split('id="marquee"')[1]?.split("</div>")[0] ?? "";
const marqueeChips = marqueeBlock.match(/<span[>\s]/g) ?? [];
assert(marqueeChips.length === 19, `marquee lists 19 ratio chips, got ${marqueeChips.length}`);

console.log("seo-foundation-test: all assertions passed");
