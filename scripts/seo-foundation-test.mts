/**
 * US-first marketing SEO foundation (phase 1).
 * Run: pnpm test:seo-foundation
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  INDEXABLE_PATHS,
  LLMS_TXT,
  ROBOTS_TXT,
  SEO_PAGES,
  SITE_ORIGIN,
  faqPageJson,
  organizationGraphJson,
  pageHead,
  sitemapXml,
} from "../src/lib/seo";
import { ACCOUNTING_SOFTWARE_ANSWER, HOMEPAGE_FAQ_ITEMS } from "../src/lib/marketing-faq";
import { visitorCopyPack } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SITE_ORIGIN === "https://milonfinance.com", "canonical origin");
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
assert(ROBOTS_TXT.includes("Sitemap: https://milonfinance.com/sitemap.xml"), "robots points at sitemap");

assert(LLMS_TXT.includes("AI-automated finance function"), "llms.txt positioning");
assert(LLMS_TXT.includes("/for-accountants"), "llms.txt keeps existing firm URL");
assert(LLMS_TXT.includes("/about"), "llms.txt includes about");
assert(LLMS_TXT.includes("Primary: United States"), "llms.txt US-first");
assert(!LLMS_TXT.includes("photographed"), "llms.txt does not claim photo ingest");
assert(!LLMS_TXT.includes("Canada"), "llms.txt does not claim Canada");
assert(!graph.includes("Canada"), "org schema does not claim Canada");
assert(!graph.includes("photographed"), "schema does not claim photo ingest");
assert(graph.includes("19 financial ratios"), "schema uses the real ratio count");
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
assert(!landing.includes("linkedin.com/company/milonfinance"), "landing does not hardcode a dead LinkedIn URL");
assert(!landing.includes("x.com/milonfinance"), "landing does not hardcode a dead X URL");
assert(landing.includes("SEO_PAGES.home"), "landing uses spec meta");
assert(!landing.includes("South African accounting"), "landing meta is not SA-first");
assert(
  landing.includes('country: "US" as const'),
  "quiz defaults to US when the visitor has no market pick",
);
assert(!landing.includes("Connect QuickBooks"), "landing does not claim a QuickBooks connection");
assert(
  landing.includes("HOMEPAGE_FAQ_ITEMS"),
  "landing renders homepage FAQ from the shared copy list",
);
assert(!landing.includes("930+"), "landing does not claim 930+ playbook steps");
assert(!landing.includes("31 ratios"), "landing does not claim 31 ratios");
assert(!landing.includes("End-to-end encrypted"), "landing does not claim E2E encryption");
assert(!landing.includes("Live sync"), "landing does not claim live ledger sync");
assert(landing.includes('href="/about"'), "landing links to about");
assert(landing.includes('href="/for-owners"'), "landing links to owners hub");
assert(landing.includes('id="bridge"'), "landing keeps the dual-audience bridge");
assert(!landing.includes('id="features"'), "landing drops the duplicate features block");
assert(landing.includes('id="home-faq"'), "landing has a visible FAQ block");
assert(landing.includes("faqPageJson(HOMEPAGE_FAQ_ITEMS)"), "landing emits homepage FAQ schema");
assert(HOMEPAGE_FAQ_ITEMS.length === 5, "homepage FAQ is five questions");
assert(
  HOMEPAGE_FAQ_ITEMS[1].answer.includes("you do not need QuickBooks or Xero"),
  "QBO/Xero appear only as not required",
);
assert(
  faqPageJson(HOMEPAGE_FAQ_ITEMS).includes("Does MILŌN replace my accountant?"),
  "homepage FAQ schema includes the accountant question",
);

const firms = readFileSync(resolve("src/routes/for-accountants.tsx"), "utf8");
assert(firms.includes("SEO_PAGES.forAccountants"), "firm page uses spec meta");
assert(!firms.includes("South African accounting"), "firm page meta is not SA-first");
assert(firms.includes("your colors"), "firm page uses US spelling");

const owners = readFileSync(resolve("src/routes/for-owners.tsx"), "utf8");
assert(owners.includes("SEO_PAGES.forOwners"), "owners page uses spec meta");
assert(!owners.includes("South African business owner"), "owners meta is not SA-first");

const shell = readFileSync(resolve("src/components/marketing-shell.tsx"), "utf8");
assert(shell.includes("milonfinance.com"), "collateral footer uses the US domain");
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

const about = readFileSync(resolve("src/routes/about.tsx"), "utf8");
assert(about.includes("SEO_PAGES.about"), "about page uses spec meta");
assert(!about.includes("linkedin.com/company/milonfinance"), "about does not hardcode a dead LinkedIn URL");
assert(!about.includes("x.com/milonfinance"), "about does not hardcode a dead X URL");
assert(about.includes("not affiliated with, endorsed by, or connected to EY"), "about has EY disclaimer");
assert(!about.includes("QuickBooks"), "about does not claim QuickBooks");
assert(!about.includes("Delaware"), "about does not invent a US legal entity");
assert(!about.includes("Xero"), "about does not claim Xero");

const faq = readFileSync(resolve("src/routes/faq.tsx"), "utf8");
assert(faq.includes("faqPageJson"), "faq emits FAQPage JSON-LD");
assert(faq.includes("ACCOUNTING_SOFTWARE_ANSWER"), "faq accounting-software answer is shared with schema");
assert(!faq.includes("QuickBooks"), "faq does not claim QuickBooks");
assert(!faq.includes("Xero"), "faq does not claim Xero");
assert(ACCOUNTING_SOFTWARE_ANSWER.includes("not a ledger"), "accounting-software answer stays honest");
assert(!ACCOUNTING_SOFTWARE_ANSWER.includes("QuickBooks"), "accounting-software answer does not name QBO");

console.log("seo-foundation-test: all assertions passed");
