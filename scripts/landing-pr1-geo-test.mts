/**
 * Landing PR1: US HTML must not leak the SA discount, ZAR pricing, the model
 * vendor, or the retired mailbox. ZA HTML shows the two approved lines.
 * Run: pnpm test:landing-pr1-geo
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandPricingTable } from "../src/components/firm-band-pricing";
import { isSaPricingCountry } from "../src/lib/geo-country";
import {
  HERO_LEDE,
  HERO_SIGNOFF_POINT,
  SA_FOUNDING_LINE,
  SA_ZAR_LINE,
  TRUST_IDENTIFIERS,
  TRUST_TRAINING,
  homepageFaqItems,
  publicFaqItems,
} from "../src/lib/landing-copy";
import { faqPageJson } from "../src/lib/seo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const LEAK = /FOUNDING|50% off|ZAR|Adaptive Pricing|claude|trymilon/i;

function surface(showSaPricing: boolean): string {
  const table = renderToStaticMarkup(
    createElement(FirmBandPricingTable, { interval: "month", showSaPricing }),
  );
  const home = homepageFaqItems(showSaPricing)
    .map((item) => `${item.question} ${item.answer}`)
    .join("\n");
  const faq = publicFaqItems(showSaPricing)
    .map((item) => `${item.question} ${item.answer}`)
    .join("\n");
  const jsonLd = faqPageJson(homepageFaqItems(showSaPricing)) + faqPageJson(publicFaqItems(showSaPricing));
  return `${table}\n${home}\n${faq}\n${jsonLd}`;
}

assert(isSaPricingCountry("ZA") === true, "ZA header shows SA pricing");
assert(isSaPricingCountry("US") === false, "US header hides SA pricing");
assert(isSaPricingCountry("") === false, "missing header hides SA pricing");
assert(isSaPricingCountry(null) === false, "null header hides SA pricing");
assert(isSaPricingCountry("za") === false, "country match is case-sensitive ZA");

const us = surface(false);
assert(!LEAK.test(us), `US render leaked a forbidden string: ${us.match(LEAK)?.[0]}`);
assert(!us.includes(SA_ZAR_LINE), "US render omits the ZAR line");
assert(!us.includes(SA_FOUNDING_LINE), "US render omits the founding line");

const za = surface(true);
assert(za.includes(SA_ZAR_LINE), "ZA render shows the ZAR checkout line");
assert(za.includes(SA_FOUNDING_LINE), "ZA render shows the founding line");
assert((za.match(/South African firms can pay in ZAR at Checkout\./g) ?? []).length >= 1, "ZAR line is present");
assert(
  (za.match(/FOUNDING: 50% off monthly paid plans after the trial\. Doesn't combine with annual billing\./g) ?? [])
    .length >= 1,
  "founding line is present",
);

assert(!faqPageJson(homepageFaqItems(false)).includes("ZAR"), "US homepage JSON-LD has no ZAR");
assert(!faqPageJson(publicFaqItems(false)).includes("ZAR"), "US FAQ JSON-LD has no ZAR");
assert(faqPageJson(publicFaqItems(true)).includes(SA_ZAR_LINE), "ZA FAQ JSON-LD includes the ZAR line");

assert(!/claude/i.test(HERO_LEDE), "wedge line does not name a vendor");
assert(
  HERO_SIGNOFF_POINT === "You review and sign off before advice reaches your client.",
  "VERIFY-1 uses the fallback sign-off line",
);
assert(!/claude/i.test(TRUST_IDENTIFIERS), "VERIFY-3 trust line does not claim every AI call");
assert(TRUST_TRAINING.includes("isn't used to train"), "VERIFY-4 training line is the confirmed wording");

for (const file of ["src/routes/index.tsx", "src/routes/faq.tsx", "src/routes/for-accountants.tsx"]) {
  const src = readFileSync(resolve(file), "utf8");
  assert(!/claude/i.test(src), `${file} source has no model vendor name`);
  assert(!/trymilon/i.test(src), `${file} source has no trymilon mailbox`);
  assert(src.includes("showSaPricing"), `${file} threads the server geo gate`);
}

const pricing = readFileSync(resolve("src/components/firm-band-pricing.tsx"), "utf8");
assert(pricing.includes("showSaPricing = false"), "pricing table defaults the SA gate off");
assert(!/adaptive pricing/i.test(pricing), "pricing table no longer says Adaptive Pricing");

const enterprise = readFileSync(resolve("src/lib/firm-signup-copy.ts"), "utf8");
assert(enterprise.includes("hello@milonfinance.com"), "enterprise mailto is hello@");
assert(!enterprise.includes("team@trymilon.com"), "enterprise mailto dropped team@trymilon.com");

console.log("landing-pr1-geo-test: ok");
