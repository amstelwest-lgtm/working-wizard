/**
 * Capture the landing hero at 1280 and 390 for PR before/after shots.
 * Usage: pnpm vite-node --config scripts/vite-test.config.ts scripts/capture-hero.mts <label>
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const label = process.argv[2] ?? "shot";
const outDir = process.env.HERO_SHOT_DIR ?? "/opt/cursor/artifacts/screenshots";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const [name, viewport] of [
  ["1280", { width: 1280, height: 860 }],
  ["390", { width: 390, height: 844 }],
] as const) {
  const page = await browser.newPage({ viewport: { ...viewport }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    localStorage.setItem("theme_pref_v2", "light");
  });
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  await page.goto("http://127.0.0.1:5000/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/hero-${label}-${name}.png` });
  const hero = page.locator("#hero");
  await hero.screenshot({ path: `${outDir}/hero-${label}-${name}-full.png` });
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  console.log(name, JSON.stringify(widths));
  await page.close();
}

await browser.close();
console.log("wrote", outDir);
