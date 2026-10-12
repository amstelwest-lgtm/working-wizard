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

const accountantFiles = [
  "src/styles/accountant-portal.css",
  "src/styles/settings-portal.css",
  "src/styles/responsive-table.css",
  "src/components/milon-team/milon-team-desk.css",
  "src/routes/_authenticated/settings.team.tsx",
  "src/routes/_authenticated/reports-studio.tsx",
  "src/routes/_authenticated/clients.$clientId.tsx",
  "src/routes/_authenticated/dashboard.tsx",
  "src/routes/_authenticated/practice.tsx",
  "src/components/practice-board.tsx",
  "src/routes/_authenticated/clients.index.tsx",
  "src/routes/billing.required.tsx",
  "src/components/advisory-pack-panel.tsx",
  "src/components/portfolio-exceptions.tsx",
  "src/components/industry-pulse.tsx",
  "src/components/product-mix-panel.tsx",
  "src/components/sphere-hero.tsx",
  "src/components/cash-forecast.tsx",
  "src/components/cash-thirteen-week.tsx",
  "src/components/recommendations-panel.tsx",
  "src/components/playbook-drawer.tsx",
  "src/components/action-plan.tsx",
  "src/components/profitability-waterfall.tsx",
  "src/components/accountant-inbox.tsx",
  "src/components/staff-invite-landing.tsx",
  "src/components/ui/view-toggle.tsx",
  "src/components/kpi-trendline.tsx",
  "src/components/primitives/collapsible-gold-card.tsx",
  "src/components/budget/budget-panel.tsx",
  "src/components/budget/budget-simple-view.tsx",
  "src/components/budget/budget-workspace.tsx",
  "src/components/budget/budget-funnel.tsx",
  "src/components/budget/budget-verdict.tsx",
  "src/components/budget/budget-advanced.tsx",
  "src/components/budget/budget-pdf-export.tsx",
  "src/components/budget/budget-variance-panel.tsx",
  "src/components/budget/budget-year-overview-chart.tsx",
  "src/components/budget/budget-chart-table.tsx",
  "src/components/budget/budget-year-strip.tsx",
];
const banned = [
  "#d4a550",
  "#d4af37",
  "#ac8400",
  "#fdee79",
  "#c9962b",
  "#b8860b",
  "#b7872a",
  "#fffdf8",
  "#fffdf6",
  "#101018",
  "#1b1300",
  "#1b1608",
];
for (const file of accountantFiles) {
  const source = readFileSync(resolve(file), "utf8");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    if (file.endsWith("accountant-portal.css")) {
      if (/--gold/.test(line) || line.includes(".gold-text")) return;
    }
    const hit = banned.find((hex) => line.toLowerCase().includes(hex));
    assert(!hit, `${file}:${index + 1} still uses ${hit}`);
  });
}

const accountantPairs: Array<[string, string, string]> = [
  ["navy on white", PALETTE.navy, PALETTE.white],
  ["navy on pale", PALETTE.navy, PALETTE.pale],
  ["cobalt on white", PALETTE.cobalt, PALETTE.white],
  ["white on cobalt", PALETTE.white, PALETTE.cobalt],
  ["white on royal", PALETTE.white, PALETTE.royal],
  ["ink on dark canvas", PALETTE.inkDark, PALETTE.canvasDark],
  ["ink on dark surface", PALETTE.inkDark, PALETTE.surfaceDark],
  ["healthy ink on pale", PALETTE.healthyInk, PALETTE.pale],
  ["attention ink on pale", PALETTE.attentionInk, PALETTE.pale],
  ["critical ink on pale", PALETTE.criticalInk, PALETTE.pale],
  ["healthy ink on dark", "#7DDEBA", PALETTE.canvasDark],
  ["attention ink on dark", "#F0D59A", PALETTE.canvasDark],
  ["critical ink on dark", "#FFB4BC", PALETTE.canvasDark],
  ["healthy ink on dark surface", "#7DDEBA", PALETTE.surfaceDark],
  ["attention ink on dark surface", "#F0D59A", PALETTE.surfaceDark],
  ["critical ink on dark surface", "#FFB4BC", PALETTE.surfaceDark],
];
for (const [name, fg, bg] of accountantPairs) {
  const ratio = contrast(fg, bg);
  assert(ratio >= 4.5, `accountant ${name} is ${ratio.toFixed(2)}`);
}
const portalCss = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
assert(portalCss.includes("--accent-text:#102a43"), "light accent text is navy");
assert(portalCss.includes("--accent-text:#f4f7fb"), "dark accent text is ink");
assert(portalCss.includes(".gold-text{background:var(--gold-grad)"), "wordmark stays gold");
assert(!/color:\s*var\(--gold\)/.test(portalCss), "portal text does not use the gold token");

console.log("palette-contrast tests passed");
console.log(
  `exception: spec attention ${PALETTE.attention} is ${attentionOnWhite.toFixed(2)} on white and ${attentionOnPale.toFixed(2)} on pale; text uses ${PALETTE.attentionInk}`,
);
