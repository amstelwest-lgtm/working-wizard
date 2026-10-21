/**
 * Real browser. The first send happens before hydration and before a session
 * exists. The prospect-talk POST is mocked, so this does not create a lead
 * or send mail.
 *
 * Sends wait until the composer is hydrated (Send enabled, not "Connecting…")
 * and until the mocked POST responds. Enter and click do nothing while the
 * previous reply is still in flight. HMR is off so a route-tree rewrite
 * cannot reload the page between those waits.
 *
 *   pnpm test:prospect-talk-browser
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { chromium, type Browser, type Page, type Response } from "playwright";

const PORT = 5211;
const BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = "/opt/cursor/artifacts";
const FIRST = "Cash before the page is ready";
const REPLY = "The queued reply is on the page.";
const STEP_MS = 30_000;

let server: ChildProcess | null = null;
let browser: Browser | null = null;
let releaseScripts: (() => void) | null = null;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function stopServer() {
  const child = server;
  server = null;
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function startServer() {
  const fd = openSync("/tmp/prospect-talk-browser-vite.log", "w");
  const env = {
    ...process.env,
    MILON_DEV_GEO: "",
    MILON_DISABLE_HMR: "1",
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
        if (text.includes("talk-composer") && text.includes("Connecting")) return;
        last = "200 without the connecting composer";
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

/** Send is enabled and no longer the pre-hydration "Connecting…" label. */
async function waitComposerReady(page: Page) {
  await page.waitForFunction(
    () => {
      const button = document.querySelector("button.talk-send");
      if (!(button instanceof HTMLButtonElement)) return false;
      const label = (button.textContent ?? "").replace(/\s+/g, " ").trim();
      return button.disabled === false && label === "Send";
    },
    undefined,
    { timeout: STEP_MS },
  );
}

/**
 * Arm the response wait before the click or key, then perform it.
 * Playwright matches the next POST, so this must run only after the previous
 * mocked reply has already been awaited.
 */
async function sendAndWait(page: Page, trigger: () => Promise<unknown>): Promise<Response> {
  const response = page.waitForResponse(
    (res) =>
      res.url().includes("/functions/v1/prospect-talk") && res.request().method() === "POST",
    { timeout: STEP_MS },
  );
  await trigger();
  return response;
}

async function main() {
  startServer();
  await waitForTalk();
  browser = await launch();
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
    timeout: STEP_MS,
  });
  await page.locator("textarea").waitFor({ state: "visible", timeout: STEP_MS });
  const earlyHtml = await page.content();
  assert(earlyHtml.includes('type="button"'), "Send is not a native submit");
  assert(earlyHtml.includes("disabled"), "Send is disabled before hydration");
  assert(earlyHtml.includes("Connecting"), "Send shows Connecting before hydration");
  assert(!earlyHtml.includes('data-talk-live="1"'), "the composer is not live before hydration");
  assert(earlyHtml.includes('data-talk-session="pending"'), "no session is ready before hydration");
  await page.locator("textarea").fill(FIRST);
  await page.locator(".talk-send").click({ force: true });
  assert(page.url().includes("/talk/financial-manager"), "Send does not navigate away");
  assert(!page.url().includes(encodeURIComponent(FIRST)), "the text is not dropped into the query");
  assert(posts.length === 0, "nothing is posted before hydration or a session");
  assert((await page.locator("textarea").inputValue()) === FIRST, "the typed text stays in the textarea");

  release();
  await waitComposerReady(page);
  const after = await page.evaluate(() => {
    const button = document.querySelector(".talk-send");
    const area = document.querySelector("textarea");
    return {
      buttonText: button?.textContent ?? "",
      disabled: button instanceof HTMLButtonElement ? button.disabled : null,
      value: area instanceof HTMLTextAreaElement ? area.value : null,
      live: document.querySelector("form.talk-composer")?.getAttribute("data-talk-live") ?? "",
      errors: "",
    };
  });
  if (after.disabled !== false || after.value !== FIRST || !after.buttonText?.includes("Send")) {
    console.error("after hydration", JSON.stringify(after));
    console.error("pageErrors", pageErrors);
    throw new Error(
      `composer after hydration: disabled=${String(after.disabled)} value=${JSON.stringify(after.value)} label=${JSON.stringify(after.buttonText)}`,
    );
  }
  assert(!after.buttonText.includes("Connecting"), "Send is still connecting after hydration");
  try {
    await sendAndWait(page, () => page.locator(".talk-send").click());
    await page.getByText(REPLY).waitFor({ state: "visible", timeout: STEP_MS });
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
    "the You bubble appears after the enabled Send",
  );
  assert(posts.length === 1, "one click posts the message once");
  assert(posts[0]?.action === "turn", "the first send is a turn");
  assert(posts[0]?.message === FIRST, "the posted text is what was typed");
  assert(posts[0]?.agent === "financial-manager", "the post is for the financial manager");
  assert(
    !pageErrors.some((error) => /hydration failed/i.test(error)),
    `hydration mismatch:\n${pageErrors.join("\n")}`,
  );

  await waitComposerReady(page);
  await page.locator('form.talk-composer[data-talk-live="1"]').waitFor({ timeout: STEP_MS });
  await page.locator("textarea").fill("Enter sends this");
  await sendAndWait(page, () => page.locator("textarea").press("Enter"));
  await page.locator(".talk-bubble-you", { hasText: "Enter sends this" }).waitFor({
    state: "visible",
    timeout: STEP_MS,
  });
  assert(
    posts.some((post) => post.message === "Enter sends this"),
    "Enter sends the message",
  );
  const beforeShift = posts.length;
  await waitComposerReady(page);
  await page.locator("textarea").click();
  await page.keyboard.type("ShiftKeep");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("SecondLine");
  const shifted = await page.locator("textarea").inputValue();
  assert(shifted === "ShiftKeep\nSecondLine", "Shift+Enter inserts a newline");
  assert(posts.length === beforeShift, "Shift+Enter does not send");
  await sendAndWait(page, () => page.locator(".talk-send").click());
  await page.locator(".talk-bubble-you", { hasText: "SecondLine" }).waitFor({
    state: "visible",
    timeout: STEP_MS,
  });
  assert(
    posts.some((post) => post.message === "ShiftKeep\nSecondLine"),
    "the newline message sends on click",
  );

  await waitComposerReady(page);
  await page.locator("textarea").fill("Please open the form");
  await sendAndWait(page, () => page.locator(".talk-send").click());
  await page.locator("[data-talk-lead]").waitFor({ state: "visible", timeout: STEP_MS });
  const gateText = await page.locator("[data-talk-lead]").innerText();
  assert(gateText.includes("Your name and email"), "the gate is labelled");
  assert(gateText.includes("No password"), "the gate says there is no password");
  assert((await page.locator("[data-talk-skip]").count()) === 0, "the gate cannot be skipped");
  assert((await page.locator('input[type="password"]').count()) === 0, "the gate has no password");
  assert(!posts.some((post) => post.action === "lead"), "opening the form does not post a lead");

  await page.close();

  const za = await browser.newContext({
    extraHTTPHeaders: { "x-vercel-ip-country": "ZA" },
  });
  const zaPage = await za.newPage();
  await zaPage.goto(`${BASE}/talk/`, { waitUntil: "domcontentloaded", timeout: STEP_MS });
  await zaPage.getByText("Tax Specialist").waitFor({ timeout: STEP_MS });
  const zaText = await zaPage.locator("body").innerText();
  assert(zaText.includes("Four agents"), "ZA geo lists four agents");
  assert(zaText.includes("Tax Specialist"), "ZA geo lists the Tax Specialist");
  assert(zaText.includes("Accountants:"), "ZA geo labels the accountant plan");
  assert(zaText.includes("Business owners:"), "ZA geo labels the owner plan");
  assert(zaText.includes("R299"), "ZA geo shows the rand amount without a space");
  assert(!zaText.includes("R 299"), "ZA geo does not leave a breakable space in the rand amount");
  assert(!/\bvat\b/i.test(zaText), "ZA geo does not say VAT");
  assert(!zaText.includes("$39"), "ZA geo does not show the US price");
  await shot(zaPage, "talk-geo-za");
  await zaPage.goto(`${BASE}/talk/tax-specialist`, {
    waitUntil: "domcontentloaded",
    timeout: STEP_MS,
  });
  await zaPage.locator("textarea").waitFor({ timeout: STEP_MS });
  await za.close();

  const us = await browser.newContext({
    extraHTTPHeaders: { "x-vercel-ip-country": "US" },
  });
  const usPage = await us.newPage();
  await usPage.goto(`${BASE}/talk/`, { waitUntil: "domcontentloaded", timeout: STEP_MS });
  await usPage.getByText("Three agents").waitFor({ timeout: STEP_MS });
  const usText = await usPage.locator("body").innerText();
  assert(usText.includes("Three agents"), "US geo lists three agents");
  assert(!usText.includes("Tax Specialist"), "US geo hides the Tax Specialist");
  assert(usText.includes("Accountants:"), "US geo labels the accountant plan");
  assert(usText.includes("Business owners:"), "US geo labels the owner plan");
  assert(usText.includes("$39"), "US geo shows the USD price");
  assert(!/R\s*\d/.test(usText), "US geo shows no rand amount");
  assert(!usText.includes("ZAR"), "US geo does not say ZAR");
  assert(!/\bvat\b/i.test(usText), "US geo does not say VAT");
  await shot(usPage, "talk-geo-us");
  await usPage.goto(`${BASE}/talk/tax-specialist`, {
    waitUntil: "domcontentloaded",
    timeout: STEP_MS,
  });
  await usPage
    .getByText("The Tax Specialist covers South African tax")
    .waitFor({ timeout: STEP_MS });
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
}

main()
  .then(() => {
    console.log("prospect-talk-browser: ok");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    releaseScripts?.();
    await Promise.race([
      browser?.close().catch(() => {}) ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    browser = null;
    stopServer();
    process.exit(process.exitCode ?? 0);
  });
