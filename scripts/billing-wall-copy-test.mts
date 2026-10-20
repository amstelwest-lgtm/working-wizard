/**
 * Billing wall copy: one price, one trial line, no Owner plan, Retry only
 * after a failed check, and Back to the client list.
 * Run: pnpm test:billing-wall-copy
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BillingRequiredCard } from "../src/routes/billing.required.tsx";
import {
  FIRM_WALL_TRIAL_ENDED_LINE,
  FIRM_WALL_TRIAL_LINE,
  firmWallBackTarget,
  firmWallOffersRetry,
  firmWallWhyLine,
  resolveBillingWall,
} from "../src/lib/billing-wall.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function count(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  while (needle && (i = hay.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

const checkout = { plan: "starter" as const, interval: "month" as const, market: "us" as const };

function card(props: {
  priceLabel: string | null;
  onRetry?: () => void;
  trialEnded?: boolean;
  backHref?: string;
}) {
  return renderToStaticMarkup(
    createElement(BillingRequiredCard, {
      planName: "Starter",
      priceLabel: props.priceLabel,
      clientName: "New York Test company",
      checkout,
      onRetry: props.onRetry,
      trialEnded: props.trialEnded,
      backHref: props.backHref,
    }),
  );
}

for (const variant of [
  { market: "us", price: "$39/mo" },
  { market: "za", price: "R299/mo" },
] as const) {
  const html = card({ priceLabel: variant.price });
  assert(count(html, variant.price) === 1, `${variant.market} price renders once`);
  assert(count(html, FIRM_WALL_TRIAL_LINE) === 1, `${variant.market} trial line renders once`);
  assert(!html.includes("Owner plan"), `${variant.market} wall does not pitch the Owner plan`);
  assert(!html.includes("VAT"), `${variant.market} wall has no VAT wording`);
  assert(!html.includes("Retry"), `${variant.market} confirmed unpaid wall hides Retry`);
  assert(html.includes('href="/clients"'), `${variant.market} Back target is /clients`);
  assert(html.includes("Back to clients"), `${variant.market} Back label is the client list`);
  assert(!html.includes("Back to pricing"), `${variant.market} wall has no pricing link`);
  assert(html.includes("Start trial"), `${variant.market} primary action is Start trial`);
  assert(html.includes("bg-[#0B5FFF]") && html.includes("text-white"), `${variant.market} Start trial is solid cobalt`);
  assert(html.includes("border-[#0B5FFF]") && html.includes("text-[#0B5FFF]"), `${variant.market} Back is a cobalt outline`);
  assert(html.includes("bg-white") && html.includes("text-[#102A43]") && html.includes("border-[#DBEAFE]"), `${variant.market} canvas is the light shell`);
  assert(!html.includes("amber") && !html.includes("#0b1220"), `${variant.market} wall has no gold or near-black canvas`);
  assert(html.includes(firmWallWhyLine("New York Test company")), `${variant.market} explains the open client`);
  assert(
    firmWallWhyLine("New York Test company") ===
      "This firm has no plan yet. Your first client and its numbers stay open. Reports and a later client need Starter.",
    `${variant.market} names the open file, not the client`,
  );
  assert(
    !firmWallWhyLine("New York Test company").includes("New York Test company"),
    `${variant.market} does not put the client name in the why line`,
  );
  assert(!html.includes(FIRM_WALL_TRIAL_ENDED_LINE), `${variant.market} does not mention an ended trial by default`);
}

const retryHtml = card({ priceLabel: "$39/mo", onRetry: () => undefined });
assert(retryHtml.includes("Retry"), "Retry is present when the check failed");

const endedHtml = card({ priceLabel: "$39/mo", trialEnded: true });
assert(count(endedHtml, FIRM_WALL_TRIAL_ENDED_LINE) === 1, "an ended trial is said once");
assert(count(endedHtml, FIRM_WALL_TRIAL_LINE) === 1, "the trial line is not replaced by the ended case");

assert(!firmWallOffersRetry("not_entitled"), "a successful not-entitled check hides Retry");
assert(!firmWallOffersRetry("entitled"), "an entitled check hides Retry");
assert(firmWallOffersRetry("failed"), "a failed check shows Retry");

assert(firmWallBackTarget({}) === "/clients", "no referrer goes to the client list");
assert(
  firmWallBackTarget({ referrer: "https://example.com/clients/later", pageOrigin: "http://localhost:5000" }) ===
    "/clients",
  "an outside referrer goes to the client list",
);
assert(
  firmWallBackTarget({
    referrer: "http://localhost:5000/clients/later-file",
    pageOrigin: "http://localhost:5000",
    firstClientId: "first-file",
  }) === "/clients",
  "a later client file is not the back target",
);
assert(
  firmWallBackTarget({
    referrer: "http://localhost:5000/practice",
    pageOrigin: "http://localhost:5000",
  }) === "/practice",
  "an in-app practice referrer is kept",
);

const confirmed = await resolveBillingWall({
  client: Promise.resolve({ id: "first", name: "New York Test company" }),
  entitlement: Promise.resolve({ entitled: false, introTrialEligible: true }),
  quote: Promise.resolve({ market: "us", priceLabel: null }),
  plan: "starter",
  interval: "month",
  timeoutMs: 50,
});
assert(confirmed.entitlementOutcome === "not_entitled", "a live unpaid result is not a failed check");
assert(confirmed.trialEnded === false, "a first subscription still gets the trial line only");
assert(confirmed.priceLabel === "$39/mo", "a null market quote is priced in USD");

const ended = await resolveBillingWall({
  client: Promise.resolve(null),
  entitlement: Promise.resolve({ entitled: false, introTrialEligible: false }),
  quote: Promise.resolve({ market: "za", priceLabel: "R299/mo" }),
  plan: "starter",
  interval: "month",
  timeoutMs: 50,
});
assert(ended.trialEnded === true, "a prior subscription is the ended-trial case");
assert(ended.priceLabel === "R299/mo", "ZA uses the quote label");
assert(ended.entitlementOutcome === "not_entitled", "an ended trial that resolved is not a retry");

const failed = await resolveBillingWall({
  client: Promise.resolve(null),
  entitlement: Promise.reject(new Error("stripe down")),
  quote: Promise.resolve({ market: "us", priceLabel: null }),
  plan: "starter",
  interval: "month",
  timeoutMs: 50,
});
assert(failed.entitlementOutcome === "failed", "a thrown entitlement check can retry");
assert(failed.trialEnded === false, "a failed check does not invent an ended trial");

console.log("billing-wall-copy: ok");
