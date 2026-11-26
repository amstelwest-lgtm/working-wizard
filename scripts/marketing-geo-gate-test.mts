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
import { resolveFirmCheckoutMarket } from "../src/lib/stripe-checkout.core";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const LIST_PRICE = /R\d|ZAR/;

function accountantsMarkup(geo: string, marketParam: string | null): string {
  const pack = marketingPackForGeo(geo, marketParam);
  const geoZa = geo === "ZA";
  const lead: ReactNode = "Built for firms in the United States.";
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
      },
      createElement("h2", null, "Pricing for firms"),
      createElement("p", null, "Flat USD monthly or annual bands by active client count."),
      createElement(FirmBandPricingTable, { interval: "month" }),
      createElement("a", { href: "mailto:hello@milonfinance.com" }, "Pricing in rand: talk to us"),
      createElement("p", null, "We price local firms individually."),
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
assert(!LIST_PRICE.test(usQuery), `US + ?market=ZA leaked a list price: ${usQuery.match(LIST_PRICE)?.[0]}`);
assert(!usQuery.includes("South Africa"), "US + ?market=ZA does not name that country");
assert(!usQuery.includes("mk-market-switch"), "US + ?market=ZA renders no switcher");
assert(
  usQuery.includes("$39/mo") && usQuery.includes("about $8 per client"),
  "US + ?market=ZA still shows the USD starter price",
);
assert(usQuery.includes("$99/mo"), "US + ?market=ZA still shows the USD solo price");
assert(usQuery.includes("Pricing in rand: talk to us"), "US view keeps the talk-to-us line");
assert(usQuery.includes("$ thousands"), "US hero micro-copy stays in dollars");

const usPlain = accountantsMarkup("US", null);
assert(!LIST_PRICE.test(usPlain), "US geo renders no rand list price");
assert(!usPlain.includes("mk-market-switch"), "US geo renders no switcher");

const za = accountantsMarkup("ZA", null);
assert(!LIST_PRICE.test(za), `ZA geo leaked a list price: ${za.match(LIST_PRICE)?.[0]}`);
assert(za.includes("$39/mo") && za.includes("about $8 per client"), "ZA geo shows the USD starter price");
assert(za.includes("$99/mo"), "ZA geo shows the USD solo price");
assert(za.includes("Pricing in rand: talk to us"), "ZA geo shows the talk-to-us line");
assert(za.includes("We price local firms individually."), "ZA geo shows the individual-pricing line");
assert(za.includes("mk-market-switch"), "ZA geo may link to the US view");
assert(za.includes("United States"), "ZA switch points at the US view");
assert(!za.includes(">South Africa<"), "ZA pricing view does not offer a switch into ZA");

const zaOptOut = accountantsMarkup("ZA", "US");
assert(!LIST_PRICE.test(zaOptOut), `ZA visitor who asked for US sees no rand list price: ${zaOptOut.match(LIST_PRICE)?.[0]}`);
assert(zaOptOut.includes("$39/mo"), "ZA visitor who asked for US still sees the USD starter price");
assert(zaOptOut.includes("Pricing in rand: talk to us"), "the talk-to-us line stays on the US view");
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
assert(landing.includes("resolveVisitorDraft"), "landing prices the practice location through the visitor resolver");
assert(
  landing.includes('geoCountry: geoZa ? "ZA" : null'),
  "a stored ZA country is ignored off the ZA edge",
);

const billing = read("src/routes/billing.start.tsx");
assert(billing.includes("readMarketingVisitor"), "billing start reads the server geo");
assert(
  billing.includes("user && quote ? quote.market : copyPack"),
  "pre-auth billing follows the edge pack, not the URL",
);

console.log("marketing-geo-gate-test: ok");
