/**
 * Final accountant-UI review walk. Expects the Vite harness on 127.0.0.1:4179.
 * Screenshots every page at 1280 and 390, and audits each stop for horizontal
 * overflow, pane errors, a missing back control, console errors, and banned
 * copy. Does not call Supabase and does not deploy anything.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const base = "http://127.0.0.1:4179";
const client = "/clients/harness-client";
const outDir = process.env.REVIEW_OUT ?? "/opt/cursor/artifacts/screenshots/final-review";

type Stop = {
  name: string;
  path: string;
  /** Pages that are sub-pages must show the header back control. */
  expectBack?: boolean;
  /** Skip the rail wait for practice-side pages that render their own nav. */
  rail?: boolean;
};

const stops: Stop[] = [
  { name: "client-home", path: `${client}?tab=home`, rail: true },
  { name: "agent-fm", path: `${client}?tab=home&agent=financial_manager`, rail: true, expectBack: true },
  { name: "agent-analyst", path: `${client}?tab=home&agent=analyst`, rail: true, expectBack: true },
  { name: "agent-advisor", path: `${client}?tab=home&agent=advisor`, rail: true, expectBack: true },
  { name: "health", path: `${client}?tab=health`, rail: true, expectBack: true },
  { name: "health-score", path: `${client}?tab=health&section=score`, rail: true, expectBack: true },
  { name: "health-pillars", path: `${client}?tab=health&section=pillars`, rail: true, expectBack: true },
  { name: "cash", path: `${client}?tab=cash`, rail: true, expectBack: true },
  { name: "cash-forecast", path: `${client}?tab=cash&section=forecast`, rail: true, expectBack: true },
  { name: "cash-collections", path: `${client}?tab=cash&section=collections&aged=1`, rail: true, expectBack: true },
  { name: "cash-payables", path: `${client}?tab=cash&section=payables&aged=1`, rail: true, expectBack: true },
  { name: "profit", path: `${client}?tab=profit`, rail: true, expectBack: true },
  { name: "profit-waterfall", path: `${client}?tab=profit&section=waterfall`, rail: true, expectBack: true },
  { name: "profit-lines", path: `${client}?tab=profit&section=lines`, rail: true, expectBack: true },
  { name: "budget", path: `${client}?tab=budget`, rail: true, expectBack: true },
  { name: "budget-year", path: `${client}?tab=budget&section=year`, rail: true, expectBack: true },
  { name: "budget-months", path: `${client}?tab=budget&section=months`, rail: true, expectBack: true },
  { name: "moves", path: `${client}?tab=moves`, rail: true, expectBack: true },
  { name: "plan", path: `${client}?tab=plan`, rail: true, expectBack: true },
  { name: "plan-overdue", path: `${client}?tab=plan&section=overdue&filter=overdue`, rail: true, expectBack: true },
  { name: "reports", path: `${client}?tab=reports`, rail: true, expectBack: true },
  { name: "reports-drafts", path: `${client}?tab=reports&section=drafts&packView=draft`, rail: true, expectBack: true },
  { name: "reports-sent", path: `${client}?tab=reports&section=sent`, rail: true, expectBack: true },
  { name: "books", path: `${client}?tab=portal`, rail: true, expectBack: true },
  { name: "practice-dashboard", path: "/dashboard" },
  { name: "practice-overview", path: "/practice" },
  { name: "clients-index", path: "/clients" },
  { name: "settings", path: "/settings" },
  { name: "settings-team", path: "/settings/team" },
  { name: "settings-brand", path: "/settings/brand" },
  { name: "reports-studio", path: "/reports" },
];

const widths = [
  { suffix: "1280", width: 1280, height: 900 },
  { suffix: "390", width: 390, height: 844 },
];

type Finding = {
  stop: string;
  width: string;
  overflowPx: number;
  paneErrors: string[];
  consoleErrors: string[];
  backControl: boolean | null;
  banned: string[];
  h1Count: number;
};

const BANNED = [/passion to perform/i];

async function audit(page: Page, stop: Stop, width: string, consoleErrors: string[]): Promise<Finding> {
  const data = await page.evaluate((expectBack) => {
    const doc = document.documentElement;
    const overflowPx = Math.max(0, doc.scrollWidth - window.innerWidth);
    const paneErrors = [...document.querySelectorAll("[data-pane-error]")].map(
      (el) => el.getAttribute("data-pane-error") ?? "?",
    );
    const text = document.body.innerText;
    const back = document.querySelector(".client-subpage-back");
    return {
      overflowPx,
      paneErrors,
      text,
      backControl: expectBack === undefined ? null : !!back,
      h1Count: document.querySelectorAll("h1").length,
    };
  }, stop.expectBack as boolean | undefined);
  const banned = BANNED.filter((re) => re.test(data.text)).map((re) => re.source);
  return {
    stop: stop.name,
    width,
    overflowPx: data.overflowPx,
    paneErrors: data.paneErrors,
    consoleErrors: [...consoleErrors],
    backControl: data.backControl,
    banned,
    h1Count: data.h1Count,
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir(outDir, { recursive: true });

const findings: Finding[] = [];
const drawer: Record<string, boolean> = {};

for (const size of widths) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  await page.addInitScript(() => {
    localStorage.setItem("theme_pref_v2", "light");
  });
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const line = msg.text();
    if (/harness-local|favicon|net::ERR|the server responded with a status/i.test(line)) return;
    consoleErrors.push(line.slice(0, 300));
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));

  for (const stop of stops) {
    consoleErrors.length = 0;
    await page.goto(`${base}${stop.path}`, { waitUntil: "networkidle" });
    if (stop.rail) {
      await page.waitForSelector("nav.deliverable-rail", { timeout: 15000, state: "attached" });
    }
    await page.waitForTimeout(900);
    findings.push(await audit(page, stop, size.suffix, consoleErrors));
    await page.screenshot({ path: `${outDir}/${stop.name}-${size.suffix}.png`, fullPage: true });
  }

  // Phone drawer dismissal: outside tap, X, and Escape.
  if (size.width === 390) {
    await page.goto(`${base}${client}?tab=home`, { waitUntil: "networkidle" });
    await page.waitForSelector("nav.deliverable-rail", { state: "attached" });
    const menu = page.locator(".topbar-menu-btn");
    const isOpen = () =>
      page.evaluate(() => document.documentElement.classList.contains("nav-drawer-open"));

    await menu.click();
    await page.waitForTimeout(400);
    drawer.opens = await isOpen();
    await page.screenshot({ path: `${outDir}/drawer-open-390.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    drawer.escCloses = !(await isOpen());

    await menu.click();
    await page.waitForTimeout(300);
    await page.locator(".drawer-close").click();
    await page.waitForTimeout(300);
    drawer.xCloses = !(await isOpen());

    await menu.click();
    await page.waitForTimeout(300);
    const point = await page.evaluate(() => {
      const rail = document.querySelector(".deliverable-rail")!.getBoundingClientRect();
      return { x: Math.min(window.innerWidth - 12, rail.right + 24), y: 180 };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(300);
    drawer.outsideCloses = !(await isOpen());
  }

  await page.close();
}

await browser.close();

const problems = findings.filter(
  (f) =>
    f.overflowPx > 1 ||
    f.paneErrors.length ||
    f.consoleErrors.length ||
    f.backControl === false ||
    f.banned.length,
);
const report = { drawer, problems, findings };
await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ drawer, problems }, null, 2));
console.log(`stops: ${findings.length}`);
