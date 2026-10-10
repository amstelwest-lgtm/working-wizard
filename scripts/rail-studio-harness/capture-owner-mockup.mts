/**
 * Owner-door v2 screenshots and short motion clips. Local harness only.
 * Expects Vite on 127.0.0.1:4179. Does not call Supabase or Vercel.
 */
import { readFileSync } from "node:fs";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const names = readFileSync(new URL("../../src/mockups/owner/owner-team.ts", import.meta.url), "utf8");
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
  "R299",
  "health score",
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];
await mkdir(outDir, { recursive: true });

async function shot(name: string, width: number, height: number, path: string, prepare?: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const leaked: string[] = [];
  page.setDefaultTimeout(15000);
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/functions/v1/") || url.includes("supabase.co") || url.includes("vercel.com")) leaked.push(url);
  });
  page.on("pageerror", (error) => console.error(`[pageerror] ${name}: ${error.message}`));
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("[data-owner-ready='true']", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  if (prepare) await prepare(page);
  const text = await page.locator("body").innerText();
  for (const word of banned) {
    if (text.toLowerCase().includes(word.toLowerCase())) throw new Error(`${name} shows banned copy: ${word}`);
  }
  const free = text.includes("Free when your accountant joins");
  if (path.includes("screen=first") && !free) throw new Error(`${name} is missing the free line`);
  if (!path.includes("screen=first") && free && !path.includes("joined=0")) {
    throw new Error(`${name} shows the free line outside the invite`);
  }
  if (leaked.length) throw new Error(`${name} called the network: ${leaked.join(", ")}`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  if (overflow) throw new Error(`${name} scrolls sideways`);
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file });
  written.push(file);
  await page.close();
}

async function recordMotion(variant: "orb" | "character") {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: "/tmp/owner-v2-video", size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  await page.goto(`${base}/owner-mockup?screen=states&avatars=${variant}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-owner-ready='true']");
  await page.waitForTimeout(6500);
  const video = page.video();
  await page.close();
  await context.close();
  if (!video) throw new Error(`no video for ${variant}`);
  const src = await video.path();
  const dest = `${outDir}/owner-v2-${variant}-motion.webm`;
  await copyFile(src, dest);
  await unlink(src);
  const info = await stat(dest);
  if (info.size > 15 * 1024 * 1024) throw new Error(`${dest} is over 15 MB`);
  if (info.size < 1000) throw new Error(`${dest} looks empty`);
  written.push(dest);
}

const homePrepare = async (page: Page) => {
  for (const heading of [
    "Cash over the next 13 weeks",
    "Who owes you",
    "Am I making money",
    "What needs your answer",
    "What your accountant signed",
  ]) {
    await page.getByRole("heading", { name: heading }).waitFor();
  }
  await page.getByRole("button", { name: "Team", exact: true }).waitFor();
  await page.getByRole("button", { name: "Actions", exact: true }).waitFor();
  await page.getByRole("button", { name: "Accountant", exact: true }).waitFor();
  await page.getByRole("button", { name: "Deliverables", exact: true }).waitFor();
  await page.getByRole("button", { name: "Owner menu" }).waitFor();
  await page.getByText("From the books, 13-week forecast").waitFor();
  await page.getByText("Not the bank.").waitFor();
  if ((await page.getByText("Signed off ✓").count()) < 1) throw new Error("signed promise is missing Signed off");
};

const shots: { name: string; path: string; prepare?: (page: Page) => Promise<void> }[] = [
  { name: "owner-v2-home-orb", path: "/owner-mockup?screen=home&avatars=orb", prepare: homePrepare },
  { name: "owner-v2-home-character", path: "/owner-mockup?screen=home&avatars=character", prepare: homePrepare },
  {
    name: "owner-v2-chat",
    path: "/owner-mockup?screen=bot&bot=financial_manager&avatars=orb&talk=open",
    prepare: async (page) => {
      await page.getByText("Will we make payroll in November?").waitFor();
      await page.getByText("Not from the cash on the books.").waitFor();
      await page.getByText("From the books, 13-week forecast").waitFor();
      await page.getByRole("button", { name: "Assign the Atlantic Fit-out call" }).waitFor();
      await page.getByRole("button", { name: "Record" }).waitFor();
    },
  },
  {
    name: "owner-v2-recording",
    path: "/owner-mockup?screen=bot&bot=financial_manager&avatars=orb&talk=recording",
    prepare: async (page) => {
      await page.locator("[data-recording='true']").waitFor();
      await page.locator(".owner-wave").waitFor();
      await page.getByRole("button", { name: "Stop" }).waitFor();
    },
  },
  {
    name: "owner-v2-transcript",
    path: "/owner-mockup?screen=bot&bot=financial_manager&avatars=orb&talk=transcript",
    prepare: async (page) => {
      await page.locator("[data-transcript='true']").waitFor();
      await page.getByText("Edit this, then send.").waitFor();
      const value = await page.locator("#owner-composer").inputValue();
      if (value !== "Will we make payroll in November?") throw new Error(`transcript was ${value}`);
      if (await page.getByRole("button", { name: "Send" }).isDisabled()) throw new Error("send stayed disabled");
    },
  },
  {
    name: "owner-v2-actions",
    path: "/owner-mockup?screen=actions&avatars=orb",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Action points" }).waitFor();
      await page.getByRole("button", { name: /Johan Pietersen/ }).waitFor();
    },
  },
  {
    name: "owner-v2-accountant",
    path: "/owner-mockup?screen=accountant&avatars=orb",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Your accountant" }).waitFor();
      await page.getByRole("button", { name: "Upload" }).first().waitFor();
      await page.getByText("Thandiwe Khumalo").waitFor();
    },
  },
  {
    name: "owner-v2-deliverables",
    path: "/owner-mockup?screen=deliverables&avatars=orb",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Deliverables" }).waitFor();
      await page.getByText("Signed off ✓").first().waitFor();
      await page.getByText("Invite your accountant to sign off").waitFor();
      if ((await page.getByText("Signed off ✓").count()) < 2) throw new Error("expected two signed deliverables");
    },
  },
  {
    name: "owner-v2-first-run",
    path: "/owner-mockup?screen=first&avatars=orb",
    prepare: async (page) => {
      await page.getByRole("button", { name: /QuickBooks/ }).waitFor();
      await page.getByRole("button", { name: /Xero/ }).waitFor();
      await page.getByRole("heading", { name: "Invite your accountant" }).waitFor();
      await page.getByText("Free when your accountant joins Milōn").waitFor();
      await page.getByText("Not the bank.").waitFor();
    },
  },
  {
    name: "owner-v2-plan",
    path: "/owner-mockup?screen=plan&avatars=orb",
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Plan" }).waitFor();
      await page.getByText("Owner plan · included — Kloof & Partners is on Milōn").waitFor();
      if ((await page.getByText("Free when your accountant joins").count()) !== 0) {
        throw new Error("free line is on the plan view");
      }
    },
  },
  {
    name: "owner-v2-states-orb",
    path: "/owner-mockup?screen=states&avatars=orb",
    prepare: async (page) => {
      for (const label of ["Idle", "Working", "Found something", "Speaking", "Listening", "Hand-off"]) {
        await page.getByText(label, { exact: label !== "Hand-off" }).first().waitFor();
      }
      const motions = await page.locator("[data-motion]").count();
      if (motions < 15) throw new Error(`expected every orb state, saw ${motions}`);
    },
  },
  {
    name: "owner-v2-states-character",
    path: "/owner-mockup?screen=states&avatars=character",
    prepare: async (page) => {
      await page.getByText("Analyst looks toward Advisor.").waitFor();
      const faces = await page.locator("[data-avatar='character']").count();
      if (faces < 15) throw new Error(`expected every character state, saw ${faces}`);
    },
  },
];

for (const item of shots) {
  await shot(`${item.name}-1280`, 1280, 800, item.path, item.prepare);
  await shot(`${item.name}-390`, 390, 844, item.path, async (page) => {
    if (item.prepare) await item.prepare(page);
    if (item.name.startsWith("owner-v2-home") || item.name === "owner-v2-actions") {
      const short = await page.locator("[data-short-label]").evaluateAll((nodes) =>
        nodes.some((node) => getComputedStyle(node).display !== "none" && (node.textContent ?? "").includes("Fin. Manager")),
      );
      if (!short) throw new Error("mobile is missing Fin. Manager");
    }
  });
}

const flow = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await flow.goto(`${base}/owner-mockup?screen=home&avatars=orb`, { waitUntil: "domcontentloaded" });
await flow.waitForSelector("[data-owner-ready='true']");
await flow.locator(".owner-agent").filter({ hasText: "Ask Financial Manager" }).click();
await flow.waitForFunction(() => location.search.includes("screen=bot") && location.search.includes("financial_manager"));
await flow.getByRole("button", { name: "Record" }).click();
await flow.waitForFunction(() => location.search.includes("talk=recording"));
await flow.locator(".owner-wave").waitFor();
await flow.getByRole("button", { name: "Stop" }).click();
await flow.waitForFunction(() => location.search.includes("talk=transcript"));
await flow.waitForFunction(() => {
  const field = document.querySelector("#owner-composer");
  return field instanceof HTMLTextAreaElement && field.value === "Will we make payroll in November?";
});
await flow.getByRole("button", { name: "Owner menu" }).click();
await flow.getByRole("menuitem", { name: "Plan" }).click();
await flow.getByText("Owner plan · included — Kloof & Partners is on Milōn").waitFor();
await flow.goto(`${base}/owner-mockup?screen=first&avatars=orb`);
await flow.getByRole("button", { name: /QuickBooks/ }).click();
await flow.getByText("QuickBooks connected for Harbour Glass.").waitFor();
await flow.locator("#owner-accountant-email").fill("thandiwe@kloof.example");
await flow.getByRole("button", { name: "Send invite" }).click();
await flow.getByText("Invite noted. Nothing was sent from this mockup.").waitFor();
await flow.getByRole("button", { name: "Owner menu" }).click();
await flow.getByRole("menuitem", { name: "Plan" }).click();
await flow.getByText("Owner plan · R299/mo", { exact: true }).waitFor();
if ((await flow.getByText("Free when your accountant joins").count()) !== 0) {
  throw new Error("free line leaked onto the unpaid plan");
}
await flow.getByRole("button", { name: "Accountant", exact: true }).click();
await flow.getByText("Free when your accountant joins Milōn").waitFor();
if ((await flow.getByText("Signed off").count()) !== 0) throw new Error("empty accountant seat says Signed off");
await flow.close();

await recordMotion("orb");
await recordMotion("character");
await browser.close();
console.log(written.join("\n"));
