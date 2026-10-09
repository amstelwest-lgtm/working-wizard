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
  TRUST_IDENTIFIERS,
  TRUST_TRAINING,
  homepageFaqItems,
} from "../src/lib/landing-copy";
import { publicFaqItems } from "../src/lib/public-faq";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server";
import { AI_MODEL_DISCLOSURE } from "../src/lib/marketing-faq";
import { faqPageJson } from "../src/lib/seo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const LEAK = /FOUNDING|50% off|ZAR|Adaptive Pricing|claude|trymilon/i;
const DISCLOSURE =
  "Milōn Bot prepares draft recommendations for accountant review. Identifiers are stripped from the text we send; uploaded PDF statements are read as-is to extract the figures. Not used to train models.";

function count(haystack: string, needle: string): number {
  const text = haystack.replace(/\s+/g, " ");
  let n = 0;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(needle, from);
    if (at === -1) return n;
    n += 1;
    from = at + needle.length;
  }
  return n;
}

function surface(showSaPricing: boolean): string {
  const copy = showSaPricing ? loadSaPricingCopy() : null;
  const table = renderToStaticMarkup(
    createElement(FirmBandPricingTable, {
      interval: "month",
      showSaPricing,
      saLabels: copy?.labels ?? null,
    }),
  );
  const home = homepageFaqItems(showSaPricing)
    .map((item) => `${item.question} ${item.answer}`)
    .join("\n");
  const homeJson = faqPageJson(homepageFaqItems(showSaPricing));
  return `${table}\n${home}\n${homeJson}`;
}

assert(isSaPricingCountry("ZA") === true, "ZA header shows SA pricing");
assert(isSaPricingCountry("US") === false, "US header hides SA pricing");
assert(isSaPricingCountry("") === false, "missing header hides SA pricing");
assert(isSaPricingCountry(null) === false, "null header hides SA pricing");
assert(isSaPricingCountry("za") === false, "country match is case-sensitive ZA");

const us = surface(false);
assert(!LEAK.test(us), `US render leaked a forbidden string: ${us.match(LEAK)?.[0]}`);
assert(!us.includes("R799"), "US render omits the rand price");
assert(!us.includes("South African"), "US render omits the rand heading");

const za = surface(true);
assert(za.includes("R799/mo · about R53 per client"), "ZA render shows the solo rand price");
assert(!za.toLowerCase().includes("vat"), "ZA render has no tax wording");
assert(!/FOUNDING|50% off/.test(za), "ZA render drops the old founding line");

assert(!faqPageJson(homepageFaqItems(false)).includes("ZAR"), "US homepage JSON-LD has no ZAR");
assert(!faqPageJson(publicFaqItems(false)).includes("ZAR"), "US FAQ JSON-LD has no ZAR");
assert(!faqPageJson(publicFaqItems(true)).includes("R799"), "FAQ JSON-LD does not embed the rand price");

assert(!/claude/i.test(HERO_LEDE), "wedge line does not name a vendor");
assert(
  HERO_SIGNOFF_POINT === "You review and sign off every advisory pack.",
  "VERIFY-1 hero bullet does not claim sign-off gates the client",
);
assert(!/claude/i.test(TRUST_IDENTIFIERS), "VERIFY-3 trust line does not claim every AI call");
assert(TRUST_TRAINING.includes("isn't used to train"), "VERIFY-4 training line is the confirmed wording");
assert(AI_MODEL_DISCLOSURE === DISCLOSURE, "FAQ disclosure constant is the approved sentence");

const GATE = /before advice reaches|before anything reaches|before a client ever sees|before advice is shown|before the client sees|Nothing reaches a client|waits for your sign-off|what was signed off/i;
for (const file of [
  "src/routes/index.tsx",
  "src/routes/faq.tsx",
  "src/routes/for-accountants.tsx",
  "src/lib/landing-copy.ts",
  "src/lib/marketing-faq.ts",
]) {
  const src = readFileSync(resolve(file), "utf8");
  assert(!GATE.test(src), `${file} does not claim sign-off gates what the client sees`);
}

for (const file of ["src/routes/index.tsx", "src/routes/for-accountants.tsx", "src/lib/landing-copy.ts"]) {
  const src = readFileSync(resolve(file), "utf8");
  assert(!/claude/i.test(src), `${file} source has no model vendor name`);
  assert(!/trymilon/i.test(src), `${file} source has no trymilon mailbox`);
}

const faqRoute = readFileSync(resolve("src/routes/faq.tsx"), "utf8");
assert(faqRoute.includes("showSaPricing"), "faq threads the server geo gate");
assert(!/trymilon/i.test(faqRoute), "faq source has no trymilon mailbox");
assert(faqRoute.includes("publicFaqItems"), "faq visible answers and JSON-LD share publicFaqItems");

const faqVisible = publicFaqItems(false)
  .map((item) => `${item.question} ${item.answer}`)
  .join("\n");
const faqJson = faqPageJson(publicFaqItems(false));
assert(count(faqVisible, DISCLOSURE) === 1, "/faq visible answers contain the disclosure once");
assert(count(faqJson, DISCLOSURE) === 1, "/faq JSON-LD contains the same disclosure once");
assert((faqVisible.match(/claude/gi) ?? []).length === 0, "/faq answers do not name the model vendor");
assert(!faqVisible.includes("the AI notice names the model provider"), "old provider sentence is gone");
assert(!faqVisible.includes("It is powered by Claude"), "old powered-by sentence is gone");

const homeVisible = homepageFaqItems(false)
  .map((item) => `${item.question} ${item.answer}`)
  .join("\n");
assert(!homeVisible.includes(DISCLOSURE), "homepage FAQ does not carry the disclosure");
assert(!/claude/i.test(homeVisible), "homepage FAQ does not name Claude");

const privacy = readFileSync(resolve("src/routes/privacy.tsx"), "utf8");
assert(count(privacy, DISCLOSURE) === 1, "/privacy contains the disclosure sentence exactly once");

const accountants = readFileSync(resolve("src/routes/for-accountants.tsx"), "utf8");
assert(accountants.includes("showSaPricing"), "for-accountants threads the server geo gate");
const invitePanel = readFileSync(resolve("src/components/owner-invite-signup-panel.tsx"), "utf8");
assert(!/claude/i.test(invitePanel), "invite signup microcopy does not name Claude");

const pricing = readFileSync(resolve("src/components/firm-band-pricing.tsx"), "utf8");
assert(pricing.includes("showSaPricing = false"), "pricing table defaults the SA gate off");
assert(!/adaptive pricing/i.test(pricing), "pricing table no longer says Adaptive Pricing");

const enterprise = readFileSync(resolve("src/lib/firm-signup-copy.ts"), "utf8");
assert(enterprise.includes("hello@milonfinance.com"), "enterprise mailto is hello@");
assert(!enterprise.includes("team@trymilon.com"), "enterprise mailto dropped team@trymilon.com");

console.log("landing-pr1-geo-test: ok");
