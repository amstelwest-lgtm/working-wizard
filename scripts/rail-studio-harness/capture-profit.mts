/**
 * Owner Profit tab screenshots for PR before/after proof.
 * Expects the harness on 127.0.0.1:4179.
 * Usage: pnpm vite-node --config scripts/vite-test.config.ts scripts/rail-studio-harness/capture-profit.mts <label>
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const label = process.argv[2] ?? "shot";
const base = "http://127.0.0.1:4179/owner-door?view=profit";
const outDir = process.env.PROFIT_SHOT_DIR ?? "/opt/cursor/artifacts/screenshots";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const size of [
  { suffix: "1280", width: 1280, height: 960 },
  { suffix: "390", width: 390, height: 1400 },
]) {
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-owner-ready='true']");
  // Harness-only chrome (note pins, share) stays out of the proof shots.
  await page.addStyleTag({
    content: ".notes-fab, #wizard-notes-pin, .notes-tray, [data-note] { display: none !important; }",
  });
  await page.waitForTimeout(900);

  await page.screenshot({ path: `${outDir}/profit-${label}-amount-${size.suffix}.png` });
  console.log(`${outDir}/profit-${label}-amount-${size.suffix}.png`);

  const pctButton = page.getByRole("button", { name: "Percentage" });
  if (await pctButton.count()) {
    await pctButton.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/profit-${label}-percentage-${size.suffix}.png` });
    console.log(`${outDir}/profit-${label}-percentage-${size.suffix}.png`);
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  console.log(size.suffix, JSON.stringify(overflow));
  await page.close();
}

await browser.close();
console.log("done", outDir);
