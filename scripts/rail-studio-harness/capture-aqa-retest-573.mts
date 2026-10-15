/**
 * Local harness shots for the #573 retest fixture. Not a client file.
 */
import { chromium } from "playwright";

const base = process.env.HARNESS_URL ?? "http://127.0.0.1:4183";
const outDir = "/opt/cursor/artifacts/screenshots";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(`${base}/aqa-retest-573`, { waitUntil: "networkidle" });
const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
if (!body.includes("R 44 480") && !body.includes("R44,480")) {
  throw new Error(`opening missing: ${body.slice(0, 500)}`);
}
const openingTotal = (await page.locator('[data-cash-total="opening"]').innerText()).replace(/\s+/g, " ");
if (!/44[, ]?480/.test(openingTotal.replace(/\s/g, ""))) {
  throw new Error(`opening total is ${openingTotal}, expected week 1`);
}
if (/71[, ]?628/.test(openingTotal.replace(/\s/g, ""))) {
  throw new Error(`opening total still uses the last week: ${openingTotal}`);
}
if (!body.includes("Hotels & accommodation")) throw new Error(`industry missing: ${body.slice(0, 800)}`);
if (/sells time/i.test(body)) throw new Error("health still says sells time");
if (!body.includes("Runway —")) throw new Error(`dust runway missing: ${body.slice(0, 800)}`);
if (!body.includes("Invoiced sales and cash collected are different figures")) {
  throw new Error(`banner missing: ${body.slice(0, 800)}`);
}
if (!body.includes("101") || !body.includes("47")) throw new Error(`gap amounts missing: ${body}`);
await page.locator(".cash-13w-scroll").evaluate((node) => {
  node.scrollLeft = node.scrollWidth;
});
await page.screenshot({ path: `${outDir}/aqa-retest-573-opening.png`, fullPage: false });
await page.evaluate(() => window.scrollTo(0, 700));
await page.screenshot({ path: `${outDir}/aqa-retest-573-health.png`, fullPage: false });
if (errors.length) throw new Error(errors.join("\n"));
console.log("aqa-retest-573 shots ok", openingTotal);
await browser.close();
