/**
 * Landing PR 2: nav, hero chart, proof, pricing, FAQ, floaters, reveal.
 * Run: pnpm test:landing-pr2
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { HOMEPAGE_FAQ_ITEMS } from "../src/lib/marketing-faq";
import { FIRM_TRIAL_SENTENCE } from "../src/lib/stripe-plans";
import {
  HOMEPAGE_COST_QUESTION,
  NAV_TRIAL_ARIA,
  NAV_TRIAL_LABEL,
  PRICING_TRIAL_AFTER,
  PROOF_BOT_BODY,
  PROOF_CARDS,
  PROOF_H2,
  PROOF_RATIO_BODY,
  PROOF_SECURITY_FACTS,
  PROOF_SIGNOFF_BODY,
  SA_FOUNDING_LINE,
  SA_ZAR_LINE,
  homepageFaqItems,
} from "../src/lib/landing-copy";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = resolve(import.meta.dirname, "..");
const index = readFileSync(resolve(root, "src/routes/index.tsx"), "utf8");
const css = readFileSync(resolve(root, "src/styles/landing.css"), "utf8");
const rootRoute = readFileSync(resolve(root, "src/routes/__root.tsx"), "utf8");
const copy = readFileSync(resolve(root, "src/lib/landing-copy.ts"), "utf8");
const faq = readFileSync(resolve(root, "src/lib/marketing-faq.ts"), "utf8");

const ids = [...index.matchAll(/id="(hero|watch|how|proof|method|problem|bridge|idea|pricing|persona|quiz|home-faq|register)"/g)].map(
  (m) => m[1],
);
assert(
  ids.join(",") ===
    "hero,watch,how,proof,method,problem,bridge,idea,pricing,persona,quiz,home-faq,register",
  `section order ${ids.join(",")}`,
);

const nav = index.slice(index.indexOf('<nav id="topnav"'), index.indexOf("{/* ══════════════════════════ HERO"));
assert(nav.includes("{NAV_TRIAL_LABEL}"), "nav shows the firm trial label");
assert(NAV_TRIAL_LABEL === "Start 14-day trial", "trial button label matches /for-accountants");
assert(copy.includes("FIRM_TRIAL_CTA_LABEL"), "nav trial label reuses FIRM_TRIAL_CTA_LABEL");
assert(nav.includes(`aria-label={NAV_TRIAL_ARIA}`), "nav trial button has the trial aria-label");
assert(NAV_TRIAL_ARIA === "Start my 14-day free trial", "trial aria-label text");
assert(!nav.includes("Create firm account"), "top nav has no Create firm account");
assert(nav.includes("nav-signin"), "sign in stays a ghost button");
assert(index.includes(">Create firm account<") || index.includes("Create firm account\n"), "footer keeps Create firm account");

assert(index.includes('id="proof"'), "proof section exists");
assert(index.includes(PROOF_H2) || index.includes("{PROOF_H2}"), "proof heading is sourced from copy");
for (const card of PROOF_CARDS) {
  assert(index.includes("card.alt") || copy.includes(card.alt), `alt present: ${card.alt}`);
  assert(copy.includes(card.alt), `copy alt ${card.id}`);
}
assert(PROOF_RATIO_BODY.includes("says so instead of guessing"), "VERIFY-12 sentence shipped");
assert(PROOF_SIGNOFF_BODY.includes("accountant's name and the sign-off date"), "VERIFY-11 sentence shipped");
assert(PROOF_SIGNOFF_BODY.includes("old sign-off no longer applies"), "VERIFY-5 sentence shipped");
assert(PROOF_BOT_BODY.includes("won't invent figures"), "VERIFY-9 sentence shipped");
assert(!PROOF_BOT_BODY.toLowerCase().includes("email"), "no email claim on the bot card");
const planCard = PROOF_CARDS.find((card) => card.base === "action-plan-review");
assert(planCard != null, "action plan capture is a proof card");
assert(planCard!.id === "plan", "action plan card id");
assert(planCard!.title === "An agent that knows its limits", "action plan card keeps its title");
assert(planCard!.body === PROOF_BOT_BODY, "action plan card keeps the bot body");
assert(
  planCard!.alt ===
    "Action plan ready for review with Request changes and Sign off action plan for Sample Co.",
  "action plan alt describes the review screen",
);
assert(!/waiting for accountant approval|bot run|mid-flight/i.test(planCard!.alt), "card C alt is not a bot panel");
assert(!copy.includes("bot-run"), "landing copy does not reference bot-run");
assert(
  !PROOF_SECURITY_FACTS.some((fact) => /row-level|browse-all|the firm/i.test(fact)),
  "VERIFY-6 RLS bullet omitted",
);
assert(PROOF_SECURITY_FACTS.some((fact) => fact.includes("Stripe Checkout")), "VERIFY-7 shipped");
assert(PROOF_SECURITY_FACTS.some((fact) => fact.includes("delete your account")), "VERIFY-8 shipped");
assert(
  PROOF_SECURITY_FACTS.some((fact) => fact.includes("can't be edited afterwards")),
  "sign-off log sentence shipped",
);

assert(css.includes("stroke-dashoffset:0"), "cash line is drawn in CSS");
assert(!css.includes("stroke-dashoffset:620"), "cash line does not start undrawn");
assert(index.includes("strokeDashoffset: 0") || index.includes("strokeDashoffset:0"), "cash line inline offset is 0");
assert(css.includes(".fc-1{") && css.includes("top:300px"), "desktop float card sits on the chart, clear of the sample pill");

assert(index.includes("<details"), "FAQ items are details");
assert(index.includes("<summary>"), "FAQ items have a summary");
assert(index.includes('href="/faq"'), "FAQ links to all questions");
assert(HOMEPAGE_FAQ_ITEMS.length === 6, "homepage FAQ dropped the unverified access item");
assert(HOMEPAGE_FAQ_ITEMS[0]?.question === "Does Milōn replace the accountant?", "accountant objection is first");
assert(
  HOMEPAGE_FAQ_ITEMS.some((item) => item.question === HOMEPAGE_COST_QUESTION),
  "HOMEPAGE_COST_QUESTION matches a homepage FAQ item",
);
assert(!faq.includes("AI_IDENTIFIERS_LINE") || !HOMEPAGE_FAQ_ITEMS.some((item) => item.answer.includes("Identifiers")), "homepage FAQ does not use the identifiers-stripped line");
assert(!HOMEPAGE_FAQ_ITEMS.some((item) => /claude/i.test(item.question + item.answer)), "no Claude on homepage FAQ");

const usCost = homepageFaqItems(false).find((item) => item.question === HOMEPAGE_COST_QUESTION);
const zaCost = homepageFaqItems(true).find((item) => item.question === HOMEPAGE_COST_QUESTION);
assert(usCost != null && zaCost != null, "cost answers exist");
assert(!/FOUNDING|50% off|\bZAR\b|Adaptive Pricing/i.test(usCost!.answer), "US cost answer has no SA pricing");
assert(zaCost!.answer.endsWith(`${SA_ZAR_LINE} ${SA_FOUNDING_LINE}`), "ZA cost answer appends both lines once");
assert(PRICING_TRIAL_AFTER.startsWith("Card on file."), "VERIFY-2 after-trial sentence");
assert(FIRM_TRIAL_SENTENCE === "14-day free trial · up to 3 clients", "trial sentence unchanged");

assert(css.includes(".reveal,") && css.includes("opacity:1"), "reveal content is visible by default");
assert(rootRoute.includes("max-width: 1023px"), "logged-out landing hides floaters under 1024");
assert(rootRoute.includes("return null"), "narrow logged-out landing renders no floater");
assert(!/claude/i.test(index + copy), "homepage source has no Claude");
assert(!/white-label/i.test(index), "homepage source has no white-label");
assert(!index.includes("3 free clients"), "homepage source has no 3 free clients");

for (const card of PROOF_CARDS) {
  for (const width of [480, 800, 1200, 1600] as const) {
    const path = resolve(root, "public/proof", `${card.base}-${width}.webp`);
    const size = statSync(path).size;
    assert(size > 1000, `${card.base}-${width} is a real image`);
    if (width === 800) assert(size <= 120 * 1024, `${card.base}-800 is ${size} bytes, over 120KB`);
    assert(!existsSync(resolve(root, "public/proof", `bot-run-${width}.webp`)), `bot-run-${width} removed`);
  }
}

console.log("landing-pr2 ok");
