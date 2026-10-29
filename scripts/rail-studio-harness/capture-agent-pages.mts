/**
 * Screenshots of the in-client agent pages for review. Local harness only.
 * Expects the harness on 127.0.0.1:4179 (pnpm harness:dev).
 *
 *   NAME=part1-after AGENTS=advisor SIZES=1366x768 WHEEL=600 npx tsx scripts/rail-studio-harness/capture-agent-pages.mts
 *
 * WHEEL scrolls the wheel with the pointer over the first card before the shot.
 * DARK=1 sets the dark theme. FULL=1 takes a full-page shot.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4179";
const outDir = process.env.OUT ?? "/opt/cursor/artifacts/screenshots";
const name = process.env.NAME ?? "agent";
const agents = (process.env.AGENTS ?? "financial_manager,analyst,advisor").split(",");
const sizes = (process.env.SIZES ?? "1366x768").split(",").map((pair) => {
  const [width, height] = pair.split("x").map(Number);
  return { width, height };
});
const wheel = Number(process.env.WHEEL ?? 0);
const fixture = process.env.FIXTURE ?? "live";
const query = process.env.QUERY ?? "";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const size of sizes) {
  for (const agent of agents) {
    const context = await browser.newContext({ viewport: size });
    if (process.env.DARK === "1") {
      await context.addInitScript(() => localStorage.setItem("theme_pref_v2", "dark"));
    }
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`[pageerror] ${agent}: ${error.message}`));
    const path =
      agent === "team"
        ? `/milon-team-desk?fixture=${fixture}${query}`
        : `/milon-team-desk?fixture=${fixture}&agent=${agent}${query}`;
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-desk-ready='true'], [data-agent-stage]", { timeout: 10000 });
    await page.waitForTimeout(600);
    if (wheel) {
      const card = page.locator(".agent-section, .milon-desk-card").first();
      const box = await card.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 40, box.y + 20);
        await page.mouse.wheel(0, wheel);
        await page.waitForTimeout(400);
      }
    }
    const file = `${outDir}/${name}-${agent}-${size.width}x${size.height}.png`;
    await page.screenshot({ path: file, fullPage: process.env.FULL === "1" });
    console.log(file);
    await context.close();
  }
}
await browser.close();
