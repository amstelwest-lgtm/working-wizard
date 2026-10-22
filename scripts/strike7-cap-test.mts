/**
 * Cap snapshot currency. My practice is a US firm row with 5 ZA clients
 * and 1 US client, so the list is rand. A US book stays USD. A logged-out
 * visitor never sees a rand price. Checkout charges ZAR for that client
 * mix only when the billing country is known to be ZA. Unknown or US stays
 * USD. A ZA
 * firm row with an unknown billing country stays on ZAR. A US-only firm
 * is USD on the panel and on Checkout.
 *
 * Run: pnpm test:strike7-cap
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade";
import { practiceDisplaysZarPlan } from "../src/lib/firm-band-upgrade";
import { buildUpgradeSnapshot } from "../src/lib/firm-client-cap.server";
import { LIST_PRICES, visitorCopyPack } from "../src/lib/market/marketing";
import { resolveCheckoutPriceMarket } from "../src/lib/pricing/market-resolution";
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
assert(practiceSnap.zaLabels != null, "the cap snapshot marks My practice as a rand list");
assert(
  /R\s?299/.test(practiceSnap.zaLabels?.starter?.month ?? ""),
  `My practice Starter label should be rand, saw ${practiceSnap.zaLabels?.starter?.month}`,
);
assert(practiceHtml.includes("Starter"), "the cap panel names Starter");
assert(/R\s?299/.test(practiceHtml), `the cap panel should show R299, saw ${practiceHtml}`);
assert(!/Shown in rand/.test(practiceHtml), "the panel does not add a checkout sentence");
assert(
  practiceSnap.zaPriceLabel == null,
  "a client-mix firm with an unknown billing country leaves the charge line empty",
);

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
  chargeZa.priceMarket === "za",
  "a client-mix firm with billing country ZA charges ZAR",
);
assert(
  chargeUs.priceMarket === "us",
  "a client-mix firm with billing country US charges USD",
);
const chargeUnknown = firmCheckoutCharge({
  firmMarket: practice.market,
  clientMarkets: practiceMarkets,
  requested: "za",
  billingCountry: null,
  band: "starter",
  interval: "month",
});
assert(
  chargeUnknown.priceMarket === "us",
  "a client-mix firm with an unknown billing country charges USD and skips the ZA coupon",
);
const mixZaSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: practice.market,
  clientMarkets: practiceMarkets,
  clientCount: practice.clients.length,
  sub: null,
  billingCountry: "ZA",
});
assert(
  /R\s?\d/.test(mixZaSnap.zaPriceLabel ?? ""),
  `a client-mix firm with billing country ZA shows a rand charge line, saw ${mixZaSnap.zaPriceLabel}`,
);
const mixUsSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: practice.market,
  clientMarkets: practiceMarkets,
  clientCount: practice.clients.length,
  sub: null,
  billingCountry: "US",
});
assert(
  mixUsSnap.zaPriceLabel == null,
  "a client-mix firm with billing country US leaves the charge line empty",
);
assert(
  resolveCheckoutPriceMarket({ storedFirmMarket: { country: "ZA" }, billingCountry: "ZA" }) === "za",
  "a ZA firm with a ZA billing country still gets a rand Checkout price",
);
assert(
  resolveCheckoutPriceMarket({ storedFirmMarket: { country: "ZA" }, billingCountry: "US" }) === "us",
  "a known non-ZA billing country still falls back to USD",
);
assert(
  resolveCheckoutPriceMarket({ storedFirmMarket: { country: "US" }, billingCountry: "ZA" }) === "us",
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
assert(usSnap.zaLabels == null, "a US firm with US clients stays on USD");
assert(!hasRandPrice(usHtml), `a US-only cap panel must not show rand, saw ${usHtml}`);
assert(usHtml.includes("$39"), "a US-only cap panel shows the USD Starter price");

const zaMarkets = Array.from({ length: 3 }, () => ({ country: "ZA" as const, regionCode: "GP" as const }));
const zaSnap = await buildUpgradeSnapshot({
  isOwner: true,
  membershipRole: "owner",
  market: { country: "ZA", region: "GP", regionCode: "GP" },
  clientMarkets: zaMarkets,
  clientCount: zaMarkets.length,
  sub: null,
});
const zaHtml = panel(zaSnap);
const zaFirmCharge = firmCheckoutCharge({
  firmMarket: { country: "ZA", regionCode: "GP" },
  clientMarkets: zaMarkets,
  requested: "us",
  billingCountry: "ZA",
  band: "starter",
  interval: "month",
});
assert(zaSnap.zaLabels != null, "a ZA firm row is a rand list on the cap snapshot");
assert(/R\s?299/.test(zaHtml), `a ZA firm cap panel should show R299, saw ${zaHtml}`);
assert(zaFirmCharge.priceMarket === "za", "a ZA firm Checkout with billing country ZA uses the ZAR price");
const zaUnknownCharge = firmCheckoutCharge({
  firmMarket: { country: "ZA", regionCode: "GP" },
  clientMarkets: zaMarkets,
  requested: "us",
  billingCountry: null,
  band: "starter",
  interval: "month",
});
assert(
  zaUnknownCharge.priceMarket === "za",
  "a ZA-row firm with an unknown billing country charges ZAR",
);
assert(
  /R\s?\d/.test(zaSnap.zaPriceLabel ?? ""),
  `a ZA-row firm charge line is rand when the billing country is unknown, saw ${zaSnap.zaPriceLabel}`,
);
assert(
  !hasRandPrice(usHtml) && usCharge.priceMarket === "us",
  "a US firm is USD on the panel and on Checkout",
);

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
