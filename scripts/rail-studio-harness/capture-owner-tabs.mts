/**
 * Full-page screenshots of every owner tab at 1280 and 390 for PR before/after
 * proof. Expects the harness on 127.0.0.1:4179.
 * Usage: pnpm vite-node --config scripts/vite-test.config.ts scripts/rail-studio-harness/capture-owner-tabs.mts <label>
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const label = process.argv[2] ?? "shot";
const base = "http://127.0.0.1:4179/owner-door";
const outDir = process.env.OWNER_SHOT_DIR ?? `/opt/cursor/artifacts/screenshots/${label}`;

const shots: { name: string; view: string; query?: string }[] = [
  { name: "home", view: "rest" },
  { name: "health", view: "health" },
  { name: "cash", view: "cash" },
  { name: "profit", view: "profit" },
  { name: "budget", view: "budget" },
  { name: "moves", view: "moves" },
  { name: "accountant", view: "accountant" },
  { name: "settings", view: "settings", query: "&bill=none" },
  { name: "plan", view: "plan", query: "&bill=none" },
];

const widths = [
  { suffix: "1280", width: 1280, height: 900 },
  { suffix: "390", width: 390, height: 844 },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

let overflowFailures = 0;
for (const size of widths) {
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  for (const shot of shots) {
    await page.goto(`${base}?view=${shot.view}${shot.query ?? ""}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-owner-ready='true']");
    await page.waitForTimeout(900);
    const file = `${outDir}/${shot.name}-${size.suffix}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const widthsInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const overflow = widthsInfo.scrollWidth > widthsInfo.innerWidth;
    if (overflow) overflowFailures += 1;
    console.log(
      `${shot.name}-${size.suffix}`,
      JSON.stringify(widthsInfo),
      overflow ? "OVERFLOW" : "ok",
    );
  }
  await page.close();
}

await browser.close();
console.log("wrote", outDir);
if (overflowFailures > 0) console.log(`horizontal overflow on ${overflowFailures} shots`);
