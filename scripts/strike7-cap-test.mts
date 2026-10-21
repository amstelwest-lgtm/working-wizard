/**
 * Cap snapshot currency. My practice is a US firm row with 5 ZA clients
 * and 1 US client, so the list is rand. A US book stays USD. A logged-out
 * visitor never sees a rand price. Checkout follows the same helper:
 * My practice (US row, mostly ZA clients) uses the ZAR price when the
 * billing country is ZA, and USD when it is US. A US-only firm stays USD.
 *
 * Run: pnpm test:strike7-cap
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade";
import { practiceDisplaysZarPlan } from "../src/lib/firm-band-upgrade";
import { buildUpgradeSnapshot } from "../src/lib/firm-client-cap.server";
import { LIST_PRICES, visitorCopyPack } from "../src/lib/market/marketing";
import { priceMarketForFirm } from "../src/lib/pricing/za-checkout";
import { firmCheckoutCharge } from "../src/lib/stripe-checkout.core";
import { strike7MyPracticeRow } from "./strike7-firms";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function hasRandPrice(text: string): boolean {
  return /R\s?\d/.test(text) || /\bZAR\b/i.test(text);
}

function panel(snapshot: Awaited<ReturnType<typeof buildUpgradeSnapshot>>): string {
  return renderToStaticMarkup(
    createElement(FirmBandUpgrade, {
      currentBand: snapshot.band,
      interval: snapshot.interval,
      priceCurrency: snapshot.priceCurrency,
      zarByBand: snapshot.zarByBand,
      canUpgrade: true,
      clientCount: snapshot.clientCount,
      saDiscount: snapshot.saDiscount,
      zaLabels: snapshot.zaLabels,
      onUpgrade: () => undefined,
    }),
  );
}

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_RESTRICTED_KEY;

const practice = strike7MyPracticeRow();
const practiceSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: practice.market,
  clientMarkets: practice.clients.map((client) => client.market),
  clientCount: practice.clients.length,
  sub: null,
});
const practiceHtml = panel(practiceSnap);
assert(
  practiceDisplaysZarPlan({
    firmMarket: practice.market,
    clientMarkets: practice.clients.map((client) => client.market),
  }),
  "My practice shows rand: US firm row, 5 ZA clients, 1 US client",
);
assert(practiceSnap.saDiscount === true, "the cap snapshot marks My practice as a rand list");
assert(
  /R\s?299/.test(practiceSnap.zaLabels?.starter?.month ?? ""),
  `My practice Starter label should be rand, saw ${practiceSnap.zaLabels?.starter?.month}`,
);
assert(practiceHtml.includes("Starter"), "the cap panel names Starter");
assert(/R\s?299/.test(practiceHtml), `the cap panel should show R299, saw ${practiceHtml}`);
assert(!/Shown in rand/.test(practiceHtml), "the panel does not add a checkout sentence");
assert(practiceSnap.zaPriceLabel == null, "the checkout charge line stays empty when the firm row is US");

const practiceMarkets = practice.clients.map((client) => client.market);
const chargeZa = firmCheckoutCharge({
  firmMarket: practice.market,
  clientMarkets: practiceMarkets,
  requested: "za",
  billingCountry: "ZA",
  band: "starter",
  interval: "month",
});
assert(
  chargeZa.priceMarket === "za",
  "My practice Checkout uses the ZAR price when the billing country is ZA",
);
const chargeUs = firmCheckoutCharge({
  firmMarket: practice.market,
  clientMarkets: practiceMarkets,
  requested: "za",
  billingCountry: "US",
  band: "starter",
  interval: "month",
});
assert(
  chargeUs.priceMarket === "us",
  "My practice Checkout stays USD when the billing country is not ZA",
);
assert(
  priceMarketForFirm({ firmMarket: "za", billingCountry: "ZA" }) === "za",
  "a ZA firm with a ZA billing country still gets a rand Checkout price",
);
assert(
  priceMarketForFirm({ firmMarket: "za", billingCountry: "US" }) === "us",
  "a known non-ZA billing country still falls back to USD",
);
assert(
  priceMarketForFirm({ firmMarket: "us", billingCountry: "ZA" }) === "us",
  "a US firm row never takes a rand Checkout price",
);

const usMarkets = Array.from({ length: 4 }, () => ({ country: "US" as const, regionCode: "NY" as const }));
const usSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: { country: "US", region: "NY", regionCode: "NY" },
  clientMarkets: usMarkets,
  clientCount: usMarkets.length,
  sub: null,
});
const usHtml = panel(usSnap);
const usCharge = firmCheckoutCharge({
  firmMarket: { country: "US", regionCode: "NY" },
  clientMarkets: usMarkets,
  requested: "za",
  billingCountry: "ZA",
  band: "starter",
  interval: "month",
});
assert(usCharge.priceMarket === "us", "a US-only firm stays on the USD Checkout price");
assert(usSnap.saDiscount === false, "a US firm with US clients stays on USD");
assert(!hasRandPrice(usHtml), `a US-only cap panel must not show rand, saw ${usHtml}`);
assert(usHtml.includes("$39"), "a US-only cap panel shows the USD Starter price");

const visitor = {
  pack: visitorCopyPack(null),
  prices: LIST_PRICES[visitorCopyPack(null)],
};
const visitorText = JSON.stringify(visitor);
assert(visitor.pack === "us", "a logged-out visitor with no market is the US pack");
assert(!hasRandPrice(visitorText), `a logged-out visitor payload must not contain rand, saw ${visitorText}`);

const loggedOutSnap = await buildUpgradeSnapshot({
  isOwner: false,
  membershipRole: null,
  market: null,
  clientMarkets: null,
  clientCount: 0,
  sub: null,
});
const loggedOutHtml = panel(loggedOutSnap);
const loggedOutPrices = [
  loggedOutSnap.priceCurrency,
  loggedOutSnap.zaPriceLabel ?? "",
  JSON.stringify(loggedOutSnap.zaLabels ?? null),
].join(" ");
assert(!hasRandPrice(loggedOutPrices), `a logged-out snapshot must not price in rand, saw ${loggedOutPrices}`);
assert(!hasRandPrice(loggedOutHtml), `a logged-out panel must not show rand, saw ${loggedOutHtml}`);

console.log("strike7 cap ok");
