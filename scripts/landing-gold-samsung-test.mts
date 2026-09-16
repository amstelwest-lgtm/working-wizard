/**
 * Landing gold must survive Samsung Internet "Dark websites" force-dark.
 * Pale gradient-clipped transparent text is remapped to muddy brown; solid
 * #d4af37 plus color-scheme: only dark is the durable paint.
 * Run: pnpm test:landing-gold
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const css = readFileSync(resolve("src/styles/landing.css"), "utf8");
const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");

assert(css.includes("color-scheme:only dark"), "landing opts dark theme out of UA force-dark");
assert(css.includes("color-scheme:only light"), "landing light theme also uses the only keyword");
assert(css.includes("-webkit-text-fill-color:var(--gold)"), "gold copy pins a real fill, not only clip");
assert(css.includes("background-color:var(--gold)"), "gold CTA has a solid #d4af37 fill");
assert(
  css.includes(".nav-burger span") && css.includes("background-color:var(--gold)"),
  "hamburger bars use solid brand gold",
);

const goldTextIdx = css.indexOf("html[data-landing=\"1\"] .gold-text{");
const hoverShimmerIdx = css.indexOf("@media (hover:hover) and (pointer:fine)");
assert(goldTextIdx !== -1, ".gold-text rule exists");
assert(hoverShimmerIdx !== -1 && hoverShimmerIdx > goldTextIdx, "shimmer clip is a fine-pointer enhancement");
const goldBase = css.slice(goldTextIdx, hoverShimmerIdx);
assert(goldBase.includes("color:var(--gold)"), ".gold-text default paint is brand gold");
assert(goldBase.includes("-webkit-text-fill-color:var(--gold)"), ".gold-text default fill is brand gold");
assert(!goldBase.includes("color:transparent"), ".gold-text default is not transparent clipped text");

assert(
  !goldBase.includes("background-clip:text"),
  "default .gold-text does not use a clipped gradient",
);
assert(
  css.includes("-webkit-background-clip:text"),
  "desktop shimmer still uses background-clip where it works",
);

assert(root.includes("color-scheme:only dark"), "FOUC CSS opts the dark landing out of force-dark");
assert(root.includes('d.style.colorScheme="only dark"'), "root boot script sets only dark");
assert(root.includes("milon-color-scheme"), "root boot script publishes a color-scheme meta");

assert(landing.includes('colorScheme = "only dark"') || landing.includes('"only dark"'), "landing theme applies only dark");
assert(landing.includes("syncLandingColorScheme"), "theme toggle keeps the color-scheme meta in sync");
assert(landing.includes("milon-color-scheme") && landing.includes(".remove()"), "leaving / clears the landing meta");

const firmBandsIdx = css.indexOf(".firm-bands-table{");
assert(firmBandsIdx !== -1, "firm band table is styled");
const firmBands = css.slice(firmBandsIdx, css.indexOf(".price-grid{", firmBandsIdx));
assert(firmBands.includes("background-color:var(--bg-2)"), "firm band cells sit on a solid --bg-2 surface");
assert(firmBands.includes("-webkit-text-fill-color:var(--ink)"), "firm band body text pins cream fill, not a clipped gold");
assert(firmBands.includes("-webkit-text-fill-color:#1b1300"), "firm band gold CTAs pin near-black fill");
assert(!firmBands.includes("color:transparent"), "firm band copy is never transparent clipped text");
assert(css.includes(".acc-pricing{") && css.includes("background-color:var(--bg-2)"), "pricing panel has a solid surface under the glass");

const mk = readFileSync(resolve("src/styles/marketing.css"), "utf8");
assert(mk.includes(".firm-bands-table"), "public collateral pages style the firm band table");
assert(mk.includes("-webkit-text-fill-color: var(--ink)") || mk.includes("-webkit-text-fill-color:var(--ink)"), "marketing table pins readable fill");
assert(mk.includes("background-color: var(--bg-2)") || mk.includes("background-color:var(--bg-2)"), "marketing table wrap/cells have a solid surface");

console.log("landing-gold-samsung-test: ok");
