/**
 * Quote API matrix across the rendered pricing callers.
 * Visitor country × firm market × saved-choice mismatch × client count.
 * Run: pnpm test:pricing-matrix
 *
 * List prices stay tight (`R299/mo`, `R799/mo · about R53 per client`).
 * Large bot amounts stay spaced (`R 187 444`). This file does not change either.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandPricingTable } from "../src/components/firm-band-pricing";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade";
import { checkoutPriceLabel, cardFreeTrialPriceFromQuote } from "../src/lib/billing-wall";
import { nextBandUp } from "../src/lib/firm-band-upgrade";
import { formatPromptMoney, ZA_PROMPT_MONEY_LINE } from "../src/lib/prompt-money";
import { ownerPaySentence, ownerPlanLine } from "../src/lib/owner-plan";
import { FAQ_OWNER_COST_US, publicFaqUsItems } from "../src/lib/public-faq";
import { signupQuotePack, quotePrice, resolveQuoteMarket } from "../src/lib/pricing/price-quote.server";
import { APPROVED_PRICES } from "../src/lib/pricing/price-table.server";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server";
import { perClientRands } from "../src/lib/pricing/za-ladder";
import { FIRM_BAND_CATALOG, FIRM_CHECKOUT_BANDS, type FirmCheckoutBand } from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const VISITORS = ["ZA", "US"] as const;
const FIRMS = ["ZA", "US", null] as const;
const COUNTS = [0, 1, 5, 6] as const;

const STARTER_CAP = FIRM_BAND_CATALOG.starter.clientLimit;
assert(STARTER_CAP === 5, "Starter covers up to 5 clients");

const zaCopy = loadSaPricingCopy();

function centsOf(amount: number): number {
  return Math.round(amount * 100);
}

const allowedZarCents = new Set<number>();
const allowedUsdCents = new Set<number>();
for (const row of APPROVED_PRICES) {
  const bucket = row.currency === "ZAR" ? allowedZarCents : allowedUsdCents;
  bucket.add(row.unitAmount);
  if (row.interval === "month" && row.clientLimit) {
    const major = row.unitAmount / 100;
    const per =
      row.currency === "ZAR" ? perClientRands(major, row.clientLimit) : Math.round(major / row.clientLimit);
    bucket.add(centsOf(per));
  }
  if (row.interval === "year" && row.plan !== "owner") {
    const month = APPROVED_PRICES.find(
      (other) => other.plan === row.plan && other.currency === row.currency && other.interval === "month",
    );
    assert(month != null, `${row.plan} ${row.currency} has a monthly price`);
    const ratio = row.unitAmount / (month.unitAmount * 12);
    assert(
      ratio > 0.75 && ratio < 0.85,
      `${row.plan} ${row.currency} annual is roughly 20% off, ratio ${ratio}`,
    );
  }
}

const ownerYearUsd = APPROVED_PRICES.find(
  (row) => row.plan === "owner" && row.currency === "USD" && row.interval === "year",
);
const ownerMonthUsd = APPROVED_PRICES.find(
  (row) => row.plan === "owner" && row.currency === "USD" && row.interval === "month",
);
assert(ownerYearUsd != null && ownerMonthUsd != null, "owner USD prices exist");
assert(
  ownerYearUsd.unitAmount === Math.round((ownerMonthUsd.unitAmount * 12 * 4) / 5),
  "owner annual stays on the existing 20% rule",
);

function moneyCents(text: string, symbol: "$" | "R"): number[] {
  const re = symbol === "$" ? /\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g : /R(\d+(?:\.\d{1,2})?)/g;
  const found: number[] = [];
  for (const match of text.matchAll(re)) {
    found.push(centsOf(Number(match[1].replace(/,/g, ""))));
  }
  return found;
}

function assertSaContext(text: string, where: string) {
  assert(!text.includes("$"), `${where} rendered '$' in an SA context`);
  assert(!/\bvat\b/i.test(text), `${where} mentions VAT`);
  assert(!/R \d/.test(text), `${where} used the spaced bot amount as a list price`);
  for (const cents of moneyCents(text, "R")) {
    assert(allowedZarCents.has(cents), `${where} rendered an unapproved rand amount (${cents} cents)`);
  }
}

function assertUsContext(text: string, where: string) {
  assert(!/R\s?\d/.test(text), `${where} rendered 'R' in a US context`);
  assert(!text.includes("ZAR"), `${where} rendered ZAR in a US context`);
  assert(!/\bvat\b/i.test(text), `${where} mentions VAT`);
  for (const cents of moneyCents(text, "$")) {
    assert(allowedUsdCents.has(cents), `${where} rendered an unapproved dollar amount (${cents} cents)`);
  }
}

function firmStored(firm: "ZA" | "US" | null, mismatch: boolean): unknown {
  if (firm == null) return mismatch ? { currency: "ZAR" } : null;
  if (!mismatch) return { country: firm };
  return { country: firm, currency: firm === "ZA" ? "USD" : "ZAR" };
}

function savedChoice(visitor: "ZA" | "US", mismatch: boolean): "ZA" | "US" {
  if (!mismatch) return visitor;
  return visitor === "ZA" ? "US" : "ZA";
}

function bandLabels(market: "za" | "us") {
  const labels = {} as Record<FirmCheckoutBand, { month: string; year: string }>;
  for (const band of FIRM_CHECKOUT_BANDS) {
    labels[band] = {
      month: quotePrice({ market, plan: band, interval: "month", surface: "visitor" })?.label ?? "",
      year: quotePrice({ market, plan: band, interval: "year", surface: "visitor" })?.label ?? "",
    };
  }
  return labels;
}

const zaLabels = bandLabels("za");

function checkedBand(html: string): string | null {
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  for (const input of inputs) {
    if (!/\bchecked(?:="[^"]*")?(?=[\s/>])/.test(input)) continue;
    const value = input.match(/\bvalue="([^"]+)"/);
    if (value) return value[1];
  }
  return null;
}

assert(signupQuotePack("ZA").starterMonthly === "R299/mo", "Starter signup list price stays R299/mo");
assert(
  zaCopy.labels.solo.month === "R799/mo · about R53 per client",
  `Solo list price stays the tight per-client line, saw ${zaCopy.labels.solo.month}`,
);
assert(
  zaCopy.labels.starter.month.startsWith("R299/mo"),
  `Starter public line stays on R299/mo, saw ${zaCopy.labels.starter.month}`,
);
assert(ZA_PROMPT_MONEY_LINE.includes("R 187 444"), "bot amounts stay in the spaced format");
assert(formatPromptMoney(187_444, { country: "ZA" }) === "R 187 444", "a large ZA bot amount stays spaced");
assert(formatPromptMoney(187_444, null) === "$187,444", "a large US bot amount stays in dollars");
assert(formatPromptMoney(187_444, { currency: "ZAR" }) === "$187,444", "a currency-only firm is not ZA");

let cells = 0;
for (const visitor of VISITORS) {
  for (const firm of FIRMS) {
    for (const mismatch of [false, true]) {
      for (const clientCount of COUNTS) {
        const saved = savedChoice(visitor, mismatch);
        const stored = firmStored(firm, mismatch);
        const where = `visitor ${visitor}, firm ${firm ?? "null"}, saved ${saved}, clients ${clientCount}`;

        const visitorMarket = resolveQuoteMarket({
          surface: "visitor",
          geoCountry: visitor,
          savedChoice: saved,
          choiceFromThisVisit: false,
        });
        const firmMarket = resolveQuoteMarket({
          surface: "firm",
          storedMarket: stored,
          geoCountry: visitor,
          savedChoice: saved,
          choiceFromThisVisit: true,
        });
        const ownerMarket = resolveQuoteMarket({
          surface: "owner",
          storedMarket: stored,
          geoCountry: visitor,
          savedChoice: saved,
          choiceFromThisVisit: true,
        });
        const checkoutMarket = resolveQuoteMarket({
          surface: "checkout",
          storedMarket: stored,
          billingCountry: null,
          geoCountry: visitor,
          savedChoice: saved,
          choiceFromThisVisit: true,
        });
        const wallMarket = resolveQuoteMarket({
          surface: "wall",
          storedMarket: stored,
          billingCountry: null,
          geoCountry: visitor,
          savedChoice: saved,
          choiceFromThisVisit: true,
        });

        assert(visitorMarket === (visitor === "ZA" ? "za" : "us"), `${where} visitor market`);
        assert(firmMarket === (firm === "ZA" ? "za" : "us"), `${where} firm market (null is not ZA)`);
        assert(checkoutMarket === firmMarket, `${where} checkout follows the firm, not the saved choice`);
        assert(wallMarket === firmMarket, `${where} wall follows the firm, not the saved choice`);
        if (firm == null) {
          assert(ownerMarket === visitorMarket, `${where} owner with no country falls through to geo`);
        } else {
          assert(ownerMarket === firmMarket, `${where} a stored firm country wins for the owner`);
        }
        if (mismatch) {
          const savedCurrency = saved === "ZA" ? "ZAR" : "USD";
          const visitorCurrency = visitorMarket === "za" ? "ZAR" : "USD";
          assert(savedCurrency !== visitorCurrency, `${where} saved choice really mismatches the visitor`);
          const starter = quotePrice({
            market: visitorMarket,
            plan: "starter",
            interval: "month",
            surface: "visitor",
          });
          assert(starter?.currency === visitorCurrency, `${where} quote ignores the mismatched saved currency`);
        }

        const signup = signupQuotePack(visitor);
        const ownerQuote = quotePrice({
          market: ownerMarket,
          plan: "owner",
          interval: "month",
          surface: "owner",
        });
        const ownerLine = ownerPlanLine({
          visitor: ownerMarket,
          accountantOnMilon: false,
          firmName: null,
          zaMonthly: ownerMarket === "za" ? ownerQuote?.label : null,
        });
        const terms = ownerPaySentence(ownerMarket, ownerMarket === "za" ? ownerQuote?.label : null);
        const marketing = renderToStaticMarkup(
          createElement(FirmBandPricingTable, {
            interval: "month",
            showSaPricing: visitorMarket === "za",
            saLabels: visitorMarket === "za" ? zaLabels : null,
            trialAfter: visitorMarket === "za" ? zaCopy.trialAfter : null,
            marketHint: visitorMarket === "za" ? "ZA" : "US",
            onIntervalChange: () => undefined,
          }),
        );
        const visitorText =
          visitorMarket === "za"
            ? [signup.starterMonthly, signup.ownerPayLine, signup.trialReminder, marketing, zaCopy.faqCostLead, zaCopy.ownerPlanAnswer, JSON.stringify(zaCopy.labels)].join("\n")
            : [signup.starterMonthly, signup.ownerPayLine, signup.trialReminder, marketing, FAQ_OWNER_COST_US, publicFaqUsItems().map((item) => item.answer).join("\n")].join("\n");
        const ownerText = [ownerLine, terms].join("\n");

        if (visitorMarket === "za") {
          assertSaContext(visitorText, `${where} visitor`);
          assert(visitorText.includes("R299/mo"), `${where} visitor shows Starter R299/mo`);
          assert(visitorText.includes("R799/mo · about R53 per client"), `${where} visitor shows the Solo ladder line`);
          assert(visitorText.includes("market=ZA"), `${where} CTA keeps the resolved ZA hint`);
          assert(!visitorText.includes("market=US"), `${where} a stale US choice is not the CTA hint`);
        } else {
          assertUsContext(visitorText, `${where} visitor`);
          assert(visitorText.includes("$39"), `${where} visitor shows Starter $39`);
          assert(visitorText.includes("market=US"), `${where} CTA keeps the resolved US hint`);
          assert(!visitorText.includes("market=ZA"), `${where} a stale ZA choice is not the CTA hint`);
        }
        if (ownerMarket === "za") assertSaContext(ownerText, `${where} owner`);
        else assertUsContext(ownerText, `${where} owner`);

        const firmQuote = quotePrice({
          market: firmMarket,
          plan: "starter",
          interval: "month",
          surface: "wall",
        });
        const wallPrice = cardFreeTrialPriceFromQuote({
          market: firmMarket,
          priceLabel: firmQuote?.label ?? null,
        });
        const checkoutPrice = checkoutPriceLabel("starter", "month", {
          market: firmMarket,
          priceLabel: firmQuote?.label ?? null,
        });
        const upgrade = renderToStaticMarkup(
          createElement(FirmBandUpgrade, {
            currentBand: null,
            interval: "month",
            priceCurrency: firmMarket === "za" ? "zar" : "USD",
            zaLabels: firmMarket === "za" ? zaLabels : null,
            zarPlan: firmMarket === "za",
            canUpgrade: true,
            clientCount,
            usageLabel: `${clientCount} active clients`,
            onUpgrade: () => undefined,
          }),
        );
        const soloCheckout = checkoutPriceLabel("solo", "month", {
          market: firmMarket,
          priceLabel: quotePrice({ market: firmMarket, plan: "solo", interval: "month", surface: "checkout" })?.label ?? null,
        });
        const firmText = [wallPrice, checkoutPrice, soloCheckout, upgrade].join("\n");
        const bot = formatPromptMoney(187_444, stored);
        if (firmMarket === "za") {
          assertSaContext(firmText, `${where} firm`);
          assert(firmText.includes("R299/mo"), `${where} firm shows Starter R299/mo`);
          assert(firmText.includes("R799/mo · about R53 per client"), `${where} firm shows the Solo ladder line`);
          assert(bot === "R 187 444", `${where} bot amount stays spaced`);
          assert(!firmText.includes(bot), `${where} list prices do not pick up the spaced bot amount`);
        } else {
          assertUsContext(firmText, `${where} firm`);
          assert(firmText.includes("$39"), `${where} firm shows Starter $39`);
          assert(bot === "$187,444", `${where} bot amount stays in dollars when the firm is not ZA`);
          assert(!bot.includes("ZAR"), `${where} bot amount does not say ZAR`);
        }

        const checked = checkedBand(upgrade);
        const recommended = nextBandUp(null, clientCount);
        if (clientCount === 6) {
          assert(recommended === "solo", `${where} 6 clients moves past Starter`);
          assert(checked === "solo", `${where} rendered upgrade selects Solo`);
          assert(!upgrade.includes('value="starter"'), `${where} Starter is not a choice for 6 clients`);
        } else {
          assert((STARTER_CAP ?? 0) >= clientCount, `${where} Starter still covers ${clientCount} clients`);
          if (clientCount < 5) {
            assert(recommended === "starter", `${where} ${clientCount} clients stay on Starter`);
            assert(checked === "starter", `${where} rendered upgrade stays on Starter`);
          } else {
            assert(upgrade.includes('value="starter"'), `${where} Starter stays selectable at its 5-client cap`);
          }
        }
        assert(!/\bvat\b/i.test(upgrade), `${where} upgrade mentions VAT`);
        cells += 1;
      }
    }
  }
}

assert(cells === VISITORS.length * FIRMS.length * 2 * COUNTS.length, `matrix ran ${cells} cells`);
console.log(`pricing-matrix: ok (${cells} cells)`);
