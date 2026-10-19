/**
 * Local harness shots for the accountant walkthrough.
 * Usage: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/rail-studio-harness/capture-walkthrough.mts before|after
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const phase = process.argv[2] === "before" ? "before" : "after";
const base = process.env.HARNESS_BASE ?? "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";

await mkdir(outDir, { recursive: true });
const context = await chromium.launchPersistentContext(`/tmp/walkthrough-chrome-${phase}`, {
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

async function shot(name: string, path: string, prepare?: () => Promise<void>) {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  if (prepare) await prepare();
  const file = `${outDir}/walkthrough-${phase}-${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(file);
}

async function clip(name: string, locator: ReturnType<typeof page.locator>) {
  const file = `${outDir}/walkthrough-${phase}-${name}.png`;
  await locator.screenshot({ path: file });
  console.log(file);
}

await shot("sage", "/clients/harness-client?tab=portal", async () => {
  const card = page.locator("[data-sage-connect], .ledger-connect").last();
  await card.waitFor({ timeout: 8000 });
  await clip("sage-card", card);
});
await shot("settings-header", "/settings?walkthrough=trial", async () => {
  await page.locator(".topbar").waitFor({ timeout: 8000 });
});
await shot("settings-plan", "/settings?walkthrough=trial#firm-billing", async () => {
  const plan = page.locator("#firm-billing");
  await plan.waitFor({ timeout: 8000 });
  await plan.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await clip("settings-plan-card", plan);
});
await shot("settings-danger", "/settings?walkthrough=trial", async () => {
  const zone = page.locator("#danger-zone, .settings-danger").last();
  await zone.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await clip("settings-danger-card", zone);
});
if (phase === "after") {
  await shot("copy", "/walkthrough", async () => {
    await page.locator("[data-books=snapshot]").waitFor({ timeout: 8000 });
    await clip("books", page.locator("#books-sentences"));
    await clip("signup", page.locator("#signup-country"));
    await clip("signoff", page.locator("#signoff"));
    await clip("footer", page.locator("footer"));
  });
}
await context.close();
