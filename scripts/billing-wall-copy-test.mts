/**
 * Billing wall copy: one price, one trial line, no Owner plan, Retry only
 * after a failed check, and Back to the client list.
 * Run: pnpm test:billing-wall-copy
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BillingRequiredCard } from "../src/routes/billing.required.tsx";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade.tsx";
import { FirmStarterTrialBanner } from "../src/components/firm-starter-trial-banner.tsx";
import { buildUpgradeSnapshot } from "../src/lib/firm-client-cap.server.ts";
import { noPlanTrialClock } from "../src/lib/firm-starter-trial.ts";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server.ts";
import { cardFreeTrialLine } from "../src/lib/starter-trial-constants.ts";
import {
  FIRM_WALL_TRIAL_ENDED_LINE,
  FIRM_WALL_TRIAL_LINE,
  cardFreeTrialPrice,
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

const FIRST_CLIENT_LINE =
  "Your first client is free to explore. Add a card to start your 14-day free trial · up to 5 clients.";
const FEW_CLIENTS_LINE = "Add a card to start your 14-day free trial · up to 5 clients.";
const AT_FIVE_LINE =
  "You've reached the 5 clients included in the free trial. Add a card to start your 14-day free trial.";

function overLimitLine(count: number): string {
  return `This practice has ${count} clients. The free trial covers up to 5. Add a card to start your trial; more than 5 clients needs Solo.`;
}

function card(props: {
  priceLabel: string | null;
  onRetry?: () => void;
  trialEnded?: boolean;
  backHref?: string;
  clientCount?: number | null;
}) {
  return renderToStaticMarkup(
    createElement(BillingRequiredCard, {
      planName: "Starter",
      priceLabel: props.priceLabel,
      clientName: "New York Test company",
      clientCount: props.clientCount,
      checkout,
      onRetry: props.onRetry,
      trialEnded: props.trialEnded,
      backHref: props.backHref,
    }),
  );
}

for (const count of [0, 1]) {
  assert(
    cardFreeTrialLine(count) === FIRST_CLIENT_LINE,
    `${count} clients keeps the first-client line`,
  );
}
for (const count of [2, 3, 4]) {
  assert(cardFreeTrialLine(count) === FEW_CLIENTS_LINE, `${count} clients uses the 2–4 line`);
  assert(
    !cardFreeTrialLine(count).toLowerCase().includes("first client"),
    `${count} clients does not say first client`,
  );
}
assert(cardFreeTrialLine(5) === AT_FIVE_LINE, "5 clients names the trial cap");
assert(
  !cardFreeTrialLine(5).toLowerCase().includes("first client"),
  "5 clients does not say first client",
);
for (const count of [6, 8]) {
  assert(
    cardFreeTrialLine(count) === overLimitLine(count),
    `${count} clients names the real count`,
  );
  assert(
    !cardFreeTrialLine(count).toLowerCase().includes("first client"),
    `${count} clients does not say first client`,
  );
  assert(
    !cardFreeTrialLine(count).toLowerCase().includes("vat"),
    `${count} clients has no VAT wording`,
  );
}
for (const unknown of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
  assert(
    cardFreeTrialLine(unknown) === FEW_CLIENTS_LINE,
    `unknown count ${String(unknown)} uses the 2–4 line`,
  );
  assert(
    !cardFreeTrialLine(unknown).toLowerCase().includes("first client"),
    `unknown count ${String(unknown)} does not use the first-client line`,
  );
}

for (const variant of [
  { market: "us", price: "$39/mo" },
  { market: "za", price: "R299/mo" },
] as const) {
  const html = card({ priceLabel: variant.price, clientCount: 1 });
  assert(count(html, variant.price) === 1, `${variant.market} price renders once`);
  assert(count(html, FIRM_WALL_TRIAL_LINE) === 1, `${variant.market} trial line renders once`);
  assert(
    FIRM_WALL_TRIAL_LINE ===
      "Your first client is free to explore. Add a card to start your 14-day free trial · up to 5 clients.",
    `${variant.market} wall uses the card-free sentence`,
  );
  assert(
    !html.includes("14-day free trial · up to 5 clients on Starter"),
    `${variant.market} wall does not use the old Starter line`,
  );
  assert(!html.includes("Owner plan"), `${variant.market} wall does not pitch the Owner plan`);
  assert(!html.includes("VAT"), `${variant.market} wall has no VAT wording`);
  assert(!html.includes("Retry"), `${variant.market} confirmed unpaid wall hides Retry`);
  assert(html.includes('href="/clients"'), `${variant.market} Back target is /clients`);
  assert(html.includes("Back to clients"), `${variant.market} Back label is the client list`);
  assert(!html.includes("Back to pricing"), `${variant.market} wall has no pricing link`);
  assert(html.includes("Start trial"), `${variant.market} primary action is Start trial`);
  assert(
    html.includes("bg-[#0B5FFF]") && html.includes("text-white"),
    `${variant.market} Start trial is solid cobalt`,
  );
  assert(
    html.includes("border-[#0B5FFF]") && html.includes("text-[#0B5FFF]"),
    `${variant.market} Back is a cobalt outline`,
  );
  assert(
    html.includes("bg-white") &&
      html.includes("text-[#102A43]") &&
      html.includes("border-[#DBEAFE]"),
    `${variant.market} canvas is the light shell`,
  );
  assert(
    !html.includes("amber") && !html.includes("#0b1220"),
    `${variant.market} wall has no gold or near-black canvas`,
  );
  assert(
    html.includes(firmWallWhyLine("New York Test company")),
    `${variant.market} explains the open client`,
  );
  assert(
    firmWallWhyLine("New York Test company") ===
      "This firm has no plan yet. Your first client and its numbers stay open. Reports and a later client need Starter.",
    `${variant.market} names the open file, not the client`,
  );
  assert(
    !firmWallWhyLine("New York Test company").includes("New York Test company"),
    `${variant.market} does not put the client name in the why line`,
  );
  assert(
    !html.includes(FIRM_WALL_TRIAL_ENDED_LINE),
    `${variant.market} does not mention an ended trial by default`,
  );
}

const retryHtml = card({ priceLabel: "$39/mo", clientCount: 1, onRetry: () => undefined });
assert(retryHtml.includes("Retry"), "Retry is present when the check failed");

const unknownHtml = card({ priceLabel: "$39/mo" });
assert(unknownHtml.includes(FEW_CLIENTS_LINE), "an unknown count uses the 2–4 line");
assert(
  !unknownHtml.includes(FIRST_CLIENT_LINE),
  "an unknown count does not use the first-client sentence",
);

const threeHtml = card({ priceLabel: "$39/mo", clientCount: 3 });
assert(threeHtml.includes(FEW_CLIENTS_LINE), "a 3-client wall uses the 2–4 line");
assert(
  !threeHtml.toLowerCase().includes("first client"),
  "a 3-client wall does not say first client",
);
assert(
  !firmWallWhyLine("New York Test company", 3).toLowerCase().includes("first client"),
  "the why line drops first client once the firm has more than one client",
);

const fiveHtml = card({ priceLabel: "$39/mo", clientCount: 5 });
assert(
  fiveHtml.includes("reached the 5 clients included in the free trial") &&
    fiveHtml.includes("Add a card to start your 14-day free trial."),
  "a 5-client wall names the trial cap",
);
assert(
  !fiveHtml.toLowerCase().includes("first client"),
  "a 5-client wall does not say first client",
);
assert(count(fiveHtml, "Start trial") === 1, "a 5-client wall has one Start trial");
assert(!fiveHtml.toLowerCase().includes("vat"), "a 5-client wall has no VAT wording");

const sixHtml = card({ priceLabel: "$39/mo", clientCount: 6 });
assert(
  !sixHtml.toLowerCase().includes("first client"),
  "a 6-client wall does not say first client",
);
assert(sixHtml.includes(overLimitLine(6)), "a 6-client wall names 6 clients");
assert(count(sixHtml, "Start trial") === 1, "a 6-client wall has one Start trial");
assert(!sixHtml.toLowerCase().includes("vat"), "a 6-client wall has no VAT wording");

const addClientCard = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: null,
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 6,
    cardFree: true,
    onUpgrade: () => undefined,
  }),
);
assert(addClientCard.includes(overLimitLine(6)), "the Add client card names 6 clients");
assert(
  !addClientCard.toLowerCase().includes("first client"),
  "the Add client card for 6 clients does not say first client",
);
assert(!addClientCard.toLowerCase().includes("vat"), "the Add client card has no VAT wording");

const endedHtml = card({ priceLabel: "$39/mo", clientCount: 1, trialEnded: true });
assert(count(endedHtml, FIRM_WALL_TRIAL_ENDED_LINE) === 1, "an ended trial is said once");
assert(
  count(endedHtml, FIRM_WALL_TRIAL_LINE) === 1,
  "the trial line is not replaced by the ended case",
);

assert(!firmWallOffersRetry("not_entitled"), "a successful not-entitled check hides Retry");
assert(!firmWallOffersRetry("entitled"), "an entitled check hides Retry");
assert(firmWallOffersRetry("failed"), "a failed check shows Retry");

assert(firmWallBackTarget({}) === "/clients", "no referrer goes to the client list");
assert(
  firmWallBackTarget({
    referrer: "https://example.com/clients/later",
    pageOrigin: "http://localhost:5000",
  }) === "/clients",
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
assert(
  confirmed.entitlementOutcome === "not_entitled",
  "a live unpaid result is not a failed check",
);
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

function marked(html: string, attr: string): string {
  const at = html.indexOf(`data-${attr}=""`);
  if (at < 0) return "";
  const start = html.indexOf(">", at);
  const end = html.indexOf("<", start + 1);
  return start < 0 || end < 0 ? "" : html.slice(start + 1, end);
}

const cardFreeTrial = noPlanTrialClock({
  enforced: true,
  noPlan: true,
  startedAt: "2026-10-18T12:00:00.000Z",
  now: new Date("2026-10-19T12:00:00.000Z"),
});
const zaCopy = loadSaPricingCopy();
const zaMarket = { country: "ZA" as const, region: "GP", regionCode: "GP" as const };
const zaClients = [
  { country: "ZA" as const, regionCode: "GP" as const },
  { country: "ZA" as const, regionCode: "GP" as const },
];
const zaSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: zaMarket,
  clientMarkets: zaClients,
  clientCount: 2,
  sub: null,
});
const soloSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: zaMarket,
  clientMarkets: zaClients,
  clientCount: 2,
  sub: {
    phase: "active",
    band: "solo",
    interval: "month",
    currency: "zar",
    unitAmount: 79_900,
  } as NonNullable<Parameters<typeof buildUpgradeSnapshot>[0]["sub"]>,
});
assert(
  zaSnap.zaPriceLabel === zaCopy.labels.starter.month,
  `a card-free ZA firm is priced as Starter, saw ${zaSnap.zaPriceLabel}`,
);
assert(
  soloSnap.zaPriceLabel === zaCopy.labels.solo.month,
  `a Solo subscription keeps the Solo line, saw ${soloSnap.zaPriceLabel}`,
);

const usMarket = { country: "US" as const, region: "NY", regionCode: "NY" as const };
const usClients = [
  { country: "US" as const, regionCode: "NY" as const },
  { country: "US" as const, regionCode: "NY" as const },
];
const usSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: usMarket,
  clientMarkets: usClients,
  clientCount: 2,
  sub: null,
});
assert(usSnap.zaPriceLabel == null, "a US firm does not carry a rand charge line");

for (const variant of [
  {
    market: "za" as const,
    upgrade: zaSnap,
    wallPrice: cardFreeTrialPrice({ market: "za", zaPriceLabel: zaCopy.labels.starter.month }),
  },
  {
    market: "us" as const,
    upgrade: usSnap,
    wallPrice: cardFreeTrialPrice({ market: "us", zaPriceLabel: null }),
  },
]) {
  const home = renderToStaticMarkup(
    createElement(FirmStarterTrialBanner, {
      trial: cardFreeTrial,
      upgrade: variant.upgrade,
      firmId: "firm",
    }),
  );
  const wall = card({ priceLabel: variant.wallPrice, clientCount: 2 });
  const homePrice = marked(home, "trial-price");
  assert(
    Boolean(variant.wallPrice) &&
      homePrice === variant.wallPrice &&
      wall.includes(variant.wallPrice),
    `${variant.market} home price ${homePrice} matches the wall ${variant.wallPrice}`,
  );
  assert(!home.includes("799"), `${variant.market} home does not price Solo`);
  assert(
    !home.toLowerCase().includes("first client"),
    `${variant.market} home does not say first client`,
  );
  assert(!home.toLowerCase().includes("vat"), `${variant.market} home has no VAT wording`);
  assert(
    variant.market === "us" ? homePrice === "$39/mo" : homePrice.includes("R 299"),
    `${variant.market} home uses Starter`,
  );
}

console.log("billing-wall-copy: ok");
