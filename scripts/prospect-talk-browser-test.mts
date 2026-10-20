/**
 * Real browser. The first send happens before hydration and before a session
 * exists. The prospect-talk POST is mocked, so this does not create a lead
 * or send mail.
 *
 *   pnpm test:prospect-talk-browser
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

const PORT = 5211;
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = "/opt/cursor/artifacts";
const FIRST = "Cash before the page is ready";
const REPLY = "The queued reply is on the page.";

let server: ChildProcess | null = null;
let releaseScripts: (() => void) | null = null;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    try {
      server.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  server = null;
}

function startServer() {
  const fd = openSync("/tmp/prospect-talk-browser-vite.log", "w");
  const env = {
    ...process.env,
    MILON_DEV_GEO: "",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };
  server = spawn(
    "pnpm",
    ["exec", "vite", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { env, detached: true, stdio: ["ignore", fd, fd] },
  );
  process.on("exit", stopServer);
}

async function waitForTalk() {
  const deadline = Date.now() + 90_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/talk/financial-manager`, {
        headers: { "x-vercel-ip-country": "US" },
      });
      if (res.status === 200) {
        const text = await res.text();
        if (text.includes("talk-composer") && text.includes("milon-talk-early")) return;
        last = "200 without the composer boot script";
      } else last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`talk did not come up at ${BASE} (${last})`);
}

function holdModule(url: string, type: string): boolean {
  if (type === "document" || type === "stylesheet" || type === "image" || type === "font") {
    return false;
  }
  return (
    url.includes("/src/") ||
    url.includes("/node_modules/") ||
    url.includes("/@") ||
    url.includes("/__vite")
  );
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function shot(page: Page, name: string) {
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: `${ARTIFACTS}/${name}.png`, fullPage: true });
}

async function main() {
  startServer();
  await waitForTalk();
  const browser = await launch();
  const posts: Record<string, unknown>[] = [];
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
    releaseScripts = resolve;
  });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.url().includes("/functions/v1/prospect-talk")) {
      await route.fallback();
      return;
    }
    if (holdModule(req.url(), req.resourceType())) await scripts;
    await route.continue();
  });
  await page.route("**/functions/v1/prospect-talk", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    const message = typeof body.message === "string" ? body.message : "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reply: REPLY,
        sessionToken: "e2e-session",
        askLead: message === "Please open the form",
      }),
    });
  });

  await page.goto(`${BASE}/talk/financial-manager`, {
    waitUntil: "commit",
    timeout: 30_000,
  });
  await page.locator("textarea").waitFor({ state: "visible", timeout: 20_000 });
  const earlyHtml = await page.content();
  assert(earlyHtml.includes("milon-talk-early"), "the server HTML includes the boot script");
  assert(!earlyHtml.includes('data-talk-live="1"'), "the composer is not live before hydration");
  assert(earlyHtml.includes('data-talk-session="pending"'), "no session is ready before hydration");
  await page.locator("textarea").fill(FIRST);
  await page.locator(".talk-send").click();
  await page.locator(".talk-bubble-you").waitFor({ state: "visible", timeout: 5_000 });
  const immediate = await page.locator(".talk-bubble-you").innerText();
  assert(immediate.includes(FIRST), "the You bubble is on screen before hydration");
  assert(page.url().includes("/talk/financial-manager"), "Send does not navigate away");
  assert(!page.url().includes(encodeURIComponent(FIRST)), "the text is not dropped into the query");
  assert(posts.length === 0, "nothing is posted before hydration or a session");

  release();
  try {
    await page.getByText(REPLY).waitFor({ state: "visible", timeout: 30_000 });
  } catch (err) {
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    console.error("posts", JSON.stringify(posts));
    console.error("pageErrors", pageErrors);
    console.error("body", text.slice(0, 1500));
    throw err;
  }
  const bubbles = await page.locator(".talk-bubble-you").allInnerTexts();
  assert(
    bubbles.some((text) => text.includes(FIRST)),
    "the You bubble is still there after hydration",
  );
  assert(posts.length === 1, "the first message posts once the page is ready");
  assert(posts[0]?.action === "turn", "the first send is a turn");
  assert(posts[0]?.message === FIRST, "the posted text is what was typed");
  assert(posts[0]?.agent === "financial-manager", "the post is for the financial manager");
  assert(
    !pageErrors.some((error) => /hydration failed/i.test(error)),
    `hydration mismatch:\n${pageErrors.join("\n")}`,
  );

  await page.locator('form.talk-composer[data-talk-live="1"]').waitFor({ timeout: 15_000 });
  await page.locator("textarea").fill("Enter sends this");
  await page.locator("textarea").press("Enter");
  await page.locator(".talk-bubble-you", { hasText: "Enter sends this" }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  assert(
    posts.some((post) => post.message === "Enter sends this"),
    "Enter sends the message",
  );
  const beforeShift = posts.length;
  await page.locator("textarea").click();
  await page.keyboard.type("ShiftKeep");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("SecondLine");
  const shifted = await page.locator("textarea").inputValue();
  assert(shifted === "ShiftKeep\nSecondLine", "Shift+Enter inserts a newline");
  assert(posts.length === beforeShift, "Shift+Enter does not send");
  await page.locator(".talk-send").click();
  await page.locator(".talk-bubble-you", { hasText: "SecondLine" }).waitFor({ timeout: 10_000 });
  assert(
    posts.some((post) => post.message === "ShiftKeep\nSecondLine"),
    "the newline message sends on click",
  );

  await page.locator("textarea").fill("Please open the form");
  await page.locator(".talk-send").click();
  await page.locator("[data-talk-skip]").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("[data-talk-skip]").click();
  await page.locator("textarea").waitFor({ state: "visible", timeout: 5_000 });
  assert(!posts.some((post) => post.action === "lead"), "skip does not post a lead");

  await page.close();

  const za = await browser.newContext({
    extraHTTPHeaders: { "x-vercel-ip-country": "ZA" },
  });
  const zaPage = await za.newPage();
  await zaPage.goto(`${BASE}/talk/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await zaPage.getByText("Tax Specialist").waitFor({ timeout: 15_000 });
  const zaText = await zaPage.locator("body").innerText();
  assert(zaText.includes("Four agents"), "ZA geo lists four agents");
  assert(zaText.includes("Tax Specialist"), "ZA geo lists the Tax Specialist");
  assert(/R\s*299/.test(zaText), "ZA geo shows rand pricing");
  assert(!zaText.includes("$39"), "ZA geo does not show the US price");
  await shot(zaPage, "talk-geo-za");
  await zaPage.goto(`${BASE}/talk/tax-specialist`, { waitUntil: "domcontentloaded" });
  await zaPage.locator("textarea").waitFor({ timeout: 15_000 });
  await za.close();

  const us = await browser.newContext({
    extraHTTPHeaders: { "x-vercel-ip-country": "US" },
  });
  const usPage = await us.newPage();
  await usPage.goto(`${BASE}/talk/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await usPage.getByText("Three agents").waitFor({ timeout: 15_000 });
  const usText = await usPage.locator("body").innerText();
  assert(usText.includes("Three agents"), "US geo lists three agents");
  assert(!usText.includes("Tax Specialist"), "US geo hides the Tax Specialist");
  assert(usText.includes("$39"), "US geo shows the USD price");
  assert(!/R\s*\d/.test(usText), "US geo shows no rand amount");
  await shot(usPage, "talk-geo-us");
  await usPage.goto(`${BASE}/talk/tax-specialist`, { waitUntil: "domcontentloaded" });
  await usPage
    .getByText("The Tax Specialist covers South African tax")
    .waitFor({ timeout: 15_000 });
  const closed = await usPage.locator("body").innerText();
  assert(
    closed.includes("Talk to the Financial Manager"),
    "the closed page links the financial manager",
  );
  assert(closed.includes("Talk to the Analyst"), "the closed page links the analyst");
  assert(closed.includes("Talk to the Advisor"), "the closed page links the advisor");
  assert(
    (await usPage.locator("textarea").count()) === 0,
    "the closed page does not load the agent",
  );
  assert(!/SARS|IRP6|ITR14/i.test(closed), "the closed page has no SARS terms");
  await us.close();

  await browser.close();
  stopServer();
  console.log("prospect-talk-browser: ok");
}

main().catch(async (err) => {
  console.error(err);
  releaseScripts?.();
  stopServer();
  process.exit(1);
});
