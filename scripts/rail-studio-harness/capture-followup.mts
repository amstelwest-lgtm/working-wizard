/**
 * Local shots for the cobalt CTA, wordmark inset, and real practice pages.
 * Expects the Vite harness on 127.0.0.1:4179. Does not call Supabase.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const base = "http://127.0.0.1:4179";
const client = "/clients/harness-client";
const outDir = "/opt/cursor/artifacts/screenshots";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];
const checks: Record<string, unknown> = {};

async function shot(page: Page, name: string) {
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file });
  written.push(file);
  console.log("shot", name);
}

async function prepare(page: Page, theme: "light" | "dark") {
  await page.addInitScript((next) => {
    localStorage.setItem("theme_pref_v2", next);
    localStorage.setItem("milon_accountant_dash_tour_v10", "1");
    localStorage.setItem("milon_accountant_dash_empty_v1", "1");
    localStorage.setItem("milon_accountant_client_tour_v11", "1");
    localStorage.setItem("milon_accountant_client_tour_empty_v3", "1");
    localStorage.setItem("milon_portal_intent", "accountant");
  }, theme);
}

async function openReady(page: Page, path: string) {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.waitForSelector("nav.deliverable-rail", { timeout: 20000 });
}

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await prepare(page, "light");
page.on("request", (request) => {
  if (/supabase\.(co|in|com)/i.test(request.url())) {
    throw new Error(`unexpected supabase request ${request.url()}`);
  }
});

await openReady(page, `${client}?tab=home`);
checks.wordmarkClient = await page.evaluate(() => {
  const brand = document.querySelector(".topbar .gold-text");
  const tab = document.querySelector("nav.deliverable-rail .tab");
  if (!brand || !tab) return { ok: false, reason: "missing brand or rail" };
  const brandLeft = brand.getBoundingClientRect().left;
  const textLeft = tab.getBoundingClientRect().left + 12;
  return {
    ok: brandLeft >= 12 && Math.abs(brandLeft - textLeft) < 8,
    brandLeft,
    textLeft,
    brand: brand.textContent,
  };
});
await shot(page, "followup-wordmark-client-light-1280");

await openReady(page, `${client}?tab=budget`);
await page.getByRole("button", { name: /Sign off budget/i }).waitFor({ timeout: 15000 });
checks.signoff = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((el) =>
    /Sign off budget/i.test(el.textContent ?? ""),
  );
  if (!button) return { ok: false };
  const style = getComputedStyle(button);
  return {
    ok: style.backgroundColor === "rgb(11, 95, 255)" && style.color === "rgb(255, 255, 255)",
    backgroundColor: style.backgroundColor,
    color: style.color,
    backgroundImage: style.backgroundImage,
  };
});
await page.getByRole("button", { name: /Sign off budget/i }).scrollIntoViewIfNeeded();
await shot(page, "followup-budget-signoff-light-1280");
await page.getByRole("button", { name: /Sign off budget/i }).click();
await page.getByRole("dialog").waitFor();
checks.signoffDialog = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find(
    (el) => (el.textContent ?? "").trim() === "Sign off",
  );
  if (!button) return { ok: false };
  const style = getComputedStyle(button);
  return {
    ok: style.backgroundColor === "rgb(11, 95, 255)",
    backgroundColor: style.backgroundColor,
    color: style.color,
  };
});
await shot(page, "followup-budget-signoff-dialog-light-1280");
await page.keyboard.press("Escape");

await openReady(page, "/dashboard");
await page.getByRole("heading", { name: /Harbour/i }).waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForSelector("#clients-table", { timeout: 15000 });
await page.getByText("Harbour Glass").first().waitFor({ timeout: 15000 });
checks.wordmarkPractice = await page.evaluate(() => {
  const brand = document.querySelector(".topbar .gold-text");
  const tab = document.querySelector("nav.deliverable-rail .tab");
  if (!brand || !tab) return { ok: false };
  const brandLeft = brand.getBoundingClientRect().left;
  const textLeft = tab.getBoundingClientRect().left + 12;
  return {
    ok: brandLeft >= 12 && Math.abs(brandLeft - textLeft) < 8,
    brandLeft,
    textLeft,
  };
});
await shot(page, "followup-wordmark-practice-light-1280");
await shot(page, "followup-practice-dashboard-light-1280");

const rail = async (label: string) => {
  const link = page.locator('nav[aria-label="Practice"]').getByRole("link", { name: label, exact: true });
  await link.evaluate((el) => (el as HTMLAnchorElement).click());
  await page.waitForTimeout(600);
};

await rail("Clients");
await page.waitForFunction(() => location.hash === "#clients-table");
await page.locator("#clients-table").scrollIntoViewIfNeeded();
checks.clientsRoute = await page.evaluate(() => ({
  path: location.pathname + location.hash,
  hasTable: Boolean(document.querySelector("#clients-table")),
  hasClient: document.body.innerText.includes("Harbour Glass"),
}));
await shot(page, "followup-practice-clients-light-1280");

await rail("Desk");
await page.waitForFunction(() => location.hash === "#accountant-inbox");
await page.waitForFunction(() => {
  const el = document.querySelector("#accountant-inbox");
  return el instanceof HTMLDetailsElement && el.open;
});
await page.evaluate(() => {
  document.querySelector("#accountant-inbox")?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(300);
checks.deskRoute = await page.evaluate(() => {
  const el = document.querySelector("#accountant-inbox");
  const active = document.querySelector('nav[aria-label="Practice"] a.tab.on')?.textContent ?? "";
  const rect = el?.getBoundingClientRect();
  return {
    path: location.pathname + location.hash,
    open: el instanceof HTMLDetailsElement ? el.open : false,
    active,
    top: rect?.top ?? null,
    text: el?.textContent?.slice(0, 220) ?? "",
  };
});
await shot(page, "followup-practice-desk-light-1280");

await rail("Dashboard");
await page.waitForFunction(() => location.pathname === "/dashboard" && location.hash === "");
checks.dashboardRoute = await page.evaluate(() => ({
  path: location.pathname + location.hash,
  hasStats: Boolean(document.querySelector(".stats-strip")),
}));
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page, "followup-practice-dashboard-top-light-1280");

await rail("Team");
await page.waitForURL("**/settings/team");
await page.getByRole("heading", { name: "Team & access" }).waitFor({ timeout: 15000 });
await page.getByText("Ada Mbeki").first().waitFor();
checks.teamRoute = await page.evaluate(() => ({
  path: location.pathname,
  title: document.querySelector("h1")?.textContent ?? "",
}));
await shot(page, "followup-practice-team-light-1280");

await rail("Billing");
await page.waitForURL("**/settings");
await page.locator("#firm-billing").waitFor({ timeout: 15000 });
await page.getByText("2 of 15 clients").waitFor();
checks.billingRoute = await page.evaluate(() => ({
  path: location.pathname,
  billing: Boolean(document.querySelector("#firm-billing")),
  headline: document.querySelector("#firm-billing .settings-value")?.textContent ?? "",
}));
await page.locator("#firm-billing").scrollIntoViewIfNeeded();
await shot(page, "followup-practice-billing-light-1280");

await page.close();

const dark = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await prepare(dark, "dark");
await openReady(dark, `${client}?tab=budget`);
await dark.getByRole("button", { name: /Sign off budget/i }).waitFor({ timeout: 15000 });
checks.signoffDark = await dark.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((el) =>
    /Sign off budget/i.test(el.textContent ?? ""),
  );
  if (!button) return { ok: false };
  return { backgroundColor: getComputedStyle(button).backgroundColor };
});
await dark.getByRole("button", { name: /Sign off budget/i }).scrollIntoViewIfNeeded();
await shot(dark, "followup-budget-signoff-dark-1280");
await openReady(dark, "/dashboard");
await dark.waitForSelector("#clients-table", { timeout: 15000 });
await shot(dark, "followup-practice-dashboard-dark-1280");
await dark.close();

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await prepare(phone, "light");
await openReady(phone, "/dashboard");
await phone.waitForSelector("#clients-table", { timeout: 15000 });
checks.phoneRail = await phone.evaluate(() => {
  const rail = document.querySelector("nav.deliverable-rail");
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    railScroll: rail?.scrollWidth ?? 0,
    railClient: rail?.clientWidth ?? 0,
  };
});
await shot(phone, "followup-practice-dashboard-light-390");
await phone.close();
await browser.close();

const report = { written, checks };
await mkdir(outDir, { recursive: true });
await writeFile("/tmp/followup-harness.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const desk = checks.deskRoute as { active?: string; open?: boolean; text?: string };
const failed = [
  checks.wordmarkClient,
  checks.wordmarkPractice,
  checks.signoff,
  checks.signoffDialog,
].filter((row) => !row || (row as { ok?: boolean }).ok === false);
if (desk.active !== "Desk" || !desk.open || !/asking for your review|North Quay/i.test(desk.text ?? "")) {
  failed.push(desk);
}
if (failed.length) {
  throw new Error(`visual checks failed ${JSON.stringify(failed)}`);
}
