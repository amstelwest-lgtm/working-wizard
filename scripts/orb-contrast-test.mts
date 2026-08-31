/**
 * Light-mode sub-orbs share the gold fill so labels stay readable.
 * Run: pnpm test:orb-contrast
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const hero = readFileSync(resolve("src/components/sphere-hero.tsx"), "utf8");
assert(hero.includes("sphere-orb"), "every Sphere is marked sphere-orb");
assert(hero.includes('className="health-orb"'), "main score orb keeps health-orb for the tour");

const css = readFileSync(resolve("src/styles.css"), "utf8");
assert(css.includes("html:not(.dark) .sphere-orb"), "light mode styles pillar orbs");
assert(css.includes("html:not(.dark) .health-orb"), "light mode still styles the main orb");
assert(
  css.includes(".sphere-orb .text-slate-200"),
  "light mode recolors orb labels so they are not near-black on a dark fill",
);

console.log("orb-contrast-test: ok");
