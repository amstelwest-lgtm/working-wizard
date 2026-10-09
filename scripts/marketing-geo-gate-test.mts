/**
 * Non-ZA visitors cannot open rand copy with ?market=ZA, a stored market,
 * or the footer switch. ZA visitors still see rand. The first render uses
 * the server pack, so SSR and hydration agree.
 * Run: pnpm test:marketing-geo-gate
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandPricingTable } from "../src/components/firm-band-pricing";
import { MarketingShell, RegionCopy } from "../src/components/marketing-shell";
import { marketingPackForGeo } from "../src/lib/geo-country";
import { visitorMarketBootScript } from "../src/lib/market/marketing";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server";
import { resolveFirmCheckoutMarket } from "../src/lib/stripe-checkout.core";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const LEAK = /R799|\brand\b|ZAR|South Africa/i;

function accountantsMarkup(geo: string, marketParam: string | null): string {
  const pack = marketingPackForGeo(geo, marketParam);
  const geoZa = geo === "ZA";
  const sa = pack === "za" ? loadSaPricingCopy() : null;
  const lead: ReactNode = sa?.accountantsLead ?? "Built for firms in the United States.";
  const hero = renderToStaticMarkup(
    createElement(RegionCopy, {
      pack,
      za: "R thousands",
      us: "$ thousands",
    }),
  );
  const page = renderToStaticMarkup(
    createElement(
      MarketingShell,
      {
        eyebrow: "For accounting and advisory practices",
        title: "Advisory",
        lead,
        ctaTitle: "Run it",
        ctaBody: "Set up a firm account.",
        copyPack: pack,
        geoZa,
        footerLine: sa?.footerLine,
      },
      createElement("h2", null, sa?.heading ?? "Pricing for firms"),
      createElement(
        "p",
        null,
        sa ? sa.accountantsIntro : "Flat USD monthly or annual bands by active client count.",
      ),
      createElement(FirmBandPricingTable, {
        interval: "month",
        showSaPricing: pack === "za",
        saLabels: sa?.labels ?? null,
      }),
    ),
  );
  return `${page}\n${hero}`;
}

assert(marketingPackForGeo("US", "ZA") === "us", "US geo ignores ?market=ZA");
assert(marketingPackForGeo("US", "za") === "us", "US geo ignores ?market=za");
assert(marketingPackForGeo("GB", "ZA") === "us", "a non-ZA geo ignores ?market=ZA");
assert(marketingPackForGeo("", "ZA") === "us", "a missing geo ignores ?market=ZA");
assert(marketingPackForGeo("ZA", null) === "za", "ZA geo defaults to rand");
assert(marketingPackForGeo("ZA", "US") === "us", "ZA geo may opt into the US view");
assert(marketingPackForGeo("ZA", "us") === "us", "ZA opt-out is case-insensitive");

const usQuery = accountantsMarkup("US", "ZA");
assert(!LEAK.test(usQuery), `US + ?market=ZA leaked: ${usQuery.match(LEAK)?.[0]}`);
assert(!usQuery.includes("mk-market-switch"), "US + ?market=ZA renders no switcher");
assert(usQuery.includes("$99/mo"), "US + ?market=ZA still shows the USD solo price");
assert(usQuery.includes("$ thousands"), "US hero micro-copy stays in dollars");

const usPlain = accountantsMarkup("US", null);
assert(!LEAK.test(usPlain), "US geo renders no rand copy");
assert(!usPlain.includes("mk-market-switch"), "US geo renders no switcher");

const za = accountantsMarkup("ZA", null);
assert(za.includes("R799/mo · about R53 per client"), "ZA geo renders the solo rand price");
assert(/\brand\b/i.test(za), "ZA geo renders the rand word");
assert(za.includes("mk-market-switch"), "ZA geo may link to the US view");
assert(za.includes("United States"), "ZA switch points at the US view");
assert(!za.includes(">South Africa<"), "ZA pricing view does not offer a switch into ZA");

const zaOptOut = accountantsMarkup("ZA", "US");
const RAND = /R799|\brand\b|ZAR/i;
assert(!RAND.test(zaOptOut), `ZA visitor who asked for US sees no rand copy: ${zaOptOut.match(RAND)?.[0]}`);
assert(zaOptOut.includes("mk-market-switch"), "ZA visitor can switch back");
assert(zaOptOut.includes("South Africa"), "the way back is only offered to a ZA visitor");

const usBoot = visitorMarketBootScript("us");
const zaBoot = visitorMarketBootScript("za");
assert(usBoot.includes('d.dataset.market="us"'), "US boot script bakes us");
assert(!usBoot.includes("localStorage"), "boot script does not read storage");
assert(!usBoot.includes("URLSearchParams"), "boot script does not read ?market=");
assert(zaBoot.includes('d.dataset.market="za"'), "ZA boot script bakes za");
assert(!zaBoot.includes("localStorage"), "ZA boot script does not read storage");

assert(
  resolveFirmCheckoutMarket(null, "za", "US") === "us",
  "billing with no firm ignores ?market=za outside ZA",
);
assert(
  resolveFirmCheckoutMarket({ country: "US" }, "za", "ZA") === "us",
  "a signed-in US firm stays USD",
);
assert(
  resolveFirmCheckoutMarket({ country: "ZA" }, "us", "US") === "za",
  "a signed-in ZA firm stays on rand",
);

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const boot = read("src/lib/market/marketing.ts");
assert(!boot.includes("localStorage.getItem"), "marketing boot source does not read storage");
assert(!boot.includes("URLSearchParams"), "marketing boot source does not read the URL");
assert(boot.includes("Never geo-redirects"), "boot script does not geo-redirect");

const shell = read("src/components/marketing-shell.tsx");
assert(!shell.includes("readVisitorDraft"), "marketing shell does not read a stored market");
assert(!shell.includes("applyPack"), "marketing shell has no client pack toggle");
assert(shell.includes("geoZa"), "the switcher is gated on the edge");

const accountants = read("src/routes/for-accountants.tsx");
assert(!accountants.includes("readVisitorDraft"), "for-accountants does not read a stored market");
assert(accountants.includes("readMarketingVisitor"), "for-accountants uses the server geo");
assert(accountants.includes("market: copyPack"), "checkout intent uses the server pack");

const landing = read("src/routes/index.tsx");
assert(
  !landing.includes('typeof window !== "undefined" ? readVisitorDraft()'),
  "landing does not read storage during the first render",
);
assert(landing.includes("const copyMarket = { copyPack }"), "hero copy is the server pack");
assert(landing.includes("stored.country !== \"ZA\""), "a stored ZA country is ignored off the ZA edge");

const billing = read("src/routes/billing.start.tsx");
assert(billing.includes("readMarketingVisitor"), "billing start reads the server geo");
assert(
  billing.includes("user && quote ? quote.market : copyPack"),
  "pre-auth billing follows the edge pack, not the URL",
);

console.log("marketing-geo-gate-test: ok");
