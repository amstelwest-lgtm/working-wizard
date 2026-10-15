/**
 * Local harness shots for the AQA follow-up fixture. Not a client file.
 * Expects the Vite harness on 127.0.0.1:4179.
 */
import { chromium } from "playwright";

const base = process.env.HARNESS_URL ?? "http://127.0.0.1:4181";
const outDir = "/opt/cursor/artifacts/screenshots";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${base}/aqa-followup`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-open-sentence]");
const sentence = await page.getAttribute("[data-open-sentence]", "data-open-sentence");
const health = await page.locator("[data-health]").allTextContents();
const gm = (await page.locator("[data-gm]").textContent())?.trim();
const wc = (await page.locator("[data-wc]").textContent())?.trim();
const runwayReal = (await page.locator("[data-runway-real]").textContent())?.trim();
const runwayEmpty = (await page.locator("[data-runway-empty]").textContent())?.trim();
const trend = await page.getAttribute("[data-trend]", "data-trend");
if (sentence !== "2 open actions.") throw new Error(`sentence ${sentence}`);
if (health.join(" | ") !== "Overdue | Not started") throw new Error(health.join(" | "));
if (gm !== "60.0%") throw new Error(`gm ${gm}`);
if (wc !== "Creditors fund the cycle · 149 days") throw new Error(`wc ${wc}`);
if (runwayReal !== "13 weeks below") throw new Error(`runway ${runwayReal}`);
if (runwayEmpty !== "—") throw new Error(`empty runway ${runwayEmpty}`);
if (trend !== "hidden") throw new Error(`trend ${trend}`);
await page.screenshot({ path: `${outDir}/aqa-followup-needs.png`, fullPage: false });
await page.evaluate(() => window.scrollTo(0, 520));
await page.screenshot({ path: `${outDir}/aqa-followup-health.png`, fullPage: false });
console.log("aqa-followup shots ok");
await browser.close();
