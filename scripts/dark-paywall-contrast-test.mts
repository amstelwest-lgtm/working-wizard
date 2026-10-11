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
  block.includes("background-color: #0b1b2b !important"),
  "dark surface is the brand canvas",
);
assert(block.includes("--paywall-bg: #ffffff"), "light theme keeps a white card");
assert(block.includes("#f4f7fb !important"), "dark ink is pinned over Tailwind foreground");
assert(block.includes("#c5d4e4 !important"), "dark muted copy is pinned over Tailwind muted");
assert(block.includes("#ffffff !important"), "primary buttons keep white type");
assert(!block.includes("#d4af37"), "the paywall does not use wordmark gold");
assert(!block.includes("#1b1300"), "the paywall does not use brown button ink");
assert(
  block.includes('html[data-theme="light"] .accountant-portal .firm-band-upgrade'),
  "light settings picker stays navy ink",
);

const pairs: Array<[string, string, string]> = [
  ["#0b1b2b", "#f4f7fb", "dark title and prices"],
  ["#0b1b2b", "#c5d4e4", "dark limit lines"],
  ["#102a43", "#f4f7fb", "dark voucher field"],
  ["#102a43", "#c5d4e4", "dark voucher placeholder"],
  ["#ffffff", "#102a43", "light title and prices"],
  ["#ffffff", "#3d5270", "light limit lines"],
  ["#ffffff", "#0b5fff", "white on cobalt button"],
  ["#2563eb", "#ffffff", "white on royal hover"],
];
for (const [bg, fg, name] of pairs) {
  const ratio = contrast(bg, fg);
  assert(ratio >= 4.5, `${name} contrast ${ratio.toFixed(2)} is below WCAG AA`);
}

const borders: Array<[string, string, string]> = [
  ["#102a43", "#8cb4ff", "dark voucher border"],
  ["#ffffff", "#0b5fff", "light voucher border"],
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
assert(css.includes("border-color: #8cb4ff !important"), "dark paywall input border is #8cb4ff");
assert(css.includes("#0b5fff !important"), "light voucher border is cobalt");
const card = readFileSync(resolve("src/components/trial-ended-plan-block.tsx"), "utf8");
assert(card.includes("trial-ended-block"), "the trial card keeps its hook");
assert(
  card.includes("FirmBandUpgrade"),
  "settings and add-client share this picker via the trial card",
);

console.log("dark-paywall-contrast ok");
