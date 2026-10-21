/**
 * Computed-style scan of `/`, `/terms`, `/privacy`, and `/join/:token`, plus
 * the accountant harness (`/clients`, client Health, client Reports) and the
 * owner door tabs. Brand
 * gold may remain only on the MILŌN wordmark (header, footer, hero mockup
 * mark, invite shell), the hero trial button, and the 390 sticky trial
 * button. In the accountant app the wordmark stays gold and the report-card
 * hairline stays. Primary and outline buttons, including focus, are cobalt.
 * Email the
 * owner must be a cobalt outline, not the gold hairline. The amber "74"
 * status colour is not brand gold. Legal hero sublines must not render
 * "Inc..". The invite page has no gold button.
 *
 *   pnpm test:landing-gold-scan
 *   LANDING_URL=http://127.0.0.1:5173 pnpm test:landing-gold-scan
 */
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

const PORT = 5198;
const OWNED = !process.env.LANDING_URL;
const BASE = process.env.LANDING_URL ?? `http://127.0.0.1:${PORT}`;
const HARNESS_PORT = 5199;
const HARNESS_OWNED = !process.env.HARNESS_URL;
const HARNESS = process.env.HARNESS_URL ?? `http://127.0.0.1:${HARNESS_PORT}`;

let server: ReturnType<typeof spawn> | null = null;
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

function stopServer() {
  stopTree(server);
  server = null;
}

function stopHarness() {
  stopTree(harness);
  harness = null;
}

async function waitForHome() {
  const deadline = Date.now() + 90_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status === 200) {
        const text = await res.text();
        if (text.includes("MIL")) return;
        last = "200 without the landing wordmark";
      } else last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`landing did not come up at ${BASE} (${last})`);
}

function startServer() {
  const fd = openSync("/tmp/landing-gold-scan-vite.log", "w");
  const env = {
    ...process.env,
    SUPABASE_URL: process.env.SUPABASE_URL || "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_test",
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY:
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_test",
  };
  server = spawn(
    "pnpm",
    ["exec", "vite", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { env, detached: true, stdio: ["ignore", fd, fd] },
  );
  process.on("exit", stopServer);
}

function startHarness() {
  const fd = openSync("/tmp/accountant-gold-scan-vite.log", "w");
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
      String(HARNESS_PORT),
      "--strictPort",
    ],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  process.on("exit", stopHarness);
}

async function waitForHarness() {
  const deadline = Date.now() + 90_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${HARNESS}/clients`);
      if (res.status === 200) {
        const text = await res.text();
        if (text.includes("Rail harness")) return;
        last = "200 without the harness shell";
      } else last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`accountant harness did not come up at ${HARNESS} (${last})`);
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    /* system Chrome is not on every CI image */
  }
  try {
    return await chromium.launch({ headless: true });
  } catch {
    /* download the bundled browser once */
  }
  const inst = spawnSync("pnpm", ["exec", "playwright", "install", "chromium"], { stdio: "inherit" });
  if (inst.status !== 0) throw new Error("could not install Playwright chromium");
  return chromium.launch({ headless: true });
}

type Hit = { path: string; prop: string; sample: string };

async function scan(
  page: Page,
  label: string,
  opts?: { accountant?: boolean; owner?: boolean },
): Promise<{ hits: Hit[]; wordmark: boolean; heroCta: boolean; amber74: boolean }> {
  return page.evaluate(({ labelIn, accountant, owner }) => {
    const GOLD: Array<[number, number, number]> = [
      [212, 175, 55],
      [125, 95, 15],
      [253, 238, 121],
      [172, 132, 0],
      [138, 96, 0],
      [122, 84, 0],
      [184, 134, 11],
      [107, 82, 0],
    ];
    const AMBER: Array<[number, number, number]> = [
      [183, 121, 31],
      [168, 106, 30],
      [138, 90, 18],
      [240, 213, 154],
      [232, 179, 75],
    ];
    const dist = (a: number[], b: number[]) => {
      const dr = a[0] - b[0];
      const dg = a[1] - b[1];
      const db = a[2] - b[2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    const isGold = (rgb: number[], alpha: number) => {
      if (alpha < 0.045) return false;
      const [r, g, b] = rgb;
      if (!(r > g && g >= b && r - b > 45)) return false;
      const amber = Math.min(...AMBER.map((c) => dist(rgb, c)));
      const gold = Math.min(...GOLD.map((c) => dist(rgb, c)));
      if (amber < gold) return false;
      return gold < 32;
    };
    const colorsIn = (value: string) => {
      const found: Array<{ rgb: number[]; alpha: number; raw: string }> = [];
      const re = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(value))) {
        found.push({
          rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
          alpha: m[4] === undefined ? 1 : Number(m[4]),
          raw: m[0],
        });
      }
      return found;
    };
    const allowed = (el: Element) => {
      if (el.closest("[data-stale-bundle]")) return true;
      if (owner) {
        return Boolean(el.closest(".gold-text") || el.closest("[data-status-warn]"));
      }
      if (accountant) {
        return Boolean(
          el.closest(".gold-text") || el.closest(".brand") || el.closest(".report-card__rule"),
        );
      }
      return Boolean(
        el.closest(".logo-word") ||
          el.closest(".dash-top .brand") ||
          el.closest("#hero .btn-gold") ||
          el.closest(".trial-sticky .btn-gold"),
      );
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      if (Number(s.opacity) < 0.02) return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 1 && rect.height >= 1;
    };
    const cssPath = (el: Element) => {
      const bits: string[] = [];
      let n: Element | null = el;
      while (n && bits.length < 5) {
        const tag = n.tagName.toLowerCase();
        const id = n.id ? `#${n.id}` : "";
        const cls =
          typeof n.className === "string"
            ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")
            : "";
        bits.unshift(tag + id + (cls ? `.${cls}` : ""));
        n = n.parentElement;
      }
      return bits.join(" > ");
    };
    const props = [
      "color",
      "backgroundColor",
      "backgroundImage",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "outlineColor",
      "boxShadow",
      "textDecorationColor",
      "filter",
      "stroke",
      "fill",
    ] as const;
    const hits: Hit[] = [];
    const seen = new Set<string>();
    const consider = (el: Element, pseudo: string | null) => {
      if (!visible(el)) return;
      if (allowed(el)) return;
      const style = pseudo ? getComputedStyle(el, pseudo) : getComputedStyle(el);
      if (pseudo) {
        if (style.content === "none" && style.backgroundImage === "none" && style.backgroundColor === "rgba(0, 0, 0, 0)") return;
        if (Number(style.opacity) < 0.02) return;
      }
      const svgish = /^(svg|circle|path|line|rect|ellipse|polygon|polyline|text|g|stop|use)$/;
      const paint = svgish.test(el.tagName.toLowerCase())
        ? props
        : props.filter((prop) => prop !== "stroke" && prop !== "fill");
      for (const prop of paint) {
        const value = style[prop];
        if (!value || value === "none" || value === "rgba(0, 0, 0, 0)") continue;
        for (const color of colorsIn(value)) {
          if (!isGold(color.rgb, color.alpha)) continue;
          const key = `${cssPath(el)}|${pseudo ?? ""}|${prop}|${color.raw}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            path: `${labelIn} ${cssPath(el)}${pseudo ? pseudo : ""} ${prop}`,
            prop,
            sample: color.raw,
          });
          if (hits.length > 40) return;
        }
      }
    };
    for (const el of document.querySelectorAll("*")) {
      consider(el, null);
      consider(el, "::before");
      consider(el, "::after");
      if (hits.length > 40) break;
    }
    const word = document.querySelector(".logo-word");
    const cta = document.querySelector("#hero .btn-gold");
    const wordmark = word ? colorsIn(getComputedStyle(word).color).some((c) => isGold(c.rgb, c.alpha)) : false;
    const heroCta = cta
      ? colorsIn(getComputedStyle(cta).backgroundColor).some((c) => isGold(c.rgb, c.alpha))
      : false;
    const amber = [...document.querySelectorAll(".pillar-card.warn .score b")].find((el) => el.textContent?.trim() === "74");
    const amber74 = amber
      ? colorsIn(getComputedStyle(amber).color).some((c) => Math.min(...AMBER.map((a) => dist(c.rgb, a))) < 12)
      : false;
    return { hits, wordmark, heroCta, amber74 };
  }, { labelIn: label, accountant: Boolean(opts?.accountant), owner: Boolean(opts?.owner) });
}

async function focusButton(page: Page, selector: string) {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return false;
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate((el) => {
    const probe = document.createElement("span");
    probe.tabIndex = 0;
    probe.setAttribute("data-focus-probe", "");
    probe.style.cssText = "position:fixed;left:4px;top:4px;width:8px;height:8px;";
    el.parentElement?.insertBefore(probe, el);
    probe.focus();
  });
  await page.keyboard.press("Tab");
  return loc.evaluate((el) => document.activeElement === el && el.matches(":focus-visible"));
}

function nearCobalt(color: string) {
  const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color);
  if (!match) return false;
  const rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
  return (
    [
      [11, 95, 255],
      [37, 99, 235],
    ] as const
  ).some((want) => Math.hypot(rgb[0] - want[0], rgb[1] - want[1], rgb[2] - want[2]) <= 24);
}

async function main() {
  if (OWNED) startServer();
  await waitForHome();
  const browser = await launch();
  const failures: string[] = [];
  try {
    for (const width of [1280, 390]) {
      for (const theme of ["light", "dark"] as const) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page.evaluate((next) => {
          document.documentElement.dataset.theme = next;
          document.documentElement.classList.toggle("dark", next === "dark");
        }, theme);
        await page.waitForTimeout(150);
        const resting = await scan(page, `${width} ${theme}`);
        if (!resting.wordmark) failures.push(`${width} ${theme}: wordmark is not gold`);
        if (!resting.heroCta) failures.push(`${width} ${theme}: hero trial CTA is not gold`);
        if (theme === "light" && width === 1280 && !resting.amber74) {
          failures.push("amber 74 status colour was recolored");
        }
        for (const hit of resting.hits) failures.push(`${hit.path} ${hit.sample}`);

        const hoverSel = [
          ".persona-card",
          ".feat-card",
          ".bridge-side",
          ".price-card",
          ".step-card",
          "nav#topnav .links a:not(.btn)",
          "footer .fnav a",
          "#themeToggle",
          ".watch-cta",
        ];
        for (const sel of hoverSel) {
          const loc = page.locator(sel).first();
          if ((await loc.count()) === 0 || !(await loc.isVisible())) continue;
          await loc.scrollIntoViewIfNeeded();
          await loc.hover({ timeout: 5000 });
          const hovered = await scan(page, `${width} ${theme} hover ${sel}`);
          for (const hit of hovered.hits) failures.push(`${hit.path} ${hit.sample}`);
        }
        const focusSel = [".marquee-toggle", ".reg-shell input", ".milon-market-select"];
        for (const sel of focusSel) {
          const loc = page.locator(sel).first();
          if ((await loc.count()) === 0 || !(await loc.isVisible())) continue;
          await loc.focus({ timeout: 5000 });
          const focused = await scan(page, `${width} ${theme} focus ${sel}`);
          for (const hit of focused.hits) failures.push(`${hit.path} ${hit.sample}`);
        }
        await page.close();
      }
    }
    for (const path of ["/terms", "/privacy"]) {
      for (const width of [1280, 390]) {
        for (const theme of ["light", "dark"] as const) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
          await page.evaluate((next) => {
            document.documentElement.dataset.theme = next;
            document.documentElement.classList.toggle("dark", next === "dark");
          }, theme);
          const copy = await page.locator(".mk-lead").innerText();
          if (copy.includes("Inc..")) failures.push(`${path} ${width} ${theme}: hero subline has a double period`);
          const painted = await scan(page, `${path} ${width} ${theme}`);
          if (!painted.wordmark) failures.push(`${path} ${width} ${theme}: wordmark is not gold`);
          for (const hit of painted.hits) failures.push(`${hit.path} ${hit.sample}`);
          const cardBtn = page.locator(".mk-cta .mk-btn").first();
          if (await cardBtn.isVisible()) {
            await cardBtn.hover();
            const hovered = await scan(page, `${path} ${width} ${theme} hover .mk-cta .mk-btn`);
            for (const hit of hovered.hits) failures.push(`${hit.path} ${hit.sample}`);
          }
          await page.close();
        }
      }
    }
    for (const width of [1280, 390]) {
      for (const theme of ["light", "dark"] as const) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(`${BASE}/join/sampletok`, { waitUntil: "networkidle" });
        await page.evaluate((next) => {
          document.documentElement.dataset.theme = next;
          document.documentElement.classList.toggle("dark", next === "dark");
        }, theme);
        await page.waitForTimeout(200);
        const painted = await scan(page, `/join/sampletok ${width} ${theme}`);
        if (!painted.wordmark) failures.push(`/join/sampletok ${width} ${theme}: wordmark is not gold`);
        for (const hit of painted.hits) failures.push(`${hit.path} ${hit.sample}`);
        const canvas = await page.evaluate(() => {
          const main = document.querySelector("main.invite-ink");
          if (!main) return "";
          return getComputedStyle(main).backgroundColor;
        });
        if (canvas !== "rgb(255, 255, 255)") {
          failures.push(`/join/sampletok ${width} ${theme}: canvas is ${canvas || "missing"}`);
        }
        await page.close();
      }
    }

    if (HARNESS_OWNED) startHarness();
    await waitForHarness();
    const accountantPaths = [
      "/clients",
      "/clients/harness-client?tab=health",
      "/clients/harness-client?tab=reports&section=waterfall",
      "/clients/harness-client?tab=settings",
    ];
    const cobalt: Record<"light" | "dark", [number, number, number]> = {
      light: [11, 95, 255],
      dark: [96, 165, 250],
    };
    for (const path of accountantPaths) {
      for (const width of [1280, 390]) {
        for (const theme of ["light", "dark"] as const) {
          const page = await browser.newPage({ viewport: { width, height: 760 } });
          await page.goto(`${HARNESS}${path}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(600);
          await page.evaluate((next) => {
            document.documentElement.dataset.theme = next;
            document.documentElement.classList.toggle("dark", next === "dark");
          }, theme);
          const logo = page.locator(".gold-text").first();
          if ((await logo.count()) === 0) failures.push(`${path} ${width} ${theme}: wordmark missing`);
          else {
            const bg = await logo.evaluate((el) => getComputedStyle(el).backgroundImage);
            if (!bg.includes("212, 175, 55") && !bg.includes("172, 132, 0")) {
              failures.push(`${path} ${width} ${theme}: accountant wordmark is not gold`);
            }
          }
          const painted = await scan(page, `accountant ${path} ${width} ${theme}`, { accountant: true });
          for (const hit of painted.hits) failures.push(`${hit.path} ${hit.sample}`);
          const focusSel =
            path === "/clients"
              ? "#wizard-add-client"
              : path.includes("tab=settings")
                ? "[data-invite-owner-entry]"
                : "";
          if (focusSel) {
            const focused = await focusButton(page, focusSel);
            if (!focused) failures.push(`${path} ${width} ${theme}: ${focusSel} did not take a visible focus`);
            else {
              const paint = await page.locator(focusSel).evaluate((el) => {
                const style = getComputedStyle(el);
                return { outline: style.outlineColor, border: style.borderTopColor };
              });
              if (!nearCobalt(paint.outline)) {
                failures.push(`${path} ${width} ${theme}: focus outline is ${paint.outline}`);
              }
              if (theme === "light" && !nearCobalt(paint.border)) {
                failures.push(`${path} ${width} ${theme}: button border is ${paint.border}`);
              }
              const paintedFocus = await scan(page, `accountant ${path} ${width} ${theme} focus ${focusSel}`, {
                accountant: true,
              });
              for (const hit of paintedFocus.hits) failures.push(`${hit.path} ${hit.sample}`);
            }
          }
          if (path.includes("tab=health")) {
            const email = page.locator("[data-email-owner]");
            await email.waitFor({ timeout: 15000 });
            const border = await email.evaluate((el) => getComputedStyle(el).borderTopColor);
            const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(border);
            const rgb = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
            const want = cobalt[theme];
            const dist = rgb
              ? Math.hypot(rgb[0] - want[0], rgb[1] - want[1], rgb[2] - want[2])
              : 999;
            if (dist > 20) {
              failures.push(`${path} ${width} ${theme}: Email the owner border is ${border}, expected cobalt`);
            }
          }
          await page.close();
        }
      }
    }

    const ownerViews = ["rest", "health", "cash", "profit", "budget", "moves", "accountant"];
    for (const view of ownerViews) {
      for (const width of [1280, 385]) {
        for (const theme of ["light", "dark"] as const) {
          const page = await browser.newPage({ viewport: { width, height: 844 } });
          await page.goto(`${HARNESS}/owner-door?view=${view}`, { waitUntil: "domcontentloaded" });
          await page.waitForSelector("[data-owner-ready='true']", { timeout: 20000 });
          await page.evaluate((next) => {
            document.documentElement.dataset.theme = next;
            document.documentElement.classList.toggle("dark", next === "dark");
          }, theme);
          await page.waitForTimeout(250);
          const logo = page.locator(".gold-text").first();
          if ((await logo.count()) === 0) failures.push(`owner ${view} ${width} ${theme}: wordmark missing`);
          else {
            const bg = await logo.evaluate((el) => getComputedStyle(el).backgroundImage);
            if (!bg.includes("212, 175, 55") && !bg.includes("172, 132, 0")) {
              failures.push(`owner ${view} ${width} ${theme}: wordmark is not gold`);
            }
          }
          const painted = await scan(page, `owner ${view} ${width} ${theme}`, { owner: true });
          for (const hit of painted.hits) failures.push(`${hit.path} ${hit.sample}`);
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    stopServer();
    stopHarness();
  }
  if (failures.length) {
    console.error(failures.slice(0, 50).join("\n"));
    throw new Error(`${failures.length} gold scan failure(s)`);
  }
  console.log("landing-gold-scan: ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  stopServer();
  stopHarness();
  process.exit(1);
});
