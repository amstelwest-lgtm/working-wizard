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
import { isSaMarketFirm } from "../src/lib/firm-sa-market.ts";
import { effectiveFirmMarket, marketForFirm } from "../src/lib/market/scope.ts";
import { regionFormFromSaved } from "../src/lib/region-settings.ts";

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
assert(
  isSaMarketFirm({ market: null }) === false,
  "the ZA coupon still requires a stored ZA market",
);

const unset = regionFormFromSaved({ loaded: true, saved: null });
assert(
  unset.status === "ready" && unset.unset && unset.draft.country === "ZA",
  "settings marks a null market as the ZA default",
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

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(
  board.includes("marketForFirm({ market: firmMarket }).country"),
  "practice country uses the firm resolver",
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
assert(!owner.includes("MarketGate"), "a null client market does not open the country gate");
assert(
  owner.includes("coerceMarketSelection(data?.market ?? null)"),
  "a null client market is coerced to the effective market",
);

const gate = readFileSync(resolve("src/routes/_authenticated.gate.tsx"), "utf8");
assert(
  gate.includes("marketForFirm({ market: snap.firmMarket })"),
  "a firm row resumes billing from the effective market",
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
  card.includes("Not set, defaulting to South Africa"),
  "settings says the market was not set",
);
assert(card.includes('data-region-default="ZA"'), "settings marks the default as South Africa");
assert(
  (card.match(/aria-pressed="true"/g) ?? []).length === 1,
  "South Africa is the selected region",
);
assert(card.includes("South Africa"), "the selected country is South Africa");

console.log("null-market-firm: ok");
