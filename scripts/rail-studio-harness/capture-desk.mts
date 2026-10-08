/**
 * Screenshots for the Milōn Bot desk mockup. Local harness only.
 * Expects Vite on 127.0.0.1:4179. Does not call Supabase or Vercel.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";
const banned = ["Controller", "FP&A", "Treasury", "Dana", "payroll", "Claude", "white-label"];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];

await mkdir(outDir, { recursive: true });

async function assertClearOfDock(page: Page, label: string) {
  const loc = page.getByText(label, { exact: false }).first();
  await loc.waitFor({ timeout: 8000 });
  await loc.evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  });
  const dock = await page.locator(".milon-desk-dock").boundingBox();
  const target = await loc.boundingBox();
  if (!dock || !target) throw new Error(`${label} or the composer dock is missing`);
  if (target.y + target.height > dock.y + 1) {
    throw new Error(`${label} sits under the composer dock: ${JSON.stringify({ target, dock })}`);
  }
}

async function assertCopy(page: Page) {
  const text = await page.locator("body").innerText();
  for (const word of banned) {
    if (text.toLowerCase().includes(word.toLowerCase())) {
      throw new Error(`banned copy on the desk: ${word}`);
    }
  }
  if (!text.includes("Milōn Bot")) throw new Error("rail label Milōn Bot is missing");
}

async function shot(
  name: string,
  width: number,
  height: number,
  path: string,
  prepare?: (page: Page) => Promise<void>,
) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${name}: ${error.message}`);
  });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector("[data-desk-ready='true']", { timeout: 8000 });
  await page.waitForSelector("[data-agent-filter='advisor']", { timeout: 8000 });
  if (prepare) await prepare(page);
  await assertCopy(page);
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file });
  written.push(file);
  await page.close();
}

await shot("mockup-desktop-1280", 1280, 1440, "/milon-bot-mockup?fixture=populated", async (page) => {
  await page.locator("[data-agent-filter='all']").waitFor();
  const allChecked = await page.locator("[data-agent-filter='all']").getAttribute("aria-checked");
  if (allChecked !== "true") throw new Error("All should be selected on the first view");
  await page.getByText("Books clean ✓").waitFor();
  await page.getByText("Forecast updated").waitFor();
  await page.getByText("Cash watch: 1 alert").waitFor();
  await assertClearOfDock(page, "Review and sign off");
  await assertClearOfDock(page, "Draft plan");
  await page.locator(".milon-desk-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
});

await shot("mockup-desktop-1280-filtered", 1280, 1280, "/milon-bot-mockup?fixture=populated", async (page) => {
  const all = page.locator("[data-agent-filter='all']");
  await all.focus();
  await page.keyboard.press("End");
  await page.waitForFunction(
    () => document.querySelector("[data-agent-filter='advisor']")?.getAttribute("aria-checked") === "true",
  );
  await page.getByText("Cash watch: 1 alert").waitFor();
  await page.getByText("71 days").waitFor();
  await page.getByText("Collections:").waitFor();
  await page.getByText("Flagged the cash floor").waitFor();
  if ((await page.getByText("62 / 100").count()) !== 0) {
    throw new Error("Accountant briefing still visible with Advisor selected");
  }
  if ((await page.getByText("people costs").count()) !== 0) {
    throw new Error("Analyst job still visible with Advisor selected");
  }
  if ((await page.getByText("13-week forecast").count()) !== 0) {
    throw new Error("Analyst activity still visible with Advisor selected");
  }
  await assertClearOfDock(page, "Add to pack");
  await page.locator(".milon-desk-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
});

await shot("mockup-desktop-1280-workqueue", 1280, 1200, "/milon-bot-mockup?fixture=populated", async (page) => {
  await page.locator("[data-desk-jobs='true']").scrollIntoViewIfNeeded();
  await page.locator("[data-approve='budget']").click();
  await page.locator("[data-approve='collections']").click();
  await page.getByText("Draft ready. Nothing was sent.").waitFor();
  await page.getByRole("region", { name: "Add a card to start your 14-day free trial" }).waitFor();
  await page.locator("[data-desk-jobs='true']").evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await assertClearOfDock(page, "Draft ready. Nothing was sent.");
  await assertClearOfDock(page, "Add a card to start your 14-day free trial");
});

await shot("mockup-mobile-390", 390, 844, "/milon-bot-mockup?fixture=populated", async (page) => {
  const agents = page.locator(".milon-desk-agents");
  const overflow = await agents.evaluate((el) => getComputedStyle(el).overflowX);
  if (overflow !== "auto" && overflow !== "scroll") {
    throw new Error(`mobile team row is not scrollable: ${overflow}`);
  }
  const mark = await page.locator(".milon-desk-agent .milon-desk-mark").first().boundingBox();
  if (mark) throw new Error("mobile pills should hide the large mark and keep a status dot");
  await assertClearOfDock(page, "Add to pack");
  await page.locator(".milon-desk-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
});

await shot("mockup-mobile-390-composer", 390, 844, "/milon-bot-mockup?fixture=populated", async (page) => {
  const composer = page.locator("[data-desk-composer='true']");
  await composer.scrollIntoViewIfNeeded();
  await page.locator("#milon-desk-ask").fill("What should we tell the owner about people costs?");
  await page.waitForTimeout(200);
});

await shot("mockup-empty-1280", 1280, 1100, "/milon-bot-mockup?fixture=empty", async (page) => {
  await page.getByText("No books on file yet").waitFor();
  await page.getByText("No forecast on file").waitFor();
  await page.getByText("No cash watch yet").waitFor();
  await page.getByText("Nothing to diagnose until the figures are on file.").waitFor();
});

await browser.close();
const report = { written };
await writeFile("/tmp/milon-desk-shots.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
