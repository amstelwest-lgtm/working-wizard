/**
 * Settings region form stays closed until the saved country loads.
 * Run: pnpm test:region-settings
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RegionSettingsLoading } from "../src/components/region-settings-loading";
import { regionFormFromSaved, regionSaveAllowed } from "../src/lib/region-settings";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const unloaded = regionFormFromSaved({
  loaded: false,
  saved: { country: "US", regionCode: "NY" },
});
assert(unloaded.status === "loading", "an unloaded region has no draft");
assert(
  !regionSaveAllowed({
    loaded: false,
    recordId: "firm-1",
    draft: { country: "US", regionCode: "NY" },
  }),
  "save cannot submit an unloaded United States default",
);

const missing = regionFormFromSaved({ loaded: true, saved: null });
assert(
  missing.status === "ready" && missing.draft.country === null && missing.draft.regionCode === null,
  "a missing saved region selects no country",
);
assert(
  missing.status === "ready" && missing.unset === true,
  "a missing saved region is marked unset",
);
assert(
  missing.status === "ready" && missing.draft.country !== "US" && missing.draft.country !== "ZA",
  "a missing saved region is not pre-selected",
);

const savedUs = regionFormFromSaved({
  loaded: true,
  saved: { country: "US", regionCode: "NY" },
});
assert(
  savedUs.status === "ready" && savedUs.draft.country === "US" && savedUs.draft.regionCode === "NY",
  "a saved United States region is kept after it loads",
);
assert(savedUs.status === "ready" && savedUs.unset === false, "a saved region is not marked unset");
assert(
  regionSaveAllowed({
    loaded: true,
    recordId: "firm-1",
    draft: savedUs.status === "ready" ? savedUs.draft : null,
  }),
  "save is allowed once the saved region has loaded",
);
assert(
  !regionSaveAllowed({ loaded: true, recordId: null, draft: { country: "ZA", regionCode: null } }),
  "save needs the record the region belongs to",
);

const loading = renderToStaticMarkup(createElement(RegionSettingsLoading));
assert(loading.includes("data-region-loading"), "the placeholder marks itself as loading");
assert(!loading.includes("United States"), "the placeholder does not name the United States");
assert(!loading.includes("New York"), "the placeholder does not name New York");
assert(!loading.includes("Required for sales tax"), "the placeholder does not ask for sales tax");
assert(!loading.includes("Save region"), "the placeholder has no save button");

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ||= "sb_publishable_region_settings_test";
process.env.VITE_SUPABASE_URL ||= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= process.env.SUPABASE_PUBLISHABLE_KEY;

const { MarketSettingsCard } = await import("../src/components/market-settings-card");
const card = renderToStaticMarkup(
  createElement(MarketSettingsCard, {
    kind: "firm",
    recordId: "firm-1",
    initial: { country: "US", regionCode: "NY" },
    loaded: false,
    zarPlan: false,
  }),
);
assert(card.includes("data-region-loading"), "an unloaded settings card stays on the placeholder");
assert(
  !card.includes("United States"),
  "an unloaded settings card does not render the United States",
);
assert(!card.includes("New York"), "an unloaded settings card does not render New York");
assert(
  !card.includes("Required for sales tax"),
  "an unloaded settings card does not render the sales-tax prompt",
);
assert(!card.includes("Save region"), "an unloaded settings card does not offer save");
assert(!card.includes(">US<"), "an unloaded settings card does not select a US option");

const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(
  settings.includes("loaded={regionReady}"),
  "settings withholds the region form until the saved row loads",
);
assert(settings.includes("firmTrialStatusLine"), "settings trial status uses the real trial end");
assert(!settings.includes('?? "Trial"'), "settings does not invent a trial headline");

const css = readFileSync(resolve("src/styles/settings-portal.css"), "utf8");
assert(
  /\.settings-portal\.accountant-portal \.topbar > \.brand\s*\{[^}]*display:\s*none/.test(css),
  "settings hides the duplicate header wordmark",
);
assert(
  css.includes(".settings-portal.accountant-portal:not(.owner-door) .deliverable-rail"),
  "settings pins its own sidebar",
);
assert(
  css.includes("position: sticky"),
  "the settings sidebar stays sticky while the page scrolls",
);
assert(
  css.includes("align-self: start"),
  "the settings sidebar does not stretch away with the page",
);

console.log("region-settings: ok");
