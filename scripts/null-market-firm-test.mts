/**
 * A firm or client with no market is South Africa, and a hung book read
 * resolves to an error instead of "Loading…".
 * Run: pnpm test:null-market-firm
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripePlanMarketFromFirm } from "../src/lib/billing-market.ts";
import { openQueriesPhase, practiceClientsPhase, settleWithin } from "../src/lib/bounded-load.ts";
import { resolveFirmMarket } from "../src/lib/pricing/market-resolution.ts";
import { parseMarketSelection } from "../src/lib/market/parse.ts";
import { effectiveFirmMarket, marketForFirm } from "../src/lib/market/scope.ts";
import { regionFormFromSaved } from "../src/lib/region-settings.ts";
import { taxSampleCardVisible, taxSampleEnabled } from "../src/lib/tax-specialist/enabled.ts";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const missing = effectiveFirmMarket({ market: null });
assert(missing.country === "ZA", "null firms.market is South Africa");
assert(missing.currency === "ZAR", "null firms.market uses rand");
assert(missing.locale === "en-ZA", "null firms.market uses en-ZA");
assert(missing.timezone === "Africa/Johannesburg", "null firms.market uses Johannesburg");
assert(marketForFirm(null).currency === "ZAR", "a missing firm row uses rand");
assert(
  marketForFirm({ market: undefined }).locale === "en-ZA",
  "an unreadable firm market uses en-ZA",
);
assert(
  effectiveFirmMarket({ market: { country: "nope" } }).country === "ZA",
  "an unreadable country falls back to South Africa",
);

const za = effectiveFirmMarket({ market: { country: "ZA", regionCode: null } });
assert(za.country === "ZA" && za.currency === "ZAR" && za.locale === "en-ZA", "ZA stays ZA");

const us = effectiveFirmMarket({ market: { country: "US", regionCode: "NY" } });
assert(us.country === "US", "a saved US firm stays US");
assert(us.regionCode === "NY", "a saved US state is kept");
assert(us.currency === "USD" && us.locale === "en-US", "a saved US firm uses dollars and en-US");
assert(
  marketForFirm({ market: { country: "US", regionCode: "NY" } }).country === "US",
  "marketForFirm matches the canonical resolver",
);

assert(stripePlanMarketFromFirm(null) === "us", "checkout still treats a missing blob as not ZA");
assert(resolveFirmMarket(null) === "us", "a missing firm market is not ZA");

const unset = regionFormFromSaved({ loaded: true, saved: null });
assert(
  unset.status === "ready" && unset.unset && unset.draft.country === null,
  "settings does not pre-select a country for a null market",
);

const hungClients = await settleWithin(new Promise<unknown>(() => {}), 20);
assert(hungClients.status === "timeout", "a hung client read resolves as a timeout");
assert(
  practiceClientsPhase({ loading: true, timedOut: true, rowCount: 0 }) === "error",
  "a null-market client list shows an error instead of loading forever",
);

const hungQueries = await settleWithin(new Promise<unknown[]>(() => {}), 20);
assert(hungQueries.status === "timeout", "a hung open-queries read resolves as a timeout");
assert(
  openQueriesPhase({ bookLoading: true, rowsReady: false, timedOut: true, rowCount: 0 }) ===
    "error",
  "open queries shows an error while the book flag is still true",
);
assert(
  openQueriesPhase({ bookLoading: false, rowsReady: true, timedOut: false, rowCount: 0 }) ===
    "empty",
  "a settled empty notes list is empty, not an error",
);

const storedCountry = parseMarketSelection(null)?.country ?? null;
assert(storedCountry === null, "a null firm market has no stored country");
assert(
  taxSampleEnabled(storedCountry) === false,
  "a null-market firm does not enable the tax sample",
);
assert(
  taxSampleCardVisible(storedCountry, false) === false,
  "a null-market firm does not show the ZA tax card",
);
assert(
  taxSampleEnabled(marketForFirm({ market: null }).country) === true,
  "the presentation fallback is ZA, so it must not be passed to the tax card",
);

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(
  board.includes("marketCountry={parseMarketSelection(firmMarket)?.country ?? null}"),
  "the tax card uses the stored firm country",
);
assert(
  !board.includes("marketForFirm({ market: firmMarket }).country"),
  "the tax card does not use the ZA presentation fallback",
);
assert(
  board.includes("dataAsOfLabel(new Date(), marketForFirm({ market: firmMarket }))"),
  "dates still use the presentation fallback",
);
assert(board.includes("settleWithin("), "the client book bounds the select");
assert(board.includes("CLIENTS_LOAD_ERROR"), "the clients list has an error state");
assert(board.includes("OPEN_QUERIES_LOAD_ERROR"), "open queries has an error state");
const queriesEffect = board.slice(
  board.indexOf('const clientIdKey = clientRows.map((c) => c.id).join("\\n");'),
  board.indexOf("const portfolioRows"),
);
assert(
  queriesEffect.indexOf("window.setTimeout") < queriesEffect.indexOf("if (loading)"),
  "the queries deadline does not wait for the client list",
);

const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(owner.includes("setMarketNeedsGate(true)"), "a null client market opens the country gate");
assert(
  owner.includes("setWorkspaceMarket(null)"),
  "a null client market does not become a ZA selection",
);
const gateReturn = owner.indexOf("if (marketNeedsGate && effectiveClientId)");
const afterGate = owner.indexOf("const showOwnerDoor", gateReturn);
const bookAt = owner.indexOf("<OwnerDoor");
assert(
  gateReturn > 0 && afterGate > gateReturn && bookAt > afterGate,
  "the country gate returns before the book",
);
const gateBlock = owner.slice(gateReturn, afterGate);
assert(gateBlock.includes("<MarketGate"), "a null client market renders MarketGate");
assert(!gateBlock.includes("OwnerDoor"), "the gate does not render the owner book");
assert(!gateBlock.includes("currencySymbol"), "the gate does not render a currency symbol");
assert(!gateBlock.includes("See a sample"), "the gate does not render the tax sample");
assert(
  owner.includes("marketCountry={parseMarketSelection(workspaceMarket)?.country ?? null}"),
  "OwnerDoor gets the stored country, not the coerced market",
);

const clientPage = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(
  clientPage.includes(
    "const clientGateCountry = parseMarketSelection(client?.market)?.country ?? null",
  ),
  "the accountant client page gates on the stored country",
);
assert(
  clientPage.includes("marketForClient({ market: client?.market })"),
  "accountant client dates use the presentation fallback",
);
assert(
  clientPage.includes("marketCountry={clientGateCountry}"),
  "the accountant tax card does not use the coerced country",
);
assert(
  !clientPage.includes("marketCountry={clientMarket.country}"),
  "the accountant tax card does not read the date market country",
);
const clientGateAt = clientPage.indexOf("if (client.market === null)");
const clientProviderAt = clientPage.indexOf("<MarketProvider");
assert(
  clientGateAt > 0 && clientProviderAt > clientGateAt,
  "a null client market returns the country gate before the book",
);

const gate = readFileSync(resolve("src/routes/_authenticated.gate.tsx"), "utf8");
assert(
  !gate.includes("marketForFirm("),
  "billing does not treat a null firm market as South Africa",
);
assert(
  gate.includes("firmBillingResumeIntent(snap.firmMarket, peekPendingCheckout())"),
  "billing uses the stored firm market",
);
assert(gate.includes("firmBillingResumeIntent(null, null)"), "no firm row does not assume ZA");

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ||= "sb_publishable_null_market_test";
process.env.VITE_SUPABASE_URL ||= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= process.env.SUPABASE_PUBLISHABLE_KEY;

const { MarketSettingsCard } = await import("../src/components/market-settings-card.tsx");
const card = renderToStaticMarkup(
  createElement(MarketSettingsCard, {
    kind: "firm",
    recordId: "firm-1",
    initial: null,
    loaded: true,
    zarPlan: false,
  }),
);
assert(
  card.includes(
    "Region not set — choose South Africa or United States. Until then, dates use South African format and prices follow your location.",
  ),
  "settings asks for a region and explains dates and prices",
);
assert(card.includes("data-region-unset"), "settings marks the region as unset");
assert(!card.includes("data-region-default"), "settings does not mark a default country");
assert(!card.includes("Not set, defaulting to South Africa"), "settings does not say it defaulted");
assert((card.match(/aria-pressed="true"/g) ?? []).length === 0, "neither country is selected");

const { MarketGate } = await import("../src/components/market-gate.tsx");
const gateHtml = renderToStaticMarkup(
  createElement(MarketGate, {
    onSave: async () => undefined,
  }),
);
assert(
  gateHtml.includes("Where does this business operate?"),
  "the gate asks where the business operates",
);
assert(!gateHtml.includes("See a sample"), "the gate does not render the tax sample");
assert(
  !gateHtml.includes("ITR14") && !gateHtml.includes("IRP6"),
  "the gate does not render the worksheet",
);
assert(!/\bR[\u00a0 ]\d/.test(gateHtml), "the gate does not render a rand amount");

const { OwnerHome } = await import("../src/components/owner-door/owner-home.tsx");
const { ownerPresence } = await import("../src/lib/owner-presence.ts");
const { emptyAgentActivity } = await import("../src/lib/milon-team-activity.ts");
const home = renderToStaticMarkup(
  createElement(OwnerHome, {
    variant: "character",
    audience: "accountant",
    marketCountry: storedCountry,
    sampleClient: false,
    showInvite: false,
    title: "Your whole finance team",
    presence: ownerPresence(emptyAgentActivity()),
    lines: { financial_manager: [], analyst: [], advisor: [] },
    onOpen: () => undefined,
    onAsk: () => undefined,
  }),
);
assert(!home.includes("See a sample"), "a null-market firm does not offer the rand sample");
assert(
  !home.includes("ITR14") && !home.includes("IRP6"),
  "a null-market firm does not render the worksheet",
);
assert(!/\bR[\u00a0 ]\d/.test(home), "a null-market firm home has no rand amounts");
assert(!home.includes("SARS"), "a null-market firm home has no SARS copy");

console.log("null-market-firm: ok");
