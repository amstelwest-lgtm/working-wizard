/**
 * Screenshot the local rail harness. Expects the Vite server on 127.0.0.1:4179.
 * Does not start the production app and does not call Supabase.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4179";
const client = "/clients/harness-client";
const outDir = "/opt/cursor/artifacts/screenshots";

const shots: { name: string; path: string; palette?: boolean }[] = [
  { name: "rail-bot", path: `${client}?tab=ask` },
  { name: "rail-overview", path: `${client}?tab=overview` },
  { name: "rail-cash", path: `${client}?tab=overview&section=cash` },
  { name: "rail-pack", path: `${client}?tab=deliverables&section=pack` },
  { name: "rail-plan", path: `${client}?tab=deliverables&section=plan` },
  { name: "rail-cmdk", path: `${client}?tab=overview`, palette: true },
];

const widths = [
  { suffix: "1280", width: 1280, height: 900 },
  { suffix: "390", width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];

await mkdir(outDir, { recursive: true });

for (const size of widths) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  const blocked: string[] = [];
  page.on("request", (request) => {
    if (/supabase\.(co|in|com)/i.test(request.url())) blocked.push(request.url());
  });
  for (const shot of shots) {
    await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-rail-ready='true']");
    await page.waitForSelector("nav[aria-label='Client workspace']");
    if (shot.palette) {
      await page.getByRole("button", { name: /Search features/i }).click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(300);
    }
    const file = `${outDir}/${shot.name}-${size.suffix}.png`;
    await page.screenshot({ path: file });
    written.push(file);
  }
  await page.close();
}

const measure = await browser.newPage({ viewport: { width: 360, height: 800 } });
const scroll: Record<string, { scrollWidth: number; innerWidth: number }> = {};
for (const [name, path] of [
  ["overview", `${client}?tab=overview`],
  ["cash", `${client}?tab=overview&section=cash`],
  ["pack", `${client}?tab=deliverables&section=pack`],
] as const) {
  await measure.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await measure.waitForSelector("[role='tablist']");
  scroll[name] = await measure.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}
await measure.close();
await browser.close();

const report = { written, scroll };
await writeFile("/tmp/rail-harness-scroll.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
