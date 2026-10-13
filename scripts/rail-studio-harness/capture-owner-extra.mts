/**
 * One-off checks for the owner premium pass: the 390 nav drawer open state
 * and a dark-mode sanity shot of the health + cash tabs.
 * Usage: pnpm vite-node --config scripts/vite-test.config.ts scripts/rail-studio-harness/capture-owner-extra.mts <label>
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const label = process.argv[2] ?? "extra";
const outDir = `/opt/cursor/artifacts/screenshots/${label}`;
mkdirSync(outDir, { recursive: true });

const base = "http://127.0.0.1:4179/owner-door";

const browser = await chromium.launch({ channel: "chrome" });

// Drawer open at 390
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(`${base}?view=rest`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const burger = page.locator("header button").first();
  await burger.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/drawer-390.png` });
  // Esc closes
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const open = await page.evaluate(() => document.querySelector(".accountant-portal")?.classList.contains("nav-open") ?? false);
  console.log("drawer esc closes:", !open);
  await page.close();
}

// Dark mode health + cash at 1280
for (const view of ["health", "cash"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    document.documentElement.classList.add("dark");
  });
  await page.goto(`${base}?view=${view}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${view}-dark-1280.png`, fullPage: true });
  await page.close();
}

await browser.close();
console.log("wrote", outDir);
