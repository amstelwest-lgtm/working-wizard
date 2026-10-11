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
  { name: "home", path: `${client}?tab=home` },
  { name: "health", path: `${client}?tab=health` },
  { name: "cash", path: `${client}?tab=cash` },
  { name: "budget", path: `${client}?tab=budget` },
  { name: "deliverables", path: `${client}?tab=deliverables` },
  { name: "practice", path: "/dashboard" },
  { name: "settings", path: "/settings" },
  { name: "cmdk", path: `${client}?tab=home`, palette: true },
];

const widths = [
  { suffix: "1280", width: 1280, height: 900 },
  { suffix: "390", width: 390, height: 844 },
];

const themes = ["light", "dark"] as const;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];

await mkdir(outDir, { recursive: true });

for (const theme of themes) {
  for (const size of widths) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    await page.addInitScript((next) => {
      localStorage.setItem("theme_pref_v2", next);
    }, theme);
    const blocked: string[] = [];
    page.on("request", (request) => {
      if (/supabase\.(co|in|com)/i.test(request.url())) blocked.push(request.url());
    });
    for (const shot of shots) {
      await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-rail-ready='true']");
      await page.waitForSelector("nav.deliverable-rail");
      if (shot.palette) {
        await page.getByRole("button", { name: /Search features/i }).click();
        await page.getByRole("dialog").waitFor();
        await page.waitForTimeout(300);
      }
      const file = `${outDir}/rail-b-after-${shot.name}-${theme}-${size.suffix}.png`;
      await page.screenshot({ path: file });
      written.push(file);
    }
    await page.close();
  }
}

const measure = await browser.newPage({ viewport: { width: 360, height: 800 } });
const scroll: Record<string, { scrollWidth: number; innerWidth: number; railScroll: number; railClient: number }> = {};
for (const [name, path] of [
  ["home", `${client}?tab=home`],
  ["cash", `${client}?tab=cash`],
  ["budget", `${client}?tab=budget`],
] as const) {
  await measure.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await measure.waitForSelector("nav.deliverable-rail");
  scroll[name] = await measure.evaluate(() => {
    const rail = document.querySelector("nav.deliverable-rail");
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      railScroll: rail ? rail.scrollWidth : 0,
      railClient: rail ? rail.clientWidth : 0,
    };
  });
}
await measure.close();
await browser.close();

const report = { written, scroll };
await writeFile("/tmp/rail-harness-scroll.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
