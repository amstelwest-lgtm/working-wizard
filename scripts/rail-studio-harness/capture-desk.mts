/**
 * Screenshots for the Milōn Bot desk mockup. Local harness only.
 * Expects Vite on 127.0.0.1:4179. Does not call Supabase or Vercel.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];

await mkdir(outDir, { recursive: true });

async function shot(
  name: string,
  width: number,
  height: number,
  path: string,
  prepare?: (page: import("playwright").Page) => Promise<void>,
) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${name}: ${error.message}`);
  });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-desk-ready='true']");
  if (prepare) await prepare(page);
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: width > 400 && !name.includes("workqueue") && !name.includes("composer") && !name.startsWith("current") });
  written.push(file);
  await page.close();
}

await shot("mockup-desktop-1280", 1280, 900, "/milon-bot-mockup?fixture=populated");

await shot("mockup-desktop-1280-workqueue", 1280, 1100, "/milon-bot-mockup?fixture=populated", async (page) => {
  await page.locator("[data-desk-jobs='true']").scrollIntoViewIfNeeded();
  await page.locator("[data-approve='budget']").click();
  await page.locator("[data-approve='collections']").click();
  await page.getByText("Draft only. Nothing was sent.").waitFor();
  await page.getByRole("region", { name: "Add a card to start your 14-day free trial" }).waitFor();
  await page.evaluate(() => {
    const el = document.querySelector("[data-desk-jobs='true']");
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 78;
    window.scrollTo(0, Math.max(0, y));
  });
  const box = await page.getByText("Draft only. Nothing was sent.").boundingBox();
  if (!box || box.y < 40 || box.y > 980) {
    throw new Error(`draft confirm is outside the work-queue frame: ${JSON.stringify(box)}`);
  }
});

await shot("mockup-mobile-390", 390, 844, "/milon-bot-mockup?fixture=populated");

await shot("mockup-mobile-390-composer", 390, 844, "/milon-bot-mockup?fixture=populated", async (page) => {
  const composer = page.locator("[data-desk-composer='true']");
  await composer.scrollIntoViewIfNeeded();
  await page.locator("#milon-desk-ask").fill("What should we tell the owner about payroll?");
  await page.waitForTimeout(200);
});

await shot("mockup-empty-1280", 1280, 1100, "/milon-bot-mockup?fixture=empty");

await shot("current-bot-1280", 1280, 1100, "/milon-bot-current", async (page) => {
  await page.waitForSelector("[data-current-bot-ready='true']");
  await page.waitForSelector(".ask-ai-blurb");
  await page.waitForTimeout(200);
});

await browser.close();
const report = { written };
await writeFile("/tmp/milon-desk-shots.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
