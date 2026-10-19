/**
 * Health score drill cues — only where a deeper level exists.
 * Run: pnpm test:health-drill-cue
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const hero = readFileSync(resolve("src/components/sphere-hero.tsx"), "utf8");
const cue = readFileSync(resolve("src/components/health-drill-cue.tsx"), "utf8");
const css = readFileSync(resolve("src/styles.css"), "utf8");
const ratios = readFileSync(resolve("src/components/simplified-ratios.tsx"), "utf8");
const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const briefing = readFileSync(resolve("src/components/owner-ratio-briefing.tsx"), "utf8");
const drawer = readFileSync(resolve("src/components/playbook-drawer.tsx"), "utf8");

assert(hero.includes("DigCue"), "the health orb tree renders the dig cue");
assert(hero.includes("DigLeaf"), "a ratio with nowhere further to go shows the leaf note");
assert(hero.includes("go(3, p.id)"), "pillar tiles and cards still open that pillar's drivers");
assert(
  hero.includes("onClick={() => (onOrbOpen ? onOrbOpen() : go(level === 1 ? 2 : 1))}"),
  "the health orb stays a button",
);
assert(hero.includes("open money briefing"), "driver rows are labelled as the briefing");
assert(hero.includes("drillTo"), "an outside pillar card can open the same drivers");
assert(hero.includes("level === 1 ? ("), "the overall cue is only on the overview ring");
assert(
  hero.includes("pillar-ring-") && hero.includes("<DigCue id={`pillar-ring-${p.id}`} compact />"),
  "ring pillar cards, below the top score, carry the see-more cue",
);
assert(
  !hero.includes("<DigCue id={`driver-${d.key}`} compact />"),
  "the bottom driver level has no see-more hint",
);
assert(hero.includes("<DigLeaf />"), "a ratio with no briefing is the bottom line");

assert(cue.includes('HEALTH_DRILL_CUE = "See more"'), "the shared cue is See more");
assert(!cue.includes(">Click<") && !cue.includes("dig-cue__verb"), "the cue does not say Click");
assert(hero.includes("HEALTH_RING_CAPTION = HEALTH_DRILL_CUE"), "the ring uses that same cue");
assert(!hero.includes("what's behind your score"), "the ring does not keep a longer line");
assert(cue.includes("This is the bottom line"), "the leaf says this is the bottom line");
assert(cue.includes("usePrefersReducedMotion"), "the one-time shimmer respects reduced motion");
assert(cue.includes("pulsedCueIds"), "the shimmer runs once per cue");

assert(!css.includes(".dig-cue__verb--click"), "Click and Tap are not swapped");
assert(!css.includes("pointer: coarse"), "the cue does not change words for touch");
assert(css.includes("prefers-reduced-motion: reduce"), "reduced motion drops the shimmer");
assert(css.includes("cursor: pointer"), "drill controls keep a pointer");
assert(css.includes(".dig-cue--control:focus-visible"), "the cue button has a focus ring");
assert(css.includes("max-width: 100%"), "the cue cannot force a horizontal overflow");
assert(!/color:\s*(var\(--ice\)|#38bdf8)/i.test(css), "ice is not the cue text colour");

assert(ratios.includes("onOpenPillar"), "accountant pillar cards can open their drivers");
assert(ratios.includes("DigCue"), "those cards carry the same cue");
assert(ratios.includes("aria-label"), "pillar cards name the dig for assistive tech");
assert(
  !ratios.includes("<button") || ratios.indexOf("onOpenPillar") < ratios.indexOf("pillar-evidence"),
  "the evidence link stays outside the pillar button",
);

assert(
  studio.includes("drillTo={healthDrill}"),
  "the accountant health score accepts a pillar drill",
);
assert(studio.includes('variant="ring"'), "the accountant score uses the same health ring");
assert(studio.includes("HEALTH_RING_CAPTION"), "the accountant ring uses the shared caption");
assert(owner.includes('variant="ring"'), "the owner score uses the same health ring");
assert(owner.includes("HEALTH_RING_CAPTION"), "the owner ring uses the shared caption");
assert(studio.includes("premium-shell"), "the accountant client shell uses the premium frame");
assert(studio.includes("onOpenPillar"), "accountant pillar cards drill into the score");
assert(studio.includes("onDriverClick"), "accountant ratios still open the playbook");

assert(briefing.includes("DigLeaf"), "the owner money briefing is the bottom of the drill");
assert(drawer.includes("DigLeaf"), "the accountant playbook is the bottom of the drill");

console.log("health-drill-cue-test: ok");
