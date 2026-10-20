/**
 * Owner door at 385px on the real /app shell (main.overflow-x-hidden >
 * #board-pack.founder-shell). Wide children scroll inside their frames.
 * The pencil must not cover Home agent cards, the Budget table, or the Cash card.
 *
 *   pnpm test:owner-385-fit
 */
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { chromium, type Page } from "playwright";

const PORT = 4218;
const OWNED = !process.env.HARNESS_URL;
const BASE = process.env.HARNESS_URL ?? `http://127.0.0.1:${PORT}`;

const VIEWS = ["rest", "health", "cash", "profit", "budget", "moves", "accountant"] as const;

let harness: ReturnType<typeof spawn> | null = null;

function stopTree(child: ReturnType<typeof spawn> | null) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function startHarness() {
  const fd = openSync("/tmp/owner-385-fit-vite.log", "w");
  harness = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "dev",
      "--config",
      "scripts/rail-studio-harness/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  process.on("exit", () => stopTree(harness));
}

async function waitForHarness() {
  const deadline = Date.now() + 90_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/owner-door`);
      if (res.status === 200) {
        const text = await res.text();
        if (text.includes("Rail harness") || text.includes("/@vite")) return;
        last = "200 without the harness shell";
      } else last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`owner harness did not come up at ${BASE} (${last})`);
}

async function launch() {
  const browser = await chromium.launch({ headless: true }).catch(() => null);
  if (browser) return browser;
  const inst = spawnSync("pnpm", ["exec", "playwright", "install", "chromium"], { stdio: "inherit" });
  if (inst.status !== 0) throw new Error("could not install Playwright chromium");
  return chromium.launch({ headless: true });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const offenders: string[] = [];
    const skip = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return true;
      if (Number(s.opacity) < 0.02) return true;
      const r = el.getBoundingClientRect();
      return r.width < 1 || r.height < 1;
    };
    const label = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string"
          ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")
          : "";
      return el.tagName.toLowerCase() + id + (cls ? `.${cls}` : "");
    };
    for (const el of document.querySelectorAll("body *")) {
      if (skip(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right <= innerWidth + 1) continue;
      let node = el.parentElement;
      let exempt = false;
      while (node && node !== document.documentElement) {
        const ox = getComputedStyle(node).overflowX;
        if (ox === "auto" || ox === "scroll") {
          const box = node.getBoundingClientRect();
          exempt = box.width >= 1 && box.left >= -1 && box.right <= innerWidth + 1;
          break;
        }
        if (ox === "hidden" || ox === "clip") break;
        node = node.parentElement;
      }
      if (exempt) continue;
      offenders.push(`${label(el)} right ${Math.round(rect.right)}`);
      if (offenders.length >= 8) break;
    }
    const visibleBox = (el: Element) => {
      let box = el.getBoundingClientRect();
      let node = el.parentElement;
      while (node && node !== document.body) {
        const s = getComputedStyle(node);
        const clips = ["auto", "scroll", "hidden", "clip"].includes(s.overflowX) || ["auto", "scroll", "hidden", "clip"].includes(s.overflowY);
        if (clips) {
          const p = node.getBoundingClientRect();
          const left = Math.max(box.left, p.left);
          const right = Math.min(box.right, p.right);
          const top = Math.max(box.top, p.top);
          const bottom = Math.min(box.bottom, p.bottom);
          box = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
        }
        node = node.parentElement;
      }
      return box;
    };
    const hits = (sel: string) => {
      const fab = document.querySelector("#wizard-notes-pin");
      if (!fab) return ["pencil missing"];
      const fabBox = fab.getBoundingClientRect();
      const found = [...document.querySelectorAll(sel)].filter((el) => !skip(el));
      if (found.length === 0) return [`missing ${sel}`];
      const overlaps: string[] = [];
      for (const el of found) {
        const box = visibleBox(el);
        const overlap =
          fabBox.left < box.right - 0.5 &&
          fabBox.right > box.left + 0.5 &&
          fabBox.top < box.bottom - 0.5 &&
          fabBox.bottom > box.top + 0.5;
        if (overlap) overlaps.push(label(el));
      }
      return overlaps;
    };
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      shell: Boolean(document.querySelector("main.overflow-x-hidden")) && Boolean(document.querySelector("#board-pack.founder-shell")),
      offenders,
      fab: Boolean(document.querySelector("#wizard-notes-pin")),
    };
  });
}

async function openWide(page: Page, view: string) {
  if (view === "cash") {
    const week = page.locator("[aria-label='Cash forecast'] [role='tab']", { hasText: "13-week" });
    if (await week.count()) await week.click();
    await page.waitForTimeout(200);
  }
  if (view === "budget") {
    const table = page.locator("[aria-label='Budget'] [role='tab']", { hasText: "Table" });
    if (await table.count()) await table.click();
    await page.waitForTimeout(200);
  }
}

async function main() {
  if (OWNED) startHarness();
  await waitForHarness();
  const browser = await launch();
  const failures: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 385, height: 844 } });
    for (const view of VIEWS) {
      await page.goto(`${BASE}/owner-door?view=${view}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-owner-ready='true']", { timeout: 20000 });
      await page.waitForTimeout(400);
      await openWide(page, view);
      const laid = await measure(page);
      if (!laid.shell) failures.push(`${view}: missing main.overflow-x-hidden or #board-pack.founder-shell`);
      if (laid.scrollWidth > laid.innerWidth) {
        failures.push(`${view}: scrollWidth ${laid.scrollWidth} > innerWidth ${laid.innerWidth}`);
      }
      for (const edge of laid.offenders) failures.push(`${view}: ${edge}`);
      if (view === "rest") {
        const cards = page.locator("[data-agent-card]");
        const count = await cards.count();
        for (let i = 0; i < count; i += 1) await cards.nth(i).scrollIntoViewIfNeeded();
        const overlap = await page.evaluate(() => {
          const fab = document.querySelector("#wizard-notes-pin")?.getBoundingClientRect();
          if (!fab) return ["pencil missing"];
          return [...document.querySelectorAll("[data-agent-card]")]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return (
                fab.left < box.right - 0.5 &&
                fab.right > box.left + 0.5 &&
                fab.top < box.bottom - 0.5 &&
                fab.bottom > box.top + 0.5
              );
            })
            .map((el) => el.getAttribute("data-agent-card") ?? "agent");
        });
        if ((await cards.count()) === 0) failures.push("home: agent cards missing");
        for (const name of overlap) failures.push(`home: pencil intersects agent card ${name}`);
      }
      if (view === "budget") {
        const table = page.locator(".budget-lens table").first();
        if ((await table.count()) === 0) failures.push("budget: table missing");
        else await table.scrollIntoViewIfNeeded();
        const overlap = await page.evaluate(() => {
          const fab = document.querySelector("#wizard-notes-pin")?.getBoundingClientRect();
          const el = document.querySelector(".budget-lens table");
          if (!fab || !el) return !fab ? "pencil missing" : "table missing";
          const port = el.closest(".milon-scroll-table__viewport") ?? el.parentElement;
          const box = (port ?? el).getBoundingClientRect();
          const hit =
            fab.left < box.right - 0.5 &&
            fab.right > box.left + 0.5 &&
            fab.top < box.bottom - 0.5 &&
            fab.bottom > box.top + 0.5;
          return hit ? "overlap" : "";
        });
        if (overlap) failures.push(`budget: pencil intersects the table (${overlap})`);
      }
      if (view === "cash") {
        const card = page.locator("[data-cash-view]").first();
        if ((await card.count()) === 0) failures.push("cash: card missing");
        else await card.scrollIntoViewIfNeeded();
        const overlap = await page.evaluate(() => {
          const fab = document.querySelector("#wizard-notes-pin")?.getBoundingClientRect();
          const box = document.querySelector("[data-cash-view]")?.getBoundingClientRect();
          if (!fab || !box) return !fab ? "pencil missing" : "card missing";
          const hit =
            fab.left < box.right - 0.5 &&
            fab.right > box.left + 0.5 &&
            fab.top < box.bottom - 0.5 &&
            fab.bottom > box.top + 0.5;
          return hit ? "overlap" : "";
        });
        if (overlap) failures.push(`cash: pencil intersects the cash card (${overlap})`);
      }
    }
    await page.close();
  } finally {
    await browser.close();
    stopTree(harness);
  }
  if (failures.length) {
    console.error(failures.slice(0, 40).join("\n"));
    throw new Error(`${failures.length} owner 385 fit failure(s)`);
  }
  console.log("owner-385-fit: ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  stopTree(harness);
  process.exit(1);
});
