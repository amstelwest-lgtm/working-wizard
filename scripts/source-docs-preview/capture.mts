/**
 * Local screenshots of the documents UI. No Vercel deploy.
 * Expects the preview on 127.0.0.1:4187.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4187/";
const outDir = "/opt/cursor/artifacts/screenshots";
const copyDir = "/workspace/artifacts/screenshots";

const shots = [
  { name: "source-docs-owner", view: "owner" },
  { name: "source-docs-accountant", view: "accountant" },
];

const widths = [
  { suffix: "1280", width: 1280, height: 900 },
  { suffix: "390", width: 390, height: 844 },
];

await mkdir(outDir, { recursive: true });
await mkdir(copyDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const size of widths) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  for (const shot of shots) {
    await page.goto(`${base}?view=${shot.view}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-source-docs-ready='true']");
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    if (overflow > 1) throw new Error(`${shot.name} ${size.suffix} overflows by ${overflow}px`);
    const file = `${outDir}/${shot.name}-${size.suffix}.png`;
    await page.screenshot({ path: file, fullPage: true });
    await page.screenshot({ path: `${copyDir}/${shot.name}-${size.suffix}.png`, fullPage: true });
    console.log(file);
  }
  await page.close();
}

await browser.close();
