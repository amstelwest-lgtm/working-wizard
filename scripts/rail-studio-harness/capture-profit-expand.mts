/** One-off: prove the premium Expand sheet renders the waterfall. */
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE", msg.text().slice(0, 300));
});
await page.goto("http://127.0.0.1:4179/owner-door?view=profit", { waitUntil: "networkidle" });
await page.waitForSelector("[data-owner-ready='true']", { timeout: 20000 });
await page.getByRole("button", { name: "Expand the profitability waterfall" }).click();
await page.waitForSelector("[data-waterfall-premium='wide']");
await page.waitForTimeout(600);
await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/profit-after-expand-1280.png" });
console.log("expand sheet ok");

await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.addStyleTag({
  content: ".notes-fab, #wizard-notes-pin, .notes-tray, [data-note] { display: none !important; }",
});
await page.getByRole("button", { name: /Key insight/ }).click();
const detailRow = page.locator("div.truncate", { hasText: /^Operating Expenses$/ });
await detailRow.waitFor();
await detailRow.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/profit-after-details-1280.png" });
console.log("details toggle ok");
await browser.close();
