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
import {
  createMemoryProspectStore,
  handleProspectRequest,
  type ProspectHandlerCtx,
} from "../src/lib/prospect-talk-handler";

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

function talkCtx(country: "US" | "ZA", ip: string): ProspectHandlerCtx {
  const memory = createMemoryProspectStore();
  return {
    now: new Date("2026-10-20T12:00:00.000Z"),
    ip,
    geoCountry: country,
    ipSalt: "browser-geo",
    store: memory.store,
    model: async () => "The sample is a labelled walk-through.",
    claimAlert: async () => true,
    sendAlert: async () => ({ ok: true }),
  };
}

/** In-chat price. The POST is the real handler, with the edge country mocked. */
async function answerTalk(page: Page, country: "US" | "ZA", ip: string) {
  const talk = talkCtx(country, ip);
  await page.route("**/functions/v1/prospect-talk", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const result = await handleProspectRequest(body, talk);
    await route.fulfill({
      status: result.status,
      contentType: "application/json",
      body: JSON.stringify(result.body),
    });
  });
}

const PRICE_QUESTION = "How much does it cost?";

/** The composer is enabled, and this form node has not been replaced. */
async function waitComposerSettled(page: Page) {
  await page.waitForFunction(
    () => {
      const form = document.querySelector("form.talk-composer");
      const button = form?.querySelector(".talk-send");
      if (!(form instanceof HTMLFormElement)) return false;
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      if (!(button.textContent ?? "").includes("Send")) return false;
      const mark = window as Window & { __talkPriceForm?: Element; __talkPriceAt?: number };
      const now = performance.now();
      if (mark.__talkPriceForm !== form) {
        mark.__talkPriceForm = form;
        mark.__talkPriceAt = now;
        return false;
      }
      return now - (mark.__talkPriceAt ?? now) > 1_200;
    },
    undefined,
    { timeout: 45_000 },
  );
}

/**
 * Ask the price and return the agent bubble once the reply has stayed.
 * The signed-in shell (and a late route refresh) remounts the thread and
 * drops the message just sent, so a wiped reply is asked again.
 */
async function askPrice(page: Page, price: string): Promise<string> {
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitComposerSettled(page);
    const already = page.locator(".talk-bubble-you", { hasText: PRICE_QUESTION });
    if ((await already.count()) === 0) {
      await page.locator("textarea").fill(PRICE_QUESTION);
      await page.locator(".talk-send").click();
    }
    const bubble = page.locator(".talk-bubble-agent", { hasText: price }).last();
    try {
      await bubble.waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1_200);
      if ((await bubble.count()) > 0) return await bubble.innerText();
    } catch {
      /* the remount dropped the reply */
    }
    lastBody = await page.locator("body").innerText().catch(() => "");
  }
  console.error("price chat body", lastBody.slice(0, 1500));
  throw new Error(`the ${price} reply did not stay on the page`);
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
  await page.locator(".talk-send", { hasText: "Send" }).waitFor({ state: "visible", timeout: 20_000 });
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
  if (after.disabled !== false || after.value !== FIRST) {
    console.error("after hydration", JSON.stringify(after));
    console.error("pageErrors", pageErrors);
    throw new Error(
      `composer after hydration: disabled=${String(after.disabled)} value=${JSON.stringify(after.value)}`,
    );
  }
  await page.locator(".talk-send").click();
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
  await page.locator("[data-talk-lead]").waitFor({ state: "visible", timeout: 10_000 });
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
  await zaPage.goto(`${BASE}/talk/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await zaPage.getByText("Tax Specialist").waitFor({ timeout: 15_000 });
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
  await answerTalk(zaPage, "ZA", "203.0.113.91");
  await zaPage.goto(`${BASE}/talk/financial-manager`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await zaPage.locator(".talk-chip").first().waitFor({ timeout: 20_000 });
  const zaChat = await askPrice(zaPage, "R299/mo");
  assert(zaChat.includes("R299/mo"), "ZA chat prices the starter plan in rand");
  assert(!zaChat.includes("$"), "ZA chat price has no dollar sign");
  assert(!/\bvat\b/i.test(zaChat), "ZA chat price does not say VAT");
  assert(
    (await zaPage.locator(".talk-chip").count()) === 0,
    "starter chips hide after the visitor sends",
  );
  const zaOffered = await zaPage.locator(".talk-questions").innerText();
  assert(
    zaOffered.includes("What does the business do?"),
    "the greeting still lists the starter questions once",
  );
  await shot(zaPage, "talk-za-price-chat");
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
  assert(usText.includes("Accountants:"), "US geo labels the accountant plan");
  assert(usText.includes("Business owners:"), "US geo labels the owner plan");
  assert(usText.includes("$39"), "US geo shows the USD price");
  assert(!/R\s*\d/.test(usText), "US geo shows no rand amount");
  assert(!usText.includes("ZAR"), "US geo does not say ZAR");
  assert(!/\bvat\b/i.test(usText), "US geo does not say VAT");
  await shot(usPage, "talk-geo-us");
  await answerTalk(usPage, "US", "203.0.113.92");
  await usPage.goto(`${BASE}/talk/financial-manager`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const usChat = await askPrice(usPage, "$39/mo");
  assert(usChat.includes("$39/mo"), "US chat prices the starter plan in dollars");
  assert(
    (await usPage.locator(".talk-chip").count()) === 0,
    "starter chips hide after the visitor sends",
  );
  assert(!/\brand\b/i.test(usChat), "US chat price does not say rand");
  assert(!/R\s*\d/.test(usChat), "US chat price has no rand amount");
  assert(!usChat.includes("ZAR"), "US chat price does not say ZAR");
  assert(!/\bvat\b/i.test(usChat), "US chat price does not say VAT");
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
