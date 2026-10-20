/**
 * Computed-style scan of `/`, `/terms`, `/privacy`, and `/join/:token`, plus
 * the accountant practice first-run (`/practice?firstRun=1` and the empty
 * clients list). Brand gold may remain only on the MILŌN wordmark (header,
 * footer, hero mockup mark, invite shell), the hero trial button, and the
 * 390 sticky trial button. On the practice first-run the wordmark stays gold.
 * The amber "74" status colour is not brand gold. Legal hero sublines must
 * not render "Inc..". The invite page has no gold button.
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

function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    try {
      server.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  server = null;
}

function stopHarness() {
  if (!harness?.pid) return;
  try {
    process.kill(-harness.pid, "SIGTERM");
  } catch {
    try {
      harness.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
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
  const fd = openSync("/tmp/practice-gold-scan-vite.log", "w");
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
      const res = await fetch(`${HARNESS}/practice?firstRun=1`);
      if (res.status === 200) return;
      last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`practice harness did not come up at ${HARNESS} (${last})`);
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
  opts?: { practice?: boolean },
): Promise<{ hits: Hit[]; wordmark: boolean; heroCta: boolean; amber74: boolean }> {
  return page.evaluate(({ labelIn, practice }) => {
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
      if (practice) return Boolean(el.closest(".gold-text"));
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
  }, { labelIn: label, practice: Boolean(opts?.practice) });
}

async function main() {
  if (OWNED) startServer();
  if (HARNESS_OWNED) startHarness();
  await waitForHome();
  await waitForHarness();
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
    const practicePaths = ["/practice?firstRun=1", "/clients?firstRun=1"];
    for (const path of practicePaths) {
      for (const width of [1280, 390]) {
        for (const theme of ["light", "dark"] as const) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          await page.goto(`${HARNESS}${path}`, { waitUntil: "domcontentloaded" });
          const logo = page.locator(".gold-text:visible").first();
          await logo.waitFor({ timeout: 60000 });
          await page.waitForTimeout(500);
          await page.evaluate((next) => {
            document.documentElement.dataset.theme = next;
            document.documentElement.classList.toggle("dark", next === "dark");
          }, theme);
          const bg = await logo.evaluate((el) => getComputedStyle(el).backgroundImage);
          if (!bg.includes("212, 175, 55") && !bg.includes("172, 132, 0")) {
            failures.push(`${path} ${width} ${theme}: practice wordmark is not gold`);
          }
          const painted = await scan(page, `practice ${path} ${width} ${theme}`, { practice: true });
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
