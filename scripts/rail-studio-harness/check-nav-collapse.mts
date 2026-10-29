/**
 * Collapsible accountant rail. Expects the harness on 127.0.0.1:4179 (pnpm harness:dev).
 * Run: pnpm test:nav-collapse
 */
import { chromium, type Page } from "playwright";

const base = "http://127.0.0.1:4179";
const pages = [
  "/milon-team-desk?fixture=live&agent=advisor",
  "/milon-team-desk?fixture=live&agent=financial_manager",
  "/clients/harness-client?tab=cash",
];

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function mainWidth(page: Page): Promise<number> {
  const box = await page.locator(".deliverable-main").first().boundingBox();
  if (!box) fail("the main column is missing");
  return box.width;
}

async function clipped(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".deliverable-main");
    if (!main) return "no main";
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      return "the page scrolls sideways";
    if (main.scrollWidth > main.clientWidth + 1) return "the main column overflows";
    return null;
  });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const path of pages) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".accountant-nav .nav-collapse", { timeout: 15000 });
  await page.waitForTimeout(300);
  const open = await mainWidth(page);
  const hide = page.getByRole("button", { name: "Hide menu" });
  if ((await hide.getAttribute("title"))?.startsWith("Hide menu") !== true)
    fail("Hide menu has no tooltip");
  await hide.click();
  await page.waitForTimeout(400);
  const shut = await mainWidth(page);
  const gained = shut - open;
  if (Math.abs(gained - 176) > 6)
    fail(`${path}: collapsing gained ${gained}px, expected about 176`);
  const rail = await page.locator(".accountant-nav").boundingBox();
  if (!rail || Math.abs(rail.width - 56) > 1) fail(`${path}: the strip is ${rail?.width}px wide`);
  const why = await clipped(page);
  if (why) fail(`${path} collapsed: ${why}`);
  const titled = await page
    .locator(".accountant-nav .nav-label")
    .evaluateAll((links) => links.every((link) => !!link.getAttribute("title")));
  if (!titled) fail(`${path}: a collapsed nav icon has no tooltip`);
  const icons = await page
    .locator(".accountant-nav .nav-label .nav-ic")
    .evaluateAll((els) => els.every((el) => el.getBoundingClientRect().width > 0));
  if (!icons) fail(`${path}: a collapsed nav row lost its icon`);
  const show = page.getByRole("button", { name: "Show menu" });
  if ((await show.count()) !== 1) fail(`${path}: the expand button is missing from the strip`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".accountant-nav .nav-collapse");
  await page.waitForTimeout(300);
  if (Math.abs((await mainWidth(page)) - shut) > 1)
    fail(`${path}: reload lost the collapsed state`);

  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await page.keyboard.press("[");
  await page.waitForTimeout(400);
  if (Math.abs((await mainWidth(page)) - open) > 1) fail(`${path}: [ did not expand the rail`);
  const why2 = await clipped(page);
  if (why2) fail(`${path} expanded: ${why2}`);

  const field = page
    .locator("#ask-ai-accountant textarea, input[type='text'], input:not([type])")
    .first();
  if ((await field.count()) > 0 && (await field.isVisible())) {
    await field.focus();
    await page.keyboard.press("[");
    await page.waitForTimeout(250);
    if (Math.abs((await mainWidth(page)) - open) > 1)
      fail(`${path}: [ toggled the rail while typing`);
  }

  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await page.locator(".accountant-nav .nav-collapse").focus();
  const focusRing = await page.locator(".accountant-nav .nav-collapse").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.outlineStyle !== "none" && style.outlineWidth !== "0px";
  });
  if (!focusRing) fail(`${path}: the collapse button has no focus outline`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await page.keyboard.press("Tab");
  const next = await page.evaluate(
    () => document.activeElement?.closest(".accountant-nav") !== null,
  );
  if (!next) fail(`${path}: Tab from the strip button left the rail`);
  await context.close();
  console.log(`ok ${path}`);
}

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${base}${pages[0]}`, { waitUntil: "domcontentloaded" });
await phone.waitForSelector("[data-agent-stage]");
const visible = await phone.locator(".accountant-nav .nav-collapse").isVisible();
if (visible) fail("the collapse button shows on a phone");
await browser.close();
console.log("nav-collapse: the rail collapses, remembers, and toggles with [");
