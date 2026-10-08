/**
 * Screenshots for the statement-import lows and the reload bar.
 * Expects the harness on 127.0.0.1:4179. Does not call Supabase.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const outDir = "/opt/cursor/artifacts/screenshots";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await mkdir(outDir, { recursive: true });
await page.goto("http://127.0.0.1:4179/import-lows", { waitUntil: "networkidle" });
await page.waitForSelector("[data-import-lows-ready='true']");
await page.waitForSelector("[data-sonner-toast]");

const shots: Array<[string, string]> = [
  ["cash-opening-label", "[data-shot='opening']"],
  ["import-toast", "[data-sonner-toast]"],
  ["reload-bar", "[data-stale-bundle='bar']"],
];
const written: string[] = [];
for (const [name, selector] of shots) {
  const path = `${outDir}/${name}.png`;
  await page.locator(selector).screenshot({ path });
  written.push(path);
}
await page.screenshot({ path: `${outDir}/import-lows-1280.png` });
written.push(`${outDir}/import-lows-1280.png`);
await browser.close();
console.log(written.join("\n"));
