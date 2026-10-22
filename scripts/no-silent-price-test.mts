/**
 * A failed quote or an unknown market names the plan and does not invent
 * $39 or a rand amount. Known US and ZA amounts stay.
 * Run: pnpm test:no-silent-price
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrecardCapCard } from "../src/components/precard-cap-card.tsx";
import { FirmStarterTrialBanner } from "../src/components/firm-starter-trial-banner.tsx";
import { TrialCardSentence } from "../src/components/trial-card-sentence.tsx";
import { BillingRequiredCard } from "../src/routes/billing.required.tsx";
import {
  checkoutPriceBit,
  checkoutPriceLabel,
  firmWallDisplayPrice,
  resolveBillingWall,
} from "../src/lib/billing-wall.ts";
import { ownerPaySentence, ownerPlanLine, ownerQuotedAmount } from "../src/lib/owner-plan.ts";
import { noPlanTrialClock } from "../src/lib/firm-starter-trial.ts";
import {
  resolveStarterMonthlyLabel,
  starterMonthlyFromQuote,
  STARTER_PLAN_ONLY,
} from "../src/lib/trial-card-price.ts";
import { mountAskAi } from "../src/lib/ask-ai.js";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function hasCurrencyAmount(text: string): boolean {
  return /\$\s*\d/.test(text) || /R\s*\d/.test(text);
}

function assertPlanOnly(label: string, plan: string, where: string) {
  assert(label.includes(plan), `${where} names the plan (${label})`);
  assert(!hasCurrencyAmount(label), `${where} has no currency amount (${label})`);
}

const thrown = await resolveStarterMonthlyLabel(async () => {
  throw new Error("quote down");
});
const missing = await resolveStarterMonthlyLabel(async () => null);
assert(thrown === STARTER_PLAN_ONLY, "a thrown Starter quote is the plan name");
assert(missing === STARTER_PLAN_ONLY, "a null Starter quote is the plan name");
assert(starterMonthlyFromQuote({ market: "gb", priceLabel: null }) === STARTER_PLAN_ONLY, "an unknown market is the plan name");
assert(starterMonthlyFromQuote({ market: "za", priceLabel: null }) === STARTER_PLAN_ONLY, "a blank ZA quote is the plan name");
assert(starterMonthlyFromQuote({ market: "us", priceLabel: null }) === "$39/mo", "a US quote stays $39/mo");
assert(
  starterMonthlyFromQuote({ market: "za", priceLabel: "R 299/mo · about R 60 per client" }) === "R 299/mo",
  "a ZA quote keeps the server amount",
);

const cap = renderToStaticMarkup(createElement(PrecardCapCard, { priceLabel: thrown }));
assertPlanOnly(cap, "Starter", "the cap card after a thrown quote");

const sentence = renderToStaticMarkup(
  createElement(TrialCardSentence, { priceLabel: missing }),
);
assertPlanOnly(sentence, "Starter", "the trial sentence after a null quote");

const trial = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: "2026-10-18T12:00:00.000Z",
  now: new Date("2026-10-19T12:00:00.000Z"),
});
const banner = renderToStaticMarkup(
  createElement(FirmStarterTrialBanner, { trial, firmId: null, quote: null }),
);
assertPlanOnly(banner, "Starter", "the practice banner when the quote is null");

const hung = await resolveBillingWall({
  client: Promise.resolve(null),
  entitlement: Promise.resolve({ entitled: false }),
  quote: Promise.resolve(null),
  plan: "starter",
  interval: "month",
  timeoutMs: 30,
});
const wall = renderToStaticMarkup(
  createElement(BillingRequiredCard, {
    planName: "Starter",
    priceLabel: hung.priceLabel,
    checkout: { plan: "starter", interval: "month", market: "us" },
  }),
);
assertPlanOnly(wall, "Starter", "the billing wall when the quote is null");
assert(wall.includes("Continue on Starter"), "the wall heading names Starter");

const startShown = checkoutPriceLabel("starter", "month", null);
const startLine = `Redirecting to Stripe for Starter${checkoutPriceBit("Starter", startShown)}.`;
assert(!startLine.includes("(Starter"), "checkout does not repeat Starter in parentheses");
assertPlanOnly(startLine, "Starter", "Checkout start when the quote is null");
assert(
  checkoutPriceLabel("solo", "month", { market: "us", priceLabel: null }) === "$99/mo",
  "a known US Solo quote keeps its catalog amount",
);
assert(
  firmWallDisplayPrice({
    market: null,
    zaPriceLabel: null,
    plan: "solo",
    interval: "month",
  }) === "Solo plan",
  "an unknown Solo market is the plan name",
);

const ownerUnknown = renderToStaticMarkup(
  createElement(
    "p",
    { className: "owner-plan" },
    ownerPlanLine({ visitor: null, accountantOnMilon: false, firmName: null }),
  ),
);
assertPlanOnly(ownerUnknown, "Owner", "the owner plan when the visitor is unknown");
const ownerTerms = ownerPaySentence("za", null);
assert(!ownerTerms.includes("pay Owner plan"), "a missing owner amount does not say pay Owner plan");
assertPlanOnly(ownerTerms, "Owner", "ZA terms when the owner amount is missing");
assert(ownerQuotedAmount("us", null) === "$39/mo", "US terms keep the owner dollar amount");
assert(ownerQuotedAmount(null, null) === "Owner plan", "an unknown owner visitor has no amount");
assert(
  ownerPaySentence("us", null) === "Business owners pay $39/mo, or nothing when their accountant is on Milōn.",
  "US terms keep the pay sentence",
);

const termsSrc = readFileSync(resolve("src/routes/terms.tsx"), "utf8");
assert(termsSrc.includes("ownerPaySentence"), "terms uses the owner sentence helper");
assert(!termsSrc.includes('?? "$39/mo"'), "terms does not fall back to $39");

type Handler = (event?: unknown) => void;
class FakeElement {
  className = "";
  type = "";
  role = "";
  disabled = false;
  placeholder = "";
  value = "";
  dataset: Record<string, string | undefined> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  private html = "";
  private handlers: Record<string, Handler[]> = {};
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(value: string) {
    this.html = value;
    if (value === "") this.children = [];
  }
  get textContent(): string {
    return this.html;
  }
  set textContent(value: string) {
    this.html = value;
  }
  addEventListener(event: string, fn: Handler) {
    (this.handlers[event] ??= []).push(fn);
  }
  removeEventListener() {}
  click() {
    for (const fn of this.handlers.click ?? []) fn({});
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }
  setAttribute() {}
  focus() {}
  find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

const memory = new Map<string, string>();
(globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as { requestAnimationFrame?: (fn: () => void) => void }).requestAnimationFrame = (fn) => {
  fn();
};
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
};

async function botPrice(load: () => Promise<unknown>): Promise<string> {
  memory.set(
    "milon-bot-thread:client-1",
    JSON.stringify({
      turns: [{ role: "assistant", content: "Cap reached.", precardCap: { limit: "bot" } }],
    }),
  );
  const container = new FakeElement();
  container.dataset.clientId = "client-1";
  mountAskAi(container, { endpoint: "/api/ask", getStarterMonthly: load });
  const trigger = container.find((el) => el.className.includes("ask-ai-trigger"));
  if (!trigger) throw new Error("bot trigger missing");
  trigger.click();
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  const price = container.find((el) => el.className.includes("precard-cap-price"));
  return price?.textContent ?? "";
}

const thrownBot = await botPrice(async () => {
  throw new Error("quote down");
});
assertPlanOnly(thrownBot, "Starter", "the Bot card when the quote throws");
const nullBot = await botPrice(async () => null);
assertPlanOnly(nullBot, "Starter", "the Bot card when the quote returns null");

console.log("no-silent-price ok");
