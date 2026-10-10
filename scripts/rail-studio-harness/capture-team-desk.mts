/**
 * Screenshots for the team desk. Local harness only.
 * Expects Vite on 127.0.0.1:4179. Does not call Supabase or Vercel.
 */
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const teamConfig = readFileSync(new URL("../../src/lib/milon-team.ts", import.meta.url), "utf8");
const bookkeeperName = teamConfig.match(/financial_manager: "(Mil[^"]+)"/)?.[1];
if (!bookkeeperName) throw new Error("financial_manager display name missing from the team config");

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";
const oldRole = ["Acc", "ountant"].join("");
const banned = ["Dana", "payroll", "Claude", "white-label", oldRole];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];

await mkdir(outDir, { recursive: true });

async function assertAboveComposer(page: Page, label: string) {
  const loc = page.getByText(label, { exact: false }).first();
  await loc.waitFor({ timeout: 8000 });
  const composer = await page.locator("#ask-ai-accountant").boundingBox();
  const target = await loc.boundingBox();
  if (!composer || !target) throw new Error(`${label} or the chat composer is missing`);
  if (target.y + target.height > composer.y + 1) {
    throw new Error(`${label} sits under the chat composer`);
  }
}

async function stubReply(page: Page) {
  await page.route("**/__harness/bot-reply", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answer: "The cash floor is the item to watch." }),
    }),
  );
}

async function askAndWait(page: Page) {
  await stubReply(page);
  const field = page.locator("#ask-ai-accountant textarea");
  await field.waitFor({ timeout: 8000 });
  await field.fill("What should we watch this week?");
  await page.locator("#ask-ai-accountant .ask-ai-send").click();
  await page.locator("#ask-ai-accountant").getByText("What should we watch this week?").waitFor();
  await page.locator("#ask-ai-accountant").getByText("The cash floor is the item to watch.").waitFor();
  const team = await page.locator(".milon-desk-team").boundingBox();
  const chat = await page.locator("#ask-ai-accountant").boundingBox();
  if (!team || !chat) throw new Error("the desk or the chat is missing");
  if (chat.y < team.y + 8) throw new Error("the chat is not under the desk");
}

async function shot(name: string, width: number, height: number, path: string, prepare?: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width, height } });
  const leaked: string[] = [];
  page.setDefaultTimeout(15000);
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/functions/v1/")) leaked.push(url);
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
  await page.getByRole("button", { name: "Milōn Bot" }).waitFor();
  const row = await page.locator(".milon-desk-row").first().boundingBox();
  const dismiss = await page.locator("[data-dismiss='board']").boundingBox();
  if (!row || !dismiss) throw new Error("Offered actions or the Today row is missing");
  const rowContentRight = row.x + row.width - 12;
  if (Math.abs(rowContentRight - (dismiss.x + dismiss.width)) > 2) {
    throw new Error(`Approve/Dismiss are not on the Today row edge (${rowContentRight} vs ${dismiss.x + dismiss.width})`);
  }
  await assertAboveComposer(page, "September close is ready for your sign-off.");
  await page.locator(".milon-desk-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
});

await shot("desk-desktop-1280-financial_manager", 1280, 1280, "/milon-team-desk?fixture=populated", async (page) => {
  await page.locator("[data-agent-filter='all']").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("[data-agent-filter='financial_manager']")?.getAttribute("aria-checked") === "true",
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
  await assertAboveComposer(page, "Draft ready. Nothing was sent.");
});

await shot("desk-mobile-390", 390, 844, "/milon-team-desk?fixture=populated", async (page) => {
  const agents = page.locator(".milon-desk-agents");
  const fit = await agents.evaluate((el) => {
    const chips = [...el.querySelectorAll<HTMLElement>(".milon-desk-agent")];
    const box = el.getBoundingClientRect();
    return chips.map((chip) => {
      const name = chip.querySelector<HTMLElement>(".milon-desk-agent-short");
      const dot = chip.querySelector<HTMLElement>(".milon-desk-status i");
      const nameBox = name?.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      return {
        text: name?.textContent ?? "",
        nameFits: !!name && name.scrollWidth <= name.clientWidth + 1,
        dot: !!dot && getComputedStyle(dot).display !== "none",
        inside: chipBox.left >= box.left - 1 && chipBox.right <= box.right + 1 && chipBox.right <= 390,
        visibleName: !!nameBox && nameBox.width > 0 && getComputedStyle(name!).display !== "none",
      };
    });
  });
  if (fit.length !== 3) throw new Error(`expected three team chips, saw ${fit.length}`);
  for (const chip of fit) {
    if (!chip.visibleName || !chip.nameFits) throw new Error(`team chip is cut off (${chip.text})`);
    if (!chip.dot) throw new Error(`team chip is missing its status dot (${chip.text})`);
    if (!chip.inside) throw new Error(`team chip sits outside the row (${chip.text})`);
  }
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
  const ask = page.locator("#ask-ai-accountant .ask-ai-send");
  await ask.waitFor({ timeout: 8000 });
  await page.waitForFunction(() => {
    const share = document.querySelector('button[aria-label="Share Milōn"]');
    return !!share && getComputedStyle(share).display === "none";
  });
  const askBox = await ask.boundingBox();
  if (!askBox) throw new Error("Ask button is missing");
  if (askBox.y + askBox.height > 844 + 1 || askBox.y < 0) throw new Error("Ask button is off the phone viewport");
  const shareBox = await page.locator('button[aria-label="Share Milōn"]').boundingBox();
  if (shareBox) throw new Error("share FAB covers the Bot tab");
});

await shot("desk-chat-1280", 1280, 1440, "/milon-team-desk?fixture=populated", async (page) => {
  await askAndWait(page);
});

await shot("desk-chat-390", 390, 844, "/milon-team-desk?fixture=populated", async (page) => {
  await askAndWait(page);
  const askBox = await page.locator("#ask-ai-accountant .ask-ai-send").boundingBox();
  const shareBox = await page.locator('button[aria-label="Share Milōn"]').boundingBox();
  if (!askBox) throw new Error("Ask button is missing after the reply");
  if (shareBox) throw new Error("share FAB covers the answered chat");
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
