/**
 * AQA retest shots. Expects the Vite harness on 127.0.0.1:4179.
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
  await page.screenshot({ path: file, fullPage: false });
  written.push(file);
  console.log("shot", name);
}

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("theme_pref_v2", "light");
    localStorage.setItem("milon_accountant_dash_tour_v10", "1");
    localStorage.setItem("milon_accountant_dash_empty_v1", "1");
    localStorage.setItem("milon_accountant_client_tour_v11", "1");
    localStorage.setItem("milon_accountant_client_tour_empty_v3", "1");
    localStorage.setItem("milon_portal_intent", "accountant");
    localStorage.removeItem("milon_accountant_profile");
  });
}

async function openReady(page: Page, path: string) {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await prepare(desktop);
await openReady(desktop, `${client}?tab=portal`);
await desktop.getByRole("heading", { name: "Documents" }).waitFor({ timeout: 20000 });
await desktop.getByRole("heading", { name: "Karoo Traders invoice" }).waitFor();
await desktop.getByText("Client brain").waitFor();
checks.portal1280 = await desktop.evaluate(() => ({
  homeCard: document.body.innerText.includes("Home is the place to start"),
  documents: Boolean(document.querySelector("h2") && document.body.innerText.includes("Documents")),
  karoo: document.body.innerText.includes("Karoo Traders invoice"),
  brain: (document.querySelector(".brain-hero .eyebrow")?.textContent ?? "").includes("Client brain"),
}));
await shot(desktop, "retest-portal-light-1280");

await openReady(desktop, "/settings/brand");
await desktop.getByRole("heading", { name: /Brand/i }).waitFor({ timeout: 20000 });
checks.brand = await desktop.evaluate(() => {
  const input = document.querySelector<HTMLInputElement>('input[type="color"], input[value^="#"]');
  const values = [...document.querySelectorAll("input")].map((el) => (el as HTMLInputElement).value);
  return { values, primary: values.find((v) => /^#/i.test(v)) ?? null };
});
await shot(desktop, "retest-brand-light-1280");

await openReady(desktop, "/dashboard");
await desktop.waitForSelector('nav[aria-label="Practice"]', { timeout: 20000 });
await desktop.locator('nav[aria-label="Practice"]').getByRole("link", { name: "Desk", exact: true }).evaluate((el) => (el as HTMLAnchorElement).click());
await desktop.waitForFunction(() => location.pathname === "/desk");
await desktop.getByText("Practice desk", { exact: true }).waitFor({ timeout: 15000 });
checks.desk = await desktop.evaluate(() => ({
  path: location.pathname,
  theo: document.body.innerText.includes("Theo van der Westhuizen"),
  heading: document.querySelector("h1")?.textContent ?? "",
}));
await shot(desktop, "retest-desk-light-1280");

await openReady(desktop, "/reports");
await desktop.getByRole("heading", { name: "Financial Reports" }).waitFor({ timeout: 30000 });
checks.reports = await desktop.evaluate(() => {
  const selected = document.querySelector("[data-placeholder], [role='combobox']")?.textContent ?? "";
  return {
    path: location.pathname,
    theo: document.body.innerText.includes("Theo van der Westhuizen"),
    picker: selected.replace(/\s+/g, " ").trim(),
    bulb: (() => {
      const icon = document.querySelector("svg.lucide-lightbulb");
      return icon ? getComputedStyle(icon).color : null;
    })(),
  };
});
await shot(desktop, "retest-reports-light-1280");

await openReady(desktop, "/reports?report=scorecard");
await desktop.getByText(/Preparing preview|Health|Scorecard|Preview/i).first().waitFor({ timeout: 30000 });
await desktop.waitForTimeout(2500);
checks.scorecard = await desktop.evaluate(() => ({
  dialog: Boolean(document.querySelector("[role='dialog']")),
  title: document.querySelector("[role='dialog']")?.textContent?.slice(0, 180) ?? "",
  iframe: Boolean(document.querySelector("[role='dialog'] iframe")),
}));
await shot(desktop, "retest-scorecard-preview-light-1280");

await openReady(desktop, `${client}?tab=plan`);
await desktop.getByRole("heading", { name: "Action plan" }).waitFor({ timeout: 20000 });
await desktop.waitForTimeout(800);
checks.plan = await desktop.evaluate(() => {
  const pane = document.querySelector("#pane-plan");
  const text = (pane?.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    path: location.pathname + location.search,
    blank: text.length < 20,
    text: text.slice(0, 280),
  };
});
await shot(desktop, "retest-plan-light-1280");
await desktop.close();

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await prepare(phone);
await openReady(phone, `${client}?tab=portal`);
await phone.getByRole("heading", { name: "Documents" }).waitFor({ timeout: 20000 });
await phone.getByRole("heading", { name: "Karoo Traders invoice" }).waitFor();
checks.portal390 = await phone.evaluate(() => {
  const fabs = [...document.querySelectorAll(".share-fab, .notes-fab")].map((el) => el.getBoundingClientRect());
  const brain = document.querySelector(".brain-hero .eyebrow")?.getBoundingClientRect();
  const karoo = [...document.querySelectorAll("h3")].find((el) => /Karoo/i.test(el.textContent ?? ""))?.getBoundingClientRect();
  const hit = (rect: DOMRect | undefined) =>
    rect
      ? fabs.some(
          (fab) =>
            rect.left < fab.right &&
            rect.right > fab.left &&
            rect.top < fab.bottom &&
            rect.bottom > fab.top &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight,
        )
      : false;
  return {
    brainHit: hit(brain),
    karooHit: hit(karoo),
    brainTop: brain?.top ?? null,
    karooTop: karoo?.top ?? null,
    fabZ: [...document.querySelectorAll(".share-fab, .notes-fab")].map((el) => getComputedStyle(el).zIndex),
  };
});
await shot(phone, "retest-portal-light-390");

await phone.locator(".topbar-menu-btn").click();
await phone.waitForTimeout(300);
checks.drawer = await phone.evaluate(() => {
  const fab = document.querySelector<HTMLElement>(".share-fab");
  const portal = document.querySelector(".accountant-portal");
  const rect = fab?.getBoundingClientRect();
  const top = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
  return {
    portalZ: portal ? getComputedStyle(portal).zIndex : null,
    fabZ: fab ? getComputedStyle(fab).zIndex : null,
    hit: top?.className?.toString?.().slice(0, 120) ?? null,
    fabOnTop: Boolean(fab && top && (top === fab || fab.contains(top))),
  };
});
await shot(phone, "retest-portal-drawer-light-390");
await phone.keyboard.press("Escape").catch(() => {});
await phone.locator(".topbar-backdrop").click({ force: true }).catch(() => {});

await openReady(phone, `${client}?tab=moves`);
await phone.getByRole("button", { name: /Add to plan/i }).first().waitFor({ timeout: 20000 });
await phone.getByRole("button", { name: /Add to plan/i }).first().scrollIntoViewIfNeeded();
checks.addToPlan = await phone.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((el) => /Add to plan/i.test(el.textContent ?? ""));
  const fabs = [...document.querySelectorAll(".share-fab, .notes-fab")].map((el) => el.getBoundingClientRect());
  const rect = button?.getBoundingClientRect();
  const hit = rect
    ? fabs.some(
        (fab) => rect.left < fab.right && rect.right > fab.left && rect.top < fab.bottom && rect.bottom > fab.top,
      )
    : null;
  return { found: Boolean(button), hit, top: rect?.top ?? null, text: button?.textContent?.replace(/\s+/g, " ").trim() };
});
await shot(phone, "retest-add-to-plan-light-390");

await openReady(phone, `${client}?tab=plan`);
await phone.getByRole("heading", { name: "Action plan" }).waitFor({ timeout: 20000 });
await phone.getByRole("button", { name: /Submit for review/i }).waitFor({ timeout: 20000 });
await phone.getByRole("button", { name: /Submit for review/i }).scrollIntoViewIfNeeded();
checks.submit = await phone.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((el) => /Submit for review/i.test(el.textContent ?? ""));
  const fabs = [...document.querySelectorAll(".share-fab, .notes-fab")].map((el) => el.getBoundingClientRect());
  const rect = button?.getBoundingClientRect();
  const hit = rect
    ? fabs.some(
        (fab) => rect.left < fab.right && rect.right > fab.left && rect.top < fab.bottom && rect.bottom > fab.top,
      )
    : null;
  return { found: Boolean(button), hit, top: rect?.top ?? null, text: button?.textContent?.replace(/\s+/g, " ").trim() ?? "" };
});
await shot(phone, "retest-submit-review-light-390");
await shot(phone, "retest-plan-light-390");

await openReady(phone, "/settings/brand");
await phone.getByRole("heading", { name: /Brand/i }).waitFor({ timeout: 20000 });
await shot(phone, "retest-brand-light-390");
await openReady(phone, "/desk");
await phone.getByText("Practice desk", { exact: true }).waitFor({ timeout: 20000 });
await shot(phone, "retest-desk-light-390");
await openReady(phone, "/reports");
await phone.getByRole("heading", { name: "Financial Reports" }).waitFor({ timeout: 30000 });
await shot(phone, "retest-reports-light-390");
await phone.close();
await browser.close();

const report = { written, checks };
await mkdir(outDir, { recursive: true });
await writeFile("/tmp/retest-harness.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const portal = checks.portal1280 as { homeCard?: boolean; documents?: boolean; karoo?: boolean; brain?: boolean };
const brand = checks.brand as { primary?: string | null };
const desk = checks.desk as { path?: string; theo?: boolean };
const reports = checks.reports as { theo?: boolean; picker?: string; bulb?: string | null };
const plan = checks.plan as { blank?: boolean };
const phonePortal = checks.portal390 as { brainHit?: boolean; karooHit?: boolean };
const drawer = checks.drawer as { fabOnTop?: boolean; fabZ?: string };
const failed: unknown[] = [];
if (portal.homeCard || !portal.documents || !portal.karoo || !portal.brain) failed.push(portal);
if ((brand.primary ?? "").toLowerCase() !== "#102a43") failed.push(brand);
if (desk.path !== "/desk" || desk.theo) failed.push(desk);
if (reports.theo || /Theo|Harbour Glass/.test(reports.picker ?? "")) failed.push(reports);
if (reports.bulb && reports.bulb !== "rgb(11, 95, 255)") failed.push({ bulb: reports.bulb });
if (plan.blank) failed.push(plan);
if (phonePortal.brainHit || phonePortal.karooHit) failed.push(phonePortal);
if (drawer.fabOnTop || drawer.fabZ !== "20") failed.push(drawer);
const addToPlan = checks.addToPlan as { found?: boolean; hit?: boolean | null };
const submit = checks.submit as { found?: boolean; hit?: boolean | null };
if (!addToPlan.found || addToPlan.hit) failed.push(addToPlan);
if (!submit.found || submit.hit) failed.push(submit);
if (failed.length) throw new Error(`retest checks failed ${JSON.stringify(failed)}`);
