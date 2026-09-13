/**
 * Owner-board tour — incentive-led rewrite + premium card chrome.
 * Run: pnpm test:owner-tour
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OWNER_EMPTY_TOUR_KEY, OWNER_TOUR_KEY } from "../src/lib/onboarding.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const wizard = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const signoff = readFileSync(resolve("src/components/review-signoff.tsx"), "utf8");

function stepsBlock(name: string): string {
  const start = wizard.indexOf(`const ${name}: Step[] = [`);
  const end = wizard.indexOf("];", start);
  assert(start !== -1 && end !== -1, `${name} is defined`);
  return wizard.slice(start, end);
}

const owner = stepsBlock("OWNER_STEPS");
const ownerEmpty = stepsBlock("OWNER_EMPTY_STEPS");

const REQUIRED_SECTIONS = [
  "Business Health",
  "Notes",
  "Profit",
  "Product lines",
  "Sign-off",
  "Cash Forecast",
  "Next moves",
  "Action Plan",
] as const;

for (const section of REQUIRED_SECTIONS) {
  assert(owner.includes(`section: "${section}"`), `owner tour has ${section}`);
  assert(new RegExp(`section: "${section}"[\\s\\S]*?why:`).test(owner), `${section} states an incentive`);
}

assert(!/section: "Budget"/.test(owner), "Budget dropped from owner tour");
assert(!/section: "Milōn Bot"/.test(owner), "Bot dropped from owner tour");
assert(!/ask-ai-overview/.test(owner), "Bot target removed from owner tour");

assert(/wizard-notes-pin/.test(owner), "notes step targets the gold pen");
assert(/wizard-product-mix/.test(owner), "product-line step has a target");
assert(/wizard-owner-signoff/.test(owner), "sign-off step has a target");
assert(/wizard-profit-walk/.test(owner), "profit step targets the waterfall");
assert(/wizard-cash-outlook/.test(owner), "cash step targets the forecast");
assert(/wizard-moves-hero/.test(owner), "next-moves step targets the queue");
assert(/wizard-action-plan/.test(owner), "action-plan step targets the plan");

assert(/bottleneck/.test(owner), "health ratios are sold as bottleneck detectors");
assert(/accountant/.test(owner) && /sign/.test(owner), "accountant sign-off is on the tour");
assert(/Eisenhower/.test(owner) && /Cynefin/.test(owner) && /impact/.test(owner), "three decision models are named");
assert(/Claude/.test(owner), "next moves credit Claude");
assert(/Action Plan/.test(owner), "tour closes on the action plan");

assert(/drafts your Profit/.test(ownerEmpty), "empty tour still explains the one-upload draft");
assert(/sign off/i.test(ownerEmpty), "empty tour still queues accountant sign-off");
assert(/why:/.test(ownerEmpty), "empty tour states an incentive on each step");

assert(OWNER_TOUR_KEY === "milon_walkthrough_v12", `owner key is ${OWNER_TOUR_KEY}`);
assert(OWNER_EMPTY_TOUR_KEY === "milon_walkthrough_empty_v3", `empty key is ${OWNER_EMPTY_TOUR_KEY}`);

assert(wizard.includes("walkthrough-card--owner"), "owner tour has its own card chrome");
assert(wizard.includes("min(680px, calc(100vw - 20px))"), "owner card is wide enough to read the full body");
assert(wizard.includes("vh * 0.82"), "owner card can use most of the viewport height");
assert(wizard.includes("fontSize: ownerChrome ? 16.5"), "owner body type is enlarged");
assert(wizard.includes("fontSize: ownerChrome ? 24"), "owner title type is enlarged");
assert(wizard.includes("Show me"), "owner CTA is sales-led");
assert(wizard.includes("Open my Action Plan"), "owner finish CTA lands on the plan");
assert(wizard.includes("Bring in my figures"), "empty-owner finish CTA is the upload");
assert(wizard.includes("min(560px, calc(100vw - 24px))"), "accountant card width is unchanged");
assert(wizard.includes("vh * 0.68"), "accountant card height is unchanged");

assert(app.includes('id="wizard-product-mix"'), "product mix is a tour target on the owner board");
assert(app.includes('id="wizard-owner-signoff"'), "profit sign-off row is a tour target");
assert(signoff.includes("id?: string"), "OwnerTabSignoffRow accepts a tour id");

console.log("owner-tour-sale-test: ok");
