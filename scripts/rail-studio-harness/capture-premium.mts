/**
 * Local screenshots of the premium light-mode pass. No production server, no
 * Vercel. Expects the built harness on 127.0.0.1:4179 (vite build + preview).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";

const shots: { name: string; path: string; ready: string }[] = [
  { name: "premium-owner-home", path: "/owner-door?view=rest", ready: "[data-owner-ready='true']" },
  {
    name: "premium-owner-cash",
    path: "/owner-door?view=cash&signoff=signed",
    ready: "[data-owner-ready='true']",
  },
  {
    name: "premium-owner-signoff",
    path: "/owner-door?view=accountant",
    ready: "[data-owner-ready='true']",
  },
  { name: "premium-acct-home", path: "/clients/harness-client", ready: ".deliverable-main" },
  {
    name: "premium-acct-cash",
    path: "/clients/harness-client?tab=cash&aged=1",
    ready: ".deliverable-main",
  },
  {
    name: "premium-acct-signoff",
    path: "/clients/harness-client?tab=reports&packView=ready",
    ready: ".deliverable-main",
  },
];

const widths = [
  { suffix: "1280", width: 1280, height: 900 },
  { suffix: "390", width: 390, height: 844 },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const size of widths) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  for (const shot of shots) {
    await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
    await page.waitForSelector(shot.ready);
    await page.waitForTimeout(1500);
    const file = `${outDir}/${shot.name}-${size.suffix}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await page.close();
}

await browser.close();
