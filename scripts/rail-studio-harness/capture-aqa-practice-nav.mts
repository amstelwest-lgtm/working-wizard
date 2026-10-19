/**
 * Local before/after shots for the accountant practice findings.
 * Expects the harness on 127.0.0.1:4179. Does not deploy.
 */
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const base = process.env.HARNESS_URL ?? "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots/aqa-practice-nav";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function shot(page: Page, name: string) {
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(file);
}

async function openShot(page: Page, name: string, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/aqa-practice-nav?shot=${name}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-shot="${name}"]`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await mkdir(outDir, { recursive: true });

await openShot(page, "before-nav", 1280);
const beforeHrefs = await page.locator("a").evaluateAll((nodes) =>
  nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")),
);
assert(beforeHrefs.every((href) => href?.includes("#")), "before nav is anchors");
await shot(page, "before-nav");

await openShot(page, "after-nav", 1280);
await page.getByRole("button", { name: "Expand Practice" }).click();
await page.getByRole("button", { name: "Expand Clients" }).click();
const afterHrefs = await page.locator(".accountant-nav a").evaluateAll((nodes) =>
  nodes.map((node) => {
    const href = (node as HTMLAnchorElement).getAttribute("href") ?? "";
    const url = new URL(href, "http://127.0.0.1");
    return `${url.pathname}${url.hash}`;
  }),
);
assert(afterHrefs.includes("/practice/needs-attention"), `needs attention missing in ${afterHrefs.join(" ")}`);
assert(afterHrefs.includes("/practice/follow-up"), "follow up is a route");
assert(afterHrefs.includes("/practice/insights"), "insights is a route");
assert(afterHrefs.includes("/practice/marketplace"), "marketplace is a route");
assert(afterHrefs.includes("/practice/playbooks"), "playbooks is a route");
assert(afterHrefs.includes("/clients/queries"), "open queries is a route");
assert(
  afterHrefs
    .filter((href) => href.startsWith("/practice/") || href === "/clients/queries")
    .every((href) => !href.includes("#")),
  "practice routes are not anchors",
);
await shot(page, "after-nav");

await openShot(page, "before-chart", 1280);
const blank = await page.locator(".ph-scatter-chart svg").count();
assert(blank === 0, "before chart has no plot");
await shot(page, "before-chart");

await openShot(page, "after-chart-empty", 1280);
const empty = (await page.locator(".ph-empty").textContent()) ?? "";
assert(empty.includes("No trend to plot yet"), empty);
assert((await page.locator(".ph-scatter-chart svg").count()) === 0, "empty chart invents no points");
await shot(page, "after-chart-empty");

await openShot(page, "after-chart", 1280);
assert((await page.locator(".ph-scatter-chart svg").count()) > 0, "real trend points draw");
await shot(page, "after-chart");

await openShot(page, "before-health", 1100, 700);
assert((await page.locator("[data-stray-pin]").count()) === 1, "before shows the stray T");
await shot(page, "before-health");

await openShot(page, "after-health", 1100, 700);
assert((await page.locator("[data-stray-pin]").count()) === 0, "an unplaced T is not drawn");
assert(((await page.locator("[data-hand-copy]").textContent()) ?? "").includes("by hand stays"), "the sentence stays");
await shot(page, "after-health");

await openShot(page, "before-menu", 390, 844);
const beforeRail = page.locator(".deliverable-rail");
const beforeTop = await beforeRail.evaluate((el) => el.scrollTop);
await beforeRail.hover();
await page.mouse.wheel(0, 500);
const beforeScrolled = await beforeRail.evaluate((el) => el.scrollTop);
assert(beforeScrolled === beforeTop, "before menu ignores the wheel");
await shot(page, "before-menu");

await openShot(page, "after-menu", 390, 844);
const afterRail = page.locator("#accountant-nav");
await afterRail.waitFor();
await page.locator(".nav-chev").first().click();
const top = await afterRail.evaluate((el) => el.scrollTop);
await afterRail.hover();
await page.mouse.wheel(0, 600);
await page.waitForTimeout(150);
const scrolled = await afterRail.evaluate((el) => el.scrollTop);
assert(scrolled > top, `after menu did not wheel-scroll (${top} -> ${scrolled})`);
await shot(page, "after-menu-scrolled");
await page.locator(".nav-sub-link").first().click();
await page.waitForSelector('[data-menu-open="false"]');
assert((await page.locator(".accountant-portal").getAttribute("class"))?.includes("nav-open") === false, "menu stayed open");
await shot(page, "after-menu-closed");

await browser.close();
console.log("aqa practice nav shots ok");
