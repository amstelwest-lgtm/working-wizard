/**
 * Local shots of the empty-client 13-week Preview.
 * Expects the Vite harness on 127.0.0.1:4179. No Vercel deploy.
 *
 * SHOT=before  — button is disabled, the sentence is not on screen
 * SHOT=after   — button is enabled; click opens the existing sentence
 */
import { chromium } from "playwright";

const base = process.env.HARNESS_URL ?? "http://127.0.0.1:4179";
const shot = process.env.SHOT === "before" ? "before" : "after";
const outDir = "/opt/cursor/artifacts/screenshots";
const url = `${base}/reports?clientId=harness-client&client=Empty%20Client&report=forecast&emptyClient=1`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
await page.goto(url, { waitUntil: "networkidle" });
const card = page.locator("#report-card-forecast");
await card.waitFor({ state: "visible", timeout: 20000 });
await page.waitForFunction(() => {
  const root = document.querySelector("#report-card-forecast");
  return Boolean(root && !root.textContent?.includes("Loading"));
});
const preview = card.getByRole("button", { name: "Preview" });
const download = card.getByRole("button", { name: "Download" });
const previewDisabled = await preview.isDisabled();
const downloadDisabled = await download.isDisabled();
if (!downloadDisabled) throw new Error("Download should stay disabled on an empty client");
if (shot === "before" && !previewDisabled) {
  throw new Error("before shot expected a disabled Preview button");
}
if (shot === "after" && previewDisabled) {
  throw new Error("after shot expected Preview to stay enabled");
}
await card.screenshot({ path: `${outDir}/forecast-preview-empty-${shot}-card.png` });
if (shot === "after") {
  await preview.click();
  const message = page.locator("[data-forecast-preview-empty]");
  await message.waitFor({ state: "visible", timeout: 10000 });
  const text = (await message.innerText()).replace(/\s+/g, " ").trim();
  const expected = "Not enough data. The 13-week chart appears once a forecast line is entered.";
  if (text !== expected) throw new Error(`message was ${text}`);
  if (/vat/i.test(text)) throw new Error("empty message invented VAT wording");
  await page.screenshot({ path: `${outDir}/forecast-preview-empty-after-message.png` });
}
console.log(`forecast preview empty ${shot}: previewDisabled=${previewDisabled}`);
await browser.close();
