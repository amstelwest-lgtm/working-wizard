/**
 * Screenshots for the team desk. Local harness only.
 * Expects Vite on 127.0.0.1:4179. Does not call Supabase or Vercel.
 */
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const teamConfig = readFileSync(new URL("../../src/lib/milon-team.ts", import.meta.url), "utf8");
const bookkeeperName = teamConfig.match(/bookkeeper: "(Mil[^"]+)"/)?.[1];
if (!bookkeeperName) throw new Error("bookkeeper display name missing from the team config");

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";
const oldRole = ["Acc", "ountant"].join("");
const banned = ["Dana", "payroll", "Claude", "white-label", oldRole];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];

await mkdir(outDir, { recursive: true });

async function assertClearOfDock(page: Page, label: string) {
  const loc = page.getByText(label, { exact: false }).first();
  await loc.waitFor({ timeout: 8000 });
  const dock = await page.locator(".milon-desk-dock").boundingBox();
  const target = await loc.boundingBox();
  if (!dock || !target) throw new Error(`${label} or the composer dock is missing`);
  if (target.y + target.height > dock.y + 1) {
    throw new Error(`${label} sits under the composer dock`);
  }
}

async function shot(name: string, width: number, height: number, path: string, prepare?: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width, height } });
  const leaked: string[] = [];
  page.setDefaultTimeout(15000);
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("functions/v1") || url.includes("ask-ai") || url.includes("milon-bot")) leaked.push(url);
  });
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${name}: ${error.message}`);
  });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector("[data-desk-ready='true']", { timeout: 8000 });
  if (prepare) await prepare(page);
  const text = await page.locator("body").innerText();
  for (const word of banned) {
    if (text.toLowerCase().includes(word.toLowerCase())) throw new Error(`banned copy on the desk: ${word}`);
  }
  if (leaked.length) throw new Error(`desk called the model: ${leaked.join(", ")}`);
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file });
  written.push(file);
  await page.close();
}

await shot("desk-desktop-1280", 1280, 1440, "/milon-team-desk?fixture=populated", async (page) => {
  if ((await page.locator("[data-agent-filter='all']").getAttribute("aria-checked")) !== "true") {
    throw new Error("All should be selected on the first view");
  }
  await page.getByText(bookkeeperName).waitFor();
  await page.getByText("Books clean ✓").waitFor();
  await page.getByText("Forecast updated").waitFor();
  await page.getByText("Cash watch: 1 alert").waitFor();
  await page.getByText("Milōn Bot").waitFor();
  const row = await page.locator(".milon-desk-row").first().boundingBox();
  const dismiss = await page.locator("[data-dismiss='board']").boundingBox();
  if (!row || !dismiss) throw new Error("Offered actions or the Today row is missing");
  const rowContentRight = row.x + row.width - 12;
  if (Math.abs(rowContentRight - (dismiss.x + dismiss.width)) > 2) {
    throw new Error(`Approve/Dismiss are not on the Today row edge (${rowContentRight} vs ${dismiss.x + dismiss.width})`);
  }
  await assertClearOfDock(page, "September close is ready for your sign-off.");
  await page.locator(".milon-desk-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
});

await shot("desk-desktop-1280-bookkeeper", 1280, 1280, "/milon-team-desk?fixture=populated", async (page) => {
  await page.locator("[data-agent-filter='all']").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("[data-agent-filter='bookkeeper']")?.getAttribute("aria-checked") === "true",
  );
  await page.getByText("Books clean ✓").waitFor();
  await page.getByText("September close matches the bank").waitFor();
  await page.getByText("Bank feed synced for September.").waitFor();
  if ((await page.getByText("Cash floor is close").count()) !== 0) {
    throw new Error("Advisor briefing still visible with Bookkeeper selected");
  }
  if ((await page.getByText("Draft the board note").count()) !== 0) {
    throw new Error("Analyst job still visible with Bookkeeper selected");
  }
  if ((await page.getByText("13-week forecast refreshed").count()) !== 0) {
    throw new Error("Analyst activity still visible with Bookkeeper selected");
  }
  await page.locator(".milon-desk-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
});

await shot("desk-desktop-1280-approved", 1280, 1200, "/milon-team-desk?fixture=populated", async (page) => {
  await page.locator("[data-approve='board']").click();
  await page.getByText("Draft ready. Nothing was sent.").waitFor();
  await page.getByRole("link", { name: "Open" }).waitFor();
  await page.getByRole("region", { name: "Add a card to start your 14-day free trial" }).waitFor();
  await page.locator("[data-desk-jobs='true']").evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await assertClearOfDock(page, "Draft ready. Nothing was sent.");
});

await shot("desk-mobile-390", 390, 844, "/milon-team-desk?fixture=populated", async (page) => {
  const agents = page.locator(".milon-desk-agents");
  const overflow = await agents.evaluate((el) => ({
    overflow: getComputedStyle(el).overflowX,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  if (overflow.overflow !== "auto" && overflow.overflow !== "scroll") {
    throw new Error(`team pills are not a horizontal scroller (${overflow.overflow})`);
  }
  if (overflow.scrollWidth <= overflow.clientWidth) throw new Error("team pills do not overflow at 390");
  const rail = await page.locator(".deliverable-rail").boundingBox();
  const team = await page.locator(".milon-desk-team").boundingBox();
  if (!rail || !team) throw new Error("rail or team header is missing");
  if (team.y < rail.y + rail.height - 1) throw new Error("team header overlaps the rail");
  const deliverables = page.locator(".deliverable-rail .tab", { hasText: "Deliverables" });
  const clipped = await deliverables.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (clipped) throw new Error("Deliverables is clipped");
  await page.locator(".milon-desk-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
});

await shot("desk-mobile-390-composer", 390, 844, "/milon-team-desk?fixture=populated", async (page) => {
  const input = page.locator("#milon-desk-task");
  await input.click();
  await input.fill("Chase the September debtors");
  await page.locator(".milon-desk-composer button").click();
  await page.getByText("Held as a task. Nothing was sent.").waitFor();
  const dock = await page.locator(".milon-desk-dock").boundingBox();
  if (!dock || dock.y + dock.height > 844 + 1) throw new Error("composer is off the phone viewport");
});

await shot("desk-empty-1280", 1280, 900, "/milon-team-desk?fixture=empty", async (page) => {
  await page.getByText("No data yet").waitFor();
  await page.getByText("Not run yet").first().waitFor();
  const text = await page.locator(".milon-desk").innerText();
  for (const heading of ["Today", "Offered", "Activity"]) {
    if (text.includes(heading)) throw new Error(`empty client still shows ${heading}`);
  }
});

await browser.close();
console.log(written.join("\n"));
