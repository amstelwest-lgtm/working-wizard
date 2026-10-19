/**
 * CEO SEO review: unique titles, no QBO in meta, USD-only JSON-LD, Wilmington address.
 * Run: pnpm test:marketing-owner-seo
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPANY_ADDRESS, LEGAL_ENTITY } from "../src/lib/legal";
import { homepageFaqItems } from "../src/lib/landing-copy";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server";
import { INDEXABLE_PATHS, SEO_PAGES, organizationGraphJson, sitemapXml } from "../src/lib/seo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  COMPANY_ADDRESS === "800 N King Street, Suite 304, PMB 3836, Wilmington, DE 19801, United States",
  "COMPANY_ADDRESS is the Wilmington head office",
);

const tree = readFileSync(resolve("src/lib/legal.ts"), "utf8");
assert(!tree.includes("[US ADDRESS]"), "legal.ts has no address placeholder");
assert(LEGAL_ENTITY === "Milon, Inc.", "JSON-LD company name is Milon, Inc.");

const graph = organizationGraphJson();
assert(graph.includes('"name":"Milon, Inc."'), "organization name is Milon, Inc.");
assert(graph.includes('"streetAddress":"800 N King Street, Suite 304, PMB 3836"'), "postal street");
assert(graph.includes('"addressLocality":"Wilmington"'), "postal city");
assert(graph.includes('"addressRegion":"DE"'), "postal region");
assert(graph.includes('"postalCode":"19801"'), "postal code");
assert(graph.includes('"addressCountry":"US"'), "postal country");
assert(graph.includes('"applicationCategory":"BusinessApplication"'), "software category");
assert(graph.includes('"operatingSystem":"Web"'), "software operating system");
assert(
  graph.includes('"price":"99"') &&
    graph.includes('"name":"Firm plan: Starter (up to 5 active clients)","priceCurrency":"USD","price":"39"') &&
    graph.includes('"name":"Owner plan","priceCurrency":"USD","price":"39"'),
  "USD offers are Starter, Solo and owner",
);
assert(graph.includes('"priceCurrency":"USD"'), "offers are USD");
assert(!graph.includes('"price":"29"'), "owner offer is no longer $29");
assert(
  !graph.includes("ZAR") && !graph.includes("R299") && !graph.includes("R799"),
  "shared JSON-LD has no rand",
);

const titles = new Set<string>();
const descriptions = new Set<string>();
for (const page of Object.values(SEO_PAGES)) {
  assert(!page.title.includes("QBO") && !page.description.includes("QBO"), `${page.path} has no QBO in meta`);
  if (page.index === false) continue;
  assert(page.title.length <= 60, `${page.path} title is ${page.title.length} characters`);
  assert(page.description.length <= 155, `${page.path} description is ${page.description.length} characters`);
  assert(!titles.has(page.title), `${page.path} title is unique`);
  assert(!descriptions.has(page.description), `${page.path} description is unique`);
  titles.add(page.title);
  descriptions.add(page.description);
}

const map = sitemapXml("2026-10-11");
for (const path of INDEXABLE_PATHS) {
  const loc = path === "/" ? "https://www.milonfinance.com/" : `https://www.milonfinance.com${path}`;
  assert(map.includes(`<loc>${loc}</loc>`), `sitemap lists ${loc}`);
}
assert(map.includes("https://www.milonfinance.com/for-accountants"), "sitemap lists accountants");
assert(map.includes("https://www.milonfinance.com/for-owners"), "sitemap lists owners");
assert(map.includes("https://www.milonfinance.com/faq"), "sitemap lists faq");
assert(map.includes("https://www.milonfinance.com/ai"), "sitemap lists ai");

const usFaq = homepageFaqItems(false).map((item) => item.answer).join("\n");
assert(!usFaq.includes("R299") && !usFaq.includes("R799") && !usFaq.includes("ZAR"), "US homepage FAQ has no rand");
const zaFaq = homepageFaqItems(true, loadSaPricingCopy().ownerHomepageCost)
  .map((item) => item.answer)
  .join("\n");
assert(zaFaq.includes("Business owners pay R 299/mo"), "ZA homepage FAQ uses the server rand sentence");

const index = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(index.includes("imageAlt={ACCOUNTANT_TEASER.imageAlt}"), "accountant thumbnail has alt text");
assert(index.includes("imageAlt={OWNER_TEASER.imageAlt}"), "owner thumbnail has alt text");
assert(index.indexOf('id="watch"') < index.indexOf('id="persona"'), "chooser follows the videos");
assert(index.indexOf('id="persona"') < index.indexOf('id="quiz"'), "quiz stays with the chooser");
assert(!index.includes('id="problem"') && !index.includes('id="idea"'), "gap sections are merged");
assert(index.includes('id="bridge"'), "merged section keeps the bridge id");
assert(index.includes("OWNER_OFFER_LABEL"), "owner offer has a label");

const pricing = readFileSync(resolve("src/components/firm-band-pricing.tsx"), "utf8");
assert(pricing.includes("See all plans"), "pricing expander is See all plans");
assert(pricing.includes("firm-bands-featured"), "featured cards are marked");

console.log("marketing-owner-seo-test: ok");
