/**
 * Capture Brand v1.1 proof shots from the local seeded preview.
 * Expects the rail harness on 127.0.0.1:4179.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const outDir = "/tmp/landing-proof";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 1400 },
  deviceScaleFactor: 2,
});
await page.addInitScript(() => {
  localStorage.setItem("theme_pref_v2", "light");
});
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
await page.goto("http://127.0.0.1:4179/proof-landing", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Request changes/i }).waitFor({ timeout: 15000 });
await page.waitForTimeout(300);

for (const id of ["shot-ratios", "shot-signoff", "shot-plan"]) {
  const box = page.locator(`#${id}`);
  const text = await box.innerText();
  console.log(`\n===== ${id} =====\n${text}`);
  await box.screenshot({ path: `${outDir}/${id}.png` });
}

await browser.close();
console.log("wrote", outDir);
