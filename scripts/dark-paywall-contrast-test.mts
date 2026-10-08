/**
 * Dark trial paywall must not be a white card with light-grey type.
 * Run: pnpm test:dark-paywall-contrast
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function lin(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(bg: string, fg: string) {
  const a = lum(bg);
  const b = lum(fg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(resolve("src/styles.css"), "utf8");
const start = css.indexOf("Trial-ended plan card");
const end = css.indexOf(".trial-ended-action");
assert(start > 0 && end > start, "the paywall card styles are present");
const block = css.slice(start, end);

assert(!block.includes("oklch(1 0 0)"), "the paywall no longer rebinds --card to white");
assert(
  block.includes('html:not([data-theme="light"]) .accountant-portal .trial-ended-block'),
  "portal dark (not only html.dark) paints the card",
);
assert(
  block.includes("background-color: #101018 !important"),
  "dark surface is an explicit near-black",
);
assert(block.includes("--paywall-bg: #fffdf8"), "light theme keeps a cream card");
assert(block.includes("#f7f1e4 !important"), "dark ink is pinned over Tailwind foreground");
assert(block.includes("#e4dccb !important"), "dark muted copy is pinned over Tailwind muted");
assert(block.includes("#1b1300 !important"), "gold CTAs keep near-black type");
assert(
  block.includes('html[data-theme="light"] .accountant-portal .firm-band-upgrade'),
  "light settings picker stays dark ink",
);

const pairs: Array<[string, string, string]> = [
  ["#101018", "#f7f1e4", "dark title and prices"],
  ["#101018", "#e4dccb", "dark limit lines"],
  ["#0a0a10", "#f7f1e4", "dark voucher field"],
  ["#0a0a10", "#a39c8c", "dark voucher placeholder"],
  ["#fffdf8", "#1b1608", "light title and prices"],
  ["#fffdf8", "#4a4030", "light limit lines"],
  ["#fffdf8", "#6b5f48", "light voucher placeholder"],
  ["#d4af37", "#1b1300", "gold CTA on mid gold"],
  ["#ac8400", "#1b1300", "gold CTA on deep gold"],
  ["#fdee79", "#1b1300", "gold CTA on bright gold"],
];
for (const [bg, fg, name] of pairs) {
  const ratio = contrast(bg, fg);
  assert(ratio >= 4.5, `${name} contrast ${ratio.toFixed(2)} is below WCAG AA`);
}

const borders: Array<[string, string, string]> = [
  ["#09090f", "#a08436", "dark voucher border"],
  ["#fffdf8", "#8a6508", "light voucher border"],
];
for (const [bg, fg, name] of borders) {
  const ratio = contrast(bg, fg);
  assert(ratio >= 3, `${name} contrast ${ratio.toFixed(2)} is below 3:1`);
}

const picker = readFileSync(resolve("src/components/firm-band-upgrade.tsx"), "utf8");
assert(
  picker.includes('className="firm-band-upgrade"'),
  "the shared picker is marked for portal ink",
);
assert(picker.includes('htmlFor="firm-voucher-code"'), "voucher field has a visible label");
assert(css.includes("border-color: #a08436 !important"), "dark paywall input border is #a08436");
assert(css.includes("#8a6508"), "light voucher border token is present");
const card = readFileSync(resolve("src/components/trial-ended-plan-block.tsx"), "utf8");
assert(card.includes("trial-ended-block"), "the trial card keeps its hook");
assert(
  card.includes("FirmBandUpgrade"),
  "settings and add-client share this picker via the trial card",
);

console.log("dark-paywall-contrast ok");
