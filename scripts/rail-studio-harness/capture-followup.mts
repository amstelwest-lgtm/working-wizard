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
checks.practiceChrome = await page.evaluate(() => {
  const bar = document.querySelector(".topbar");
  const pill = document.querySelector(".topbar .firm-chip");
  const row = document.querySelector("tr.row");
  const table = document.querySelector(".ctable");
  const viewport = document.querySelector(".milon-scroll-table__viewport");
  const ring = document.querySelector(".ring");
  const ringSvg = ring?.querySelector("svg");
  const arc = ring?.querySelector(".fl");
  const watch = document.querySelector(".milon-status-pill--warn");
  const priority = document.querySelector(".prio.high, .prio.medium");
  const trial = document.querySelector(".trial-next");
  const trialBtn = trial?.querySelector("a");
  const barStyle = bar ? getComputedStyle(bar) : null;
  const pillStyle = pill ? getComputedStyle(pill) : null;
  const ringStyle = ringSvg ? getComputedStyle(ringSvg) : null;
  const watchStyle = watch ? getComputedStyle(watch) : null;
  const priorityStyle = priority ? getComputedStyle(priority) : null;
  const trialStyle = trial ? getComputedStyle(trial) : null;
  const trialBtnStyle = trialBtn ? getComputedStyle(trialBtn) : null;
  const text = bar?.textContent ?? "";
  const avatars = document.querySelectorAll(".topbar .profile-chip").length;
  const rowH = row?.getBoundingClientRect().height ?? 0;
  const tableOverflow =
    table && viewport ? table.scrollWidth - viewport.clientWidth : 999;
  const pillH = pill?.getBoundingClientRect().height ?? 0;
  const barH = bar?.getBoundingClientRect().height ?? 0;
  return {
    ok:
      barH > 0 &&
      barH <= 72 &&
      avatars === 1 &&
      !/\bTeam\b/.test(text) &&
      !/Sign out/.test(text) &&
      /Reports studio/.test(text) &&
      pillH > 0 &&
      pillH <= 40 &&
      (pillStyle?.whiteSpace === "nowrap") &&
      rowH >= 52 &&
      rowH <= 68 &&
      tableOverflow <= 2 &&
      (ringStyle?.borderTopWidth === "0px" || ringStyle?.borderTopStyle === "none") &&
      watchStyle?.color === "rgb(183, 121, 31)" &&
      priorityStyle?.color === "rgb(183, 121, 31)" &&
      Boolean(trial) &&
      trialStyle?.borderTopColor === "rgb(219, 234, 254)" &&
      trialBtnStyle?.backgroundColor === "rgb(11, 95, 255)",
    barH,
    avatars,
    text: text.replace(/\s+/g, " ").trim().slice(0, 180),
    pillH,
    whiteSpace: pillStyle?.whiteSpace,
    rowH,
    tableOverflow,
    ringBorder: ringStyle ? `${ringStyle.borderTopWidth} ${ringStyle.borderTopStyle} ${ringStyle.borderTopColor}` : null,
    arc: arc ? getComputedStyle(arc).stroke : null,
    watch: watchStyle?.color,
    watchBg: watchStyle?.backgroundColor,
    priority: priorityStyle?.color,
    priorityBg: priorityStyle?.backgroundColor,
    trialBorder: trialStyle?.borderTopColor,
    trialBtn: trialBtnStyle?.backgroundColor,
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
await phone.getByText("Harbour Glass").first().waitFor({ timeout: 15000 });
checks.phoneRail = await phone.evaluate(() => {
  const rail = document.querySelector("nav.deliverable-rail");
  const bar = document.querySelector(".topbar");
  const pill = document.querySelector(".topbar .firm-chip");
  const avatars = document.querySelectorAll(".topbar .profile-chip").length;
  const text = bar?.textContent ?? "";
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    railScroll: rail?.scrollWidth ?? 0,
    railClient: rail?.clientWidth ?? 0,
    barH: bar?.getBoundingClientRect().height ?? 0,
    avatars,
    pillH: pill?.getBoundingClientRect().height ?? 0,
    hasTeam: /\bTeam\b/.test(text),
    hasSignOut: /Sign out/.test(text),
  };
});
await shot(phone, "followup-practice-dashboard-light-390");
const phoneRail = async (label: string) => {
  const link = phone.locator('nav[aria-label="Practice"]').getByRole("link", { name: label, exact: true });
  await link.evaluate((el) => (el as HTMLAnchorElement).click());
  await phone.waitForTimeout(600);
};
await phoneRail("Clients");
await phone.locator("#clients-table").scrollIntoViewIfNeeded();
await shot(phone, "followup-practice-clients-light-390");
await phoneRail("Desk");
await phone.evaluate(() => {
  document.querySelector("#accountant-inbox")?.scrollIntoView({ block: "center" });
});
await shot(phone, "followup-practice-desk-light-390");
await phoneRail("Team");
await phone.waitForURL("**/settings/team");
await phone.getByRole("heading", { name: "Team & access" }).waitFor({ timeout: 15000 });
await shot(phone, "followup-practice-team-light-390");
await phoneRail("Billing");
await phone.waitForURL("**/settings");
await phone.locator("#firm-billing").waitFor({ timeout: 15000 });
await phone.locator("#firm-billing").scrollIntoViewIfNeeded();
await shot(phone, "followup-practice-billing-light-390");
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
const chrome = checks.practiceChrome as { ok?: boolean };
if (!chrome?.ok) failed.push(chrome);
const phoneCheck = checks.phoneRail as {
  scrollWidth?: number;
  barH?: number;
  avatars?: number;
  pillH?: number;
  hasTeam?: boolean;
  hasSignOut?: boolean;
};
if (
  (phoneCheck.scrollWidth ?? 999) > 390 ||
  (phoneCheck.barH ?? 999) > 72 ||
  phoneCheck.avatars !== 1 ||
  (phoneCheck.pillH ?? 999) > 36 ||
  phoneCheck.hasTeam ||
  phoneCheck.hasSignOut
) {
  failed.push(phoneCheck);
}
if (failed.length) {
  throw new Error(`visual checks failed ${JSON.stringify(failed)}`);
}
