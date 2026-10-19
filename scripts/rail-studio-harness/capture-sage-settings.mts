/**
 * Local before/after shots for Sage copy and settings billing.
 * Usage: HARNESS_BASE=... LANDING_BASE=... PHASE=before|after
 *   pnpm exec vite-node --config scripts/vite-test.config.ts scripts/rail-studio-harness/capture-sage-settings.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const phase = process.env.PHASE === "before" ? "before" : "after";
const harness = process.env.HARNESS_BASE ?? "http://127.0.0.1:4179";
const landing = process.env.LANDING_BASE ?? "http://127.0.0.1:5180";
const outDir = "/opt/cursor/artifacts/screenshots";

await mkdir(outDir, { recursive: true });
const context = await chromium.launchPersistentContext(`/tmp/sage-settings-chrome-${phase}`, {
  channel: "chrome",
  headless: true,
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());
await page.addInitScript(() => {
  localStorage.setItem("theme_pref_v2", "light");
  localStorage.setItem("milon_accountant_dash_tour_v10", "1");
  localStorage.setItem("milon_accountant_client_tour_v11", "1");
  localStorage.setItem("milon_portal_intent", "accountant");
});

const notes: Record<string, unknown> = {};

async function shot(name: string) {
  const file = `${outDir}/sage-settings-${phase}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}

await page.goto(`${landing}/`, { waitUntil: "domcontentloaded" });
await page.locator(".hero-lede").waitFor({ timeout: 15000 });
notes.hero = await page.locator(".hero-lede").innerText();
notes.chips = await page.locator("#integrations").innerText();
await shot("landing-hero");
await page.locator("footer .copy, .mk-foot, footer").last().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
notes.footer = await page.locator("footer").innerText();
await shot("landing-footer");

await page.goto(`${harness}/settings?walkthrough=trial`, { waitUntil: "domcontentloaded" });
await page.locator(".settings-portal").waitFor({ timeout: 15000 });
if (phase === "before") {
  const sawNy = await page
    .waitForFunction(() => document.body.innerText.includes("New York"), { timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  notes.sawNewYorkBeforeSettle = sawNy;
  if (sawNy) await shot("region-us-flash");
  await page
    .waitForFunction(() => document.body.innerText.includes("South Africa uses rand"), { timeout: 8000 })
    .catch(() => undefined);
} else {
  const early = await page.locator("[data-region-loading], .settings-portal").first().innerText();
  notes.regionEarly = early.slice(0, 240);
  await page.goto(`${harness}/settings?regionDelay=1&walkthrough=trial`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-region-loading]").waitFor({ timeout: 8000 });
  notes.regionLoading = await page.locator("[data-region-loading]").innerText();
  notes.loadingHasUs = (await page.locator("body").innerText()).includes("United States");
  await shot("region-loading");
  await page.waitForFunction(() => document.body.innerText.includes("South Africa uses rand"), { timeout: 8000 });
}
notes.regionSettled = await page.locator("[data-sa-plan-region], .milon-section-card").filter({ hasText: "Region" }).first().innerText().catch(() => "");
await shot("region-settled");

notes.logos = await page.evaluate(() => {
  const visible = [...document.querySelectorAll(".brand")].filter((el) => {
    const node = el as HTMLElement;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
  return visible.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
});
await page.locator(".topbar").scrollIntoViewIfNeeded();
await shot("logos");

const rail = page.locator(".deliverable-rail");
const railBefore = await rail.boundingBox();
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(400);
const railAfter = await rail.boundingBox();
notes.rail = {
  beforeTop: railBefore?.y ?? null,
  afterTop: railAfter?.y ?? null,
  text: (await rail.innerText()).slice(0, 400),
};
await shot("sidebar-scrolled");

await page.goto(`${harness}/settings?band=starter#firm-billing`, { waitUntil: "domcontentloaded" });
await page.locator("#firm-billing").waitFor({ timeout: 15000 });
await page.locator("#firm-billing").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
notes.planStarter = await page.locator("#firm-billing").innerText();
await page.locator("#firm-billing").screenshot({ path: `${outDir}/sage-settings-${phase}-upgrade.png` });
console.log(`${outDir}/sage-settings-${phase}-upgrade.png`);

await page.goto(`${harness}/settings?walkthrough=trial#firm-billing`, { waitUntil: "domcontentloaded" });
await page.locator("#firm-billing").waitFor({ timeout: 15000 });
await page.locator("#firm-billing").scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
notes.planTrial = await page.locator("#firm-billing").innerText();
await page.locator("#firm-billing").screenshot({ path: `${outDir}/sage-settings-${phase}-trial.png` });
console.log(`${outDir}/sage-settings-${phase}-trial.png`);

await writeFile(`${outDir}/sage-settings-${phase}-notes.json`, JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
await context.close();
