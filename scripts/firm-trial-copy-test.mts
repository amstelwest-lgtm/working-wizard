/**
 * One trial sentence: Starter, 14 days, up to 5 clients, card after the first result.
 * Run: pnpm test:firm-trial-copy
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideFirmClientCreate, formatFirmPlanStatus } from "../src/lib/firm-client-cap";
import { FIRM_CARD_TIMING, firmSignupTrialReminder } from "../src/lib/firm-signup-copy";
import { FIRM_TRIAL_EXPLORE, PRICING_TRIAL_AFTER } from "../src/lib/landing-copy";
import { PRECARD_CAP_MESSAGE, precardCapApplies } from "../src/lib/precard-cap";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server";
import { SAGE_CONNECTION_UNAVAILABLE, sagePublicError } from "../src/lib/sage";
import {
  FIRM_BAND_CATALOG,
  FIRM_TRIAL_CARD_LINE,
  FIRM_TRIAL_CARD_NOTE,
  FIRM_TRIAL_CLIENT_LIMIT,
  FIRM_TRIAL_DAYS,
  FIRM_TRIAL_SENTENCE,
} from "../src/lib/stripe-plans";
import { TRIAL_SIGNUP_SENTENCE } from "../src/lib/trial-public";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const CANONICAL = "14-day free trial · up to 5 clients";

assert(FIRM_TRIAL_DAYS === 14, "the trial is 14 days");
assert(FIRM_TRIAL_CLIENT_LIMIT === 5, "the trial cap is 5");
assert(
  FIRM_TRIAL_CLIENT_LIMIT === FIRM_BAND_CATALOG.starter.clientLimit,
  "the trial cap is Starter's catalog cap",
);
assert(FIRM_BAND_CATALOG.solo.clientLimit === 15, "paid Solo stays at 15");
assert(FIRM_TRIAL_SENTENCE === CANONICAL, "the locked sentence is the only trial wording");
assert(TRIAL_SIGNUP_SENTENCE === FIRM_TRIAL_SENTENCE, "the public trial sentence cannot drift");
assert(
  FIRM_TRIAL_CARD_LINE === `${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE}`,
  "card line",
);
assert(
  FIRM_TRIAL_CARD_NOTE === "You add a card once you have seen your first result.",
  "the card is asked for after the first result",
);
assert(FIRM_CARD_TIMING === FIRM_TRIAL_CARD_LINE, "signup timing uses the card line");
assert(PRECARD_CAP_MESSAGE === FIRM_TRIAL_CARD_LINE, "the pre-card wall uses the card line");
assert(
  precardCapApplies({ stripeConfigured: true, phase: "none" }) === true,
  "the pre-card gate still applies when there is no subscription",
);
assert(
  precardCapApplies({ stripeConfigured: true, phase: "trialing" }) === false,
  "a trialing firm is not on the pre-card gate",
);

const reminder = firmSignupTrialReminder("Solo");
const SIGNUP_TRIAL =
  "Your first client is free to explore. Add a card to start your 14-day free trial · up to 5 clients.";
assert(reminder === firmSignupTrialReminder("Solo", "US"), "a missing country stays on the dollar catalog");
assert(reminder.startsWith(SIGNUP_TRIAL), "signup uses the approved trial line");
assert(reminder.endsWith("Then $39/mo."), "signup names the Starter dollar price");
assert(!reminder.includes("You add a card once you have seen your first result."), "signup drops the old card line");
assert(!reminder.includes("You will start on"), "signup does not say you will start on the selected band");
assert(reminder.includes(FIRM_TRIAL_SENTENCE), "signup uses the locked sentence");
assert(!reminder.toLowerCase().includes("no card"), "signup does not say no card");
assert(!reminder.toLowerCase().includes("vat"), "signup trial line has no VAT wording");

assert(FIRM_TRIAL_EXPLORE.startsWith(FIRM_TRIAL_SENTENCE), "hero starts with the locked sentence");
assert(FIRM_TRIAL_EXPLORE.includes("On Starter"), "hero names Starter");
assert(FIRM_TRIAL_EXPLORE.includes("Then $39/mo."), "US hero names the Starter dollar price");
assert(!/R\s?\d/.test(FIRM_TRIAL_EXPLORE), "the shared hero note has no rand amount");
assert(!/R\s?\d/.test(PRICING_TRIAL_AFTER), "the shared pricing line has no rand amount");

const za = loadSaPricingCopy();
assert(za.heroNote.includes(FIRM_TRIAL_SENTENCE), "ZA hero uses the locked sentence");
assert(za.heroNote.includes("Then R 299/mo."), "ZA hero names the Starter rand price");
assert(!za.heroNote.includes("$39"), "ZA hero does not name the dollar price");
assert(za.trialAfter.includes("Then R 299/mo."), "ZA pricing bar names the rand price");
assert(!za.trialAfter.toLowerCase().includes("vat"), "ZA trial line has no VAT wording");

for (const band of ["starter", "solo", "small", "scale"] as const) {
  assert(
    decideFirmClientCreate({
      stripeConfigured: true,
      phase: "trialing",
      band,
      clientCount: 4,
    }).allowed,
    `${band} trial allows a 5th client`,
  );
  const blocked = decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band,
    clientCount: 5,
  });
  assert(!blocked.allowed && blocked.code === "trial_client_cap", `${band} trial stops at 5`);
  assert(
    !blocked.allowed &&
      blocked.message ===
        `${FIRM_TRIAL_SENTENCE} on Starter. This practice has reached the ${FIRM_TRIAL_CLIENT_LIMIT}-client trial limit.`,
    `${band} trial block uses the locked sentence and names the trial limit`,
  );
  assert(!blocked.message.toLowerCase().includes("vat"), `${band} trial block does not mention VAT`);
  assert(
    formatFirmPlanStatus({ phase: "trialing", band }).detail === `Starter · ${FIRM_TRIAL_SENTENCE}`,
    `${band} trial status names Starter and the locked sentence`,
  );
}

for (const clientCount of [5, 6]) {
  const over = decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band: "starter",
    clientCount,
  });
  assert(!over.allowed, `a Starter trial at ${clientCount} is blocked`);
  const claims = [...over.message.matchAll(/already has (\d+) clients/gi)].map((match) => Number(match[1]));
  assert(
    claims.every((count) => count === clientCount),
    `trial copy must not state a client count other than ${clientCount}`,
  );
  assert(
    over.message.includes(`reached the ${FIRM_TRIAL_CLIENT_LIMIT}-client trial limit`),
    "trial copy names the trial limit rather than a stale active count",
  );
}

assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "active",
    band: "solo",
    clientCount: 5,
  }).allowed,
  "paid Solo still allows more than the trial cap",
);
assert(
  !decideFirmClientCreate({
    stripeConfigured: true,
    phase: "active",
    band: "solo",
    clientCount: 15,
  }).allowed,
  "paid Solo still stops at 15",
);

assert(
  sagePublicError("SAGE_SA_API_KEY or SAGE_SA_PASSWORD_KEY is not set.") === SAGE_CONNECTION_UNAVAILABLE,
  "a Sage key hint becomes the generic message",
);
assert(
  sagePublicError("Sage rejected that email or password.") === "Sage rejected that email or password.",
  "a real Sage login error stays",
);
assert(SAGE_CONNECTION_UNAVAILABLE === "Sage connection not available yet", "generic Sage message");

const root = resolve(import.meta.dirname, "..");
const surfaces = [
  "src/lib/landing-copy.ts",
  "src/lib/firm-signup-copy.ts",
  "src/lib/trial-public.ts",
  "src/lib/marketing-faq.ts",
  "src/lib/public-faq.ts",
  "src/lib/seo.ts",
  "src/lib/welcome-email.ts",
  "src/lib/stripe-plans.ts",
  "src/routes/terms.tsx",
  "src/routes/privacy.tsx",
  "src/routes/billing.success.tsx",
  "src/routes/billing.start.tsx",
  "src/routes/billing.required.tsx",
  "src/components/checkout-after-insight.tsx",
  "src/components/walkthrough-wizard.tsx",
  "src/components/firm-signup-terms.tsx",
  "src/components/try-demo.tsx",
  "src/components/landing/register-form.tsx",
  "src/components/firm-band-pricing.tsx",
  "src/components/sage-connect.tsx",
  "src/routes/index.tsx",
  "src/routes/auth.tsx",
];
const banned = ["up to 3 clients", "3 free clients", "no card", "You will start on", "free clients"];
for (const rel of surfaces) {
  const text = readFileSync(resolve(root, rel), "utf8");
  for (const phrase of banned) {
    assert(!text.toLowerCase().includes(phrase), `${rel} still says ${phrase}`);
  }
  assert(!text.includes("SAGE_SA_API_KEY"), `${rel} names a Sage environment variable`);
}

const sharedUsd = readFileSync(resolve(root, "src/lib/landing-copy.ts"), "utf8");
assert(!sharedUsd.includes("R 299") && !sharedUsd.includes("R299"), "landing copy has no rand price");
const pricing = readFileSync(resolve(root, "src/components/firm-band-pricing.tsx"), "utf8");
assert(!pricing.includes("R 299") && !pricing.includes("R299"), "the pricing component has no baked rand price");

console.log("firm-trial-copy: ok");
