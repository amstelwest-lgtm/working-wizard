/**
 * Screenshots for the owner-door mockup. Local harness only.
 * Expects Vite on 127.0.0.1:4179. Does not call Supabase or Vercel.
 */
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const names = readFileSync(
  new URL("../../src/mockups/owner/owner-team.ts", import.meta.url),
  "utf8",
);
for (const required of [
  "Milōn Financial Manager",
  "Milōn Analyst",
  "Milōn Advisor",
  'short: "Fin. Manager"',
]) {
  if (!names.includes(required)) throw new Error(`owner team constant is missing ${required}`);
}
if (names.includes("Forecaster") || names.includes("Bookkeeper")) {
  throw new Error("owner team constant still uses a retired name");
}

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";
const banned = [
  "Dana",
  "Forecaster",
  "Bookkeeper",
  "Claude",
  "white-label",
  "OCFO",
  "real-time",
  "bank feed",
  "$39",
  "Ready for review",
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];

await mkdir(outDir, { recursive: true });

async function shot(
  name: string,
  width: number,
  height: number,
  path: string,
  prepare?: (page: Page) => Promise<void>,
) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const leaked: string[] = [];
  page.setDefaultTimeout(15000);
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/functions/v1/") || url.includes("supabase.co") || url.includes("vercel.com"))
      leaked.push(url);
  });
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${name}: ${error.message}`);
  });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("[data-owner-ready='true']", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  if (prepare) await prepare(page);
  const text = await page.locator("body").innerText();
  for (const word of banned) {
    if (text.toLowerCase().includes(word.toLowerCase()))
      throw new Error(`${name} shows banned copy: ${word}`);
  }
  if (leaked.length) throw new Error(`${name} called the network: ${leaked.join(", ")}`);
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file });
  written.push(file);
  await page.close();
}

async function expectShortLabels(page: Page, requireManager: boolean) {
  const fit = await page.locator("[data-short-label]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const el = node as HTMLElement;
      const shown = getComputedStyle(el).display !== "none";
      return {
        text: el.textContent ?? "",
        shown,
        fits: el.scrollWidth <= el.clientWidth + 1,
      };
    }),
  );
  const visible = fit.filter((row) => row.shown);
  if (requireManager && !visible.some((row) => row.text?.trim() === "Fin. Manager")) {
    throw new Error(`mobile is missing the Fin. Manager label: ${JSON.stringify(fit)}`);
  }
  for (const row of visible) {
    if (!row.fits) throw new Error(`short label overflows (${row.text})`);
  }
  const full = await page
    .locator("[data-full-label]")
    .evaluateAll((nodes) =>
      nodes.some(
        (node) =>
          getComputedStyle(node).display !== "none" && (node.textContent ?? "").includes("Milōn"),
      ),
    );
  if (full) throw new Error("mobile is showing the long Milōn name");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (overflow) throw new Error("page scrolls sideways");
}

const shots: { name: string; path: string; prepare?: (page: Page) => Promise<void> }[] = [
  {
    name: "owner-01-home",
    path: "/owner-mockup?screen=home",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Your finance team" }).waitFor();
      await page.getByText("Analyst → Advisor: margin dip; drafting 2 moves.").waitFor();
      await page
        .getByText("Financial Manager → Kloof & Partners: September pack ready for sign-off.")
        .waitFor();
      await page.getByText("Analyst checked September: margin down 3 points.").waitFor();
      await page.getByText("Signed off ✓").waitFor();
      await page.getByRole("button", { name: "Assign to Johan" }).waitFor();
      await page.getByText("Owner plan · R299/mo · free when your accountant joins").waitFor();
    },
  },
  {
    name: "owner-02-analyst",
    path: "/owner-mockup?screen=bot&bot=analyst",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "September diagnosis" }).waitFor();
      await page.getByText("33%", { exact: true }).first().waitFor();
      await page.getByText("R 6 420 000", { exact: true }).first().waitFor();
      await page.getByText("Signed off by Thandiwe Khumalo").waitFor();
    },
  },
  {
    name: "owner-03-actions",
    path: "/owner-mockup?screen=actions",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Action points" }).waitFor();
      await page.getByRole("button", { name: /Johan Pietersen/ }).waitFor();
      await page.getByText("Amina Rahman").waitFor();
      await page.getByText("R 610 000").first().waitFor();
      await page.getByText("R 720 000").first().waitFor();
    },
  },
  {
    name: "owner-04-accountant",
    path: "/owner-mockup?screen=accountant",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Your accountant" }).waitFor();
      await page.getByText("Signed off ✓").first().waitFor();
      await page.getByRole("button", { name: "Upload" }).first().waitFor();
      await page.getByText("Invite your accountant to sign off").waitFor();
      if ((await page.getByText("Signed off ✓").count()) < 1) {
        throw new Error("accountant deliverables are missing Signed off");
      }
    },
  },
  {
    name: "owner-05-first-run",
    path: "/owner-mockup?screen=first",
    prepare: async (page) => {
      await page.getByRole("button", { name: /QuickBooks/ }).waitFor();
      await page.getByRole("button", { name: /Xero/ }).waitFor();
      await page.getByRole("heading", { name: "Invite your accountant" }).waitFor();
      await page.getByText("Free when your accountant joins Milōn").waitFor();
      await page.getByText("Owner plan · R299/mo · free when your accountant joins").waitFor();
      await page.getByText("Not the bank.").waitFor();
    },
  },
];

for (const item of shots) {
  await shot(`${item.name}-1280`, 1280, 800, item.path, async (page) => {
    if (item.prepare) await item.prepare(page);
    if (item.name === "owner-01-home") {
      await page.getByText("Milōn Financial Manager").waitFor();
      const lead = page.locator("[data-bot='financial_manager']");
      const box = await lead.boundingBox();
      if (!box || box.y > 220)
        throw new Error("Financial Manager is not the lead presence on the home screen");
    }
  });
  await shot(`${item.name}-390`, 390, 844, item.path, async (page) => {
    if (item.prepare) await item.prepare(page);
    await expectShortLabels(
      page,
      item.name === "owner-01-home" || item.name === "owner-03-actions",
    );
  });
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${base}/owner-mockup?screen=home`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-owner-ready='true']");
await page.getByRole("button", { name: /Milōn Analyst/ }).click();
await page.waitForFunction(
  () => location.search.includes("screen=bot") && location.search.includes("bot=analyst"),
);
await page.getByRole("heading", { name: "September diagnosis" }).waitFor();
await page.getByRole("button", { name: "Team", exact: true }).click();
await page.getByRole("button", { name: "Assign to Johan" }).click();
await page.waitForFunction(() => location.search.includes("screen=actions"));
await page.getByText("With Johan Pietersen").waitFor();
await page.getByRole("button", { name: "Accountant" }).click();
await page.getByRole("button", { name: "Upload" }).first().click();
await page.getByText("Ready · september-glass-notes.pdf").waitFor();
await page.goto(`${base}/owner-mockup?screen=first`);
await page.getByRole("button", { name: /QuickBooks/ }).click();
await page.getByText("QuickBooks connected for Harbour Glass.").waitFor();
const email = page.locator("#owner-accountant-email");
if (await email.isDisabled()) throw new Error("invite stayed disabled after QuickBooks");
await email.fill("thandiwe@kloof.example");
await page.getByRole("button", { name: "Send invite" }).click();
await page.getByText("Invite noted. Nothing was sent from this mockup.").waitFor();
await page.close();

await browser.close();
console.log(written.join("\n"));
