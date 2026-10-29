/**
 * Agent pages scroll as one page: the wheel moves the page with the pointer
 * over any card, the face, the hero, or the section links.
 * Expects the harness on 127.0.0.1:4179 (pnpm harness:dev).
 * Run: pnpm test:agent-wheel
 */
import { chromium, type Page } from "playwright";

const base = "http://127.0.0.1:4179";
const agents = (process.env.AGENTS ?? "financial_manager,analyst,advisor").split(",");
const sizes = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function pageScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement?.scrollTop ?? 0;
    const main = document.querySelector<HTMLElement>(".deliverable-main")?.scrollTop ?? 0;
    return root + main;
  });
}

async function innerScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const stage = document.querySelector("[data-agent-stage]");
    if (!stage) return ["no agent stage"];
    for (const el of document.querySelectorAll<HTMLElement>(
      ".deliverable-main, .deliverable-main *",
    )) {
      if (el.closest(".ask-ai-thread") && !el.classList.contains("ask-ai-thread")) continue;
      const style = getComputedStyle(el);
      const scrolls =
        /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
      if (scrolls && !el.classList.contains("ask-ai-thread")) {
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
      }
      if (style.overscrollBehaviorY === "contain" || style.overscrollBehaviorY === "none") {
        out.push(`overscroll ${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
      }
    }
    return out;
  });
}

async function wheelOver(page: Page, selector: string, label: string) {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) fail(`${label}: ${selector} is missing`);
  await page.evaluate(() => {
    document.scrollingElement?.scrollTo(0, 0);
    document.querySelector<HTMLElement>(".deliverable-main")?.scrollTo(0, 0);
  });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) fail(`${label}: ${selector} has no box`);
  const before = await pageScroll(page);
  const atEnd = await page.evaluate(() => {
    const root = document.scrollingElement;
    return !!root && root.scrollTop + window.innerHeight >= root.scrollHeight - 1;
  });
  const dy = atEnd ? -600 : 600;
  await page.mouse.move(box.x + Math.min(box.width / 2, 40), box.y + Math.min(box.height / 2, 20));
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(250);
  const after = await pageScroll(page);
  const moved = dy > 0 ? after > before : after < before;
  if (!moved)
    fail(`${label}: the wheel over ${selector} did not move the page (${before} → ${after})`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const size of sizes) {
  for (const agent of agents) {
    const label = `${agent} @ ${size.width}×${size.height}`;
    const page = await browser.newPage({ viewport: size });
    await page.goto(`${base}/milon-team-desk?fixture=live&agent=${agent}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(`[data-agent-stage="${agent}"]`, { timeout: 10000 });
    await page.waitForSelector("#ask-ai-accountant textarea", { timeout: 10000 });
    const extra = await innerScrollers(page);
    if (extra.length) fail(`${label}: nested scroll areas on the agent page: ${extra.join(", ")}`);
    const tall = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    if (!tall)
      fail(`${label}: the page is not taller than the viewport, so the check proves nothing`);
    await wheelOver(page, ".milon-desk-card, .agent-section", `${label} first card`);
    await wheelOver(page, ".owner-presence", `${label} face`);
    await wheelOver(page, ".agent-stage-hero", `${label} hero`);
    await wheelOver(page, ".agent-work-link", `${label} section link`);
    await wheelOver(
      page,
      "#ask-ai-accountant .ask-ai-thread, #ask-ai-accountant textarea",
      `${label} chat`,
    );
    await page.close();
    console.log(`ok ${label}`);
  }
}
await browser.close();
console.log("agent-wheel: the page scrolls under the pointer on every agent page");
