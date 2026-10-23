/**
 * Shots of the Tax Specialist panel and the drafted tax pack, 1280 and 375.
 * Expects the Vite harness on 127.0.0.1:4179. Fixture data only.
 * Usage: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/rail-studio-harness/capture-tax-pack.mts
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.HARNESS_BASE ?? "http://127.0.0.1:4179";
const outDir = process.env.TAX_PACK_OUT ?? "/opt/cursor/artifacts/screenshots";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

const widths = [
  { suffix: "1280", width: 1280, height: 1000 },
  { suffix: "375", width: 375, height: 900 },
];

for (const { suffix, width, height } of widths) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => {
    localStorage.setItem("theme_pref_v2", "light");
  });

  await page.goto(`${base}/tax-pack?view=profile`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-tax-pack-panel]").waitFor({ timeout: 12_000 });
  await page.waitForTimeout(600);
  const profileFile = `${outDir}/tax-pack-client-profile-${suffix}.png`;
  await page.screenshot({ path: profileFile, fullPage: true });
  console.log(profileFile);

  await page.goto(`${base}/tax-pack?view=draft`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-tax-pack-panel]").waitFor({ timeout: 12_000 });
  const expand = page.getByRole("button", { name: "Show the full pack" });
  if (await expand.count()) await expand.first().click();
  await page.waitForTimeout(400);
  const draftFile = `${outDir}/tax-pack-draft-${suffix}.png`;
  await page.screenshot({ path: draftFile, fullPage: true });
  console.log(draftFile);

  await page.close();
}

await browser.close();
