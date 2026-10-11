/**
 * Palette contrast. Ice must never be a text token.
 * Run: pnpm test:palette-contrast
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PALETTE } from "../src/lib/palette";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function channel(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function linear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const [r, g, b] = channel(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

const pairs: Array<[string, string, string]> = [
  ["cobalt on white", PALETTE.cobalt, PALETTE.white],
  ["white on cobalt", PALETTE.white, PALETTE.cobalt],
  ["navy on white", PALETTE.navy, PALETTE.white],
  ["healthy on white", PALETTE.healthy, PALETTE.white],
  ["critical on white", PALETTE.critical, PALETTE.white],
  ["healthy ink on white", PALETTE.healthyInk, PALETTE.white],
  ["attention ink on white", PALETTE.attentionInk, PALETTE.white],
  ["critical ink on white", PALETTE.criticalInk, PALETTE.white],
  ["healthy ink on pale", PALETTE.healthyInk, PALETTE.pale],
  ["attention ink on pale", PALETTE.attentionInk, PALETTE.pale],
  ["critical ink on pale", PALETTE.criticalInk, PALETTE.pale],
  ["ink on dark", PALETTE.inkDark, PALETTE.canvasDark],
  ["secondary ink on dark", PALETTE.inkDimDark, PALETTE.canvasDark],
  ["white on dark surface", PALETTE.white, PALETTE.surfaceDark],
  ["pale on dark", PALETTE.pale, PALETTE.canvasDark],
];
for (const [name, fg, bg] of pairs) {
  const ratio = contrast(fg, bg);
  assert(ratio >= 4.5, `${name} is ${ratio.toFixed(2)}`);
}

const attentionOnWhite = contrast(PALETTE.attention, PALETTE.white);
const attentionOnPale = contrast(PALETTE.attention, PALETTE.pale);
const healthyOnPale = contrast(PALETTE.healthy, PALETTE.pale);
const criticalOnPale = contrast(PALETTE.critical, PALETTE.pale);
assert(attentionOnWhite < 4.5, "attention swatch stays the spec colour, which is below AA as small text");
assert(attentionOnPale < 4.5, "attention swatch on pale stays below AA");
assert(healthyOnPale < 4.5, "healthy swatch on pale stays below AA");
assert(criticalOnPale < 4.5, "critical swatch on pale stays below AA");

const files = [
  "src/styles.css",
  "src/styles/accountant-portal.css",
  "src/styles/landing.css",
];
const css = files.map((file) => readFileSync(resolve(file), "utf8")).join("\n");
for (const hex of [PALETTE.cobalt, PALETTE.royal, PALETTE.navy, PALETTE.pale, PALETTE.healthy, PALETTE.attention, PALETTE.critical]) {
  assert(css.toLowerCase().includes(hex.toLowerCase()), `${hex} is in the theme CSS`);
}
assert(css.toLowerCase().includes(PALETTE.ice.toLowerCase()), "ice is available for charts and focus");
assert(!/--[\w-]*(ink|text|foreground)[\w-]*:\s*#38bdf8/i.test(css), "ice is not a text token");
assert(!/color:\s*(var\(--ice\)|#38bdf8)/i.test(css), "ice is not used as a text color");

console.log("palette-contrast tests passed");
console.log(
  `exception: spec attention ${PALETTE.attention} is ${attentionOnWhite.toFixed(2)} on white and ${attentionOnPale.toFixed(2)} on pale; text uses ${PALETTE.attentionInk}`,
);
