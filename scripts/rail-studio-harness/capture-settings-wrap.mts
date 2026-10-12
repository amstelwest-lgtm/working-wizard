/**
 * Mobile settings wrap shots. Expects the Vite harness on 127.0.0.1:4179.
 * Usage: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/rail-studio-harness/capture-settings-wrap.mts before|after
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const phase = process.argv[2] === "after" ? "after" : "before";
const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";
const email = "alexandra.van.der.westhuizen+billing@harbourandcompany.example";
const practice = "Harbour & Co Advisory Partnership of the Western Cape";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];
const checks: Record<string, unknown> = {};

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
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
}

async function stretch(page: Page) {
  await page.evaluate(
    ({ email, practice }) => {
      const setText = (el: Element, text: string) => {
        el.textContent = text;
      };
      document.querySelectorAll(".firm-chip b, .owner-biz b").forEach((el) => setText(el, practice));
      document.querySelectorAll(".settings-value").forEach((el) => {
        const label = el.previousElementSibling?.textContent ?? "";
        if (/signed in/i.test(label) || (el.textContent ?? "").includes("@")) setText(el, email);
      });
      document.querySelectorAll(".settings-portal li").forEach((el) => {
        el.querySelectorAll("div, span, p").forEach((node) => {
          if ((node.textContent ?? "").includes("@") && node.children.length === 0) setText(node, email);
        });
      });
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      document.querySelectorAll("input").forEach((node) => {
        const input = node as HTMLInputElement;
        const hint = `${input.placeholder} ${input.getAttribute("aria-label") ?? ""}`;
        const label = input.closest("div")?.querySelector("label")?.textContent ?? "";
        if (/firm name/i.test(label) && proto?.set) {
          proto.set.call(input, practice);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if ((input.type === "email" || /email/i.test(hint)) && input.placeholder) {
          input.placeholder = email;
        }
      });
      const menu = document.querySelector(".owner-menu");
      if (menu && !menu.querySelector("[data-long-practice]")) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "owner-menu-item";
        item.dataset.longPractice = "true";
        item.textContent = practice;
        menu.prepend(item);
        const mail = document.createElement("button");
        mail.type = "button";
        mail.className = "owner-menu-item";
        mail.dataset.longEmail = "true";
        mail.textContent = email;
        menu.prepend(mail);
      }
    },
    { email, practice },
  );
}

async function audit(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders: { text: string; cls: string; whiteSpace: string; overflow: string }[] = [];
    const roots = document.querySelectorAll(
      ".settings-portal, .owner-door, .settings-menu, .owner-menu, .firm-chip, .topbar",
    );
    const seen = new Set<Element>();
    roots.forEach((root) => {
      root.querySelectorAll("*").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return;
        if (el.classList.contains("gear-label")) return;
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text || el.children.length > 0) return;
        const clipped =
          cs.textOverflow === "ellipsis" ||
          (cs.whiteSpace === "nowrap" && el.scrollWidth > el.clientWidth + 1);
        if (clipped) {
          offenders.push({
            text: text.slice(0, 80),
            cls: el.className?.toString?.().slice(0, 80) ?? "",
            whiteSpace: cs.whiteSpace,
            overflow: cs.textOverflow,
          });
        }
      });
    });
    const menu = document.querySelector(".settings-menu, .owner-menu");
    const rect = menu?.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: vw,
      overflow: document.documentElement.scrollWidth - vw,
      menu: rect
        ? {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            fits: rect.left >= -1 && rect.right <= vw + 1 && rect.width <= vw,
          }
        : null,
      offenders: offenders.slice(0, 12),
    };
  });
}

async function shot(page: Page, name: string, fullPage = false) {
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage });
  written.push(file);
  console.log("shot", name);
}

async function clickSelector(page: Page, selector: string) {
  await page.locator(selector).first().evaluate((el) => (el as HTMLElement).click());
}

const widths = [390, 360] as const;

for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await prepare(page);

  await openReady(page, "/dashboard");
  await page.waitForSelector("[data-settings-trigger]", { timeout: 20000 });
  await stretch(page);
  await clickSelector(page, "[data-settings-trigger]");
  await page.waitForSelector("[data-settings-menu]", { timeout: 5000 });
  await stretch(page);
  checks[`accountant-menu-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-accountant-menu-${width}`);

  await openReady(page, "/settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 20000 });
  await stretch(page);
  checks[`settings-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-settings-${width}`, true);

  await openReady(page, "/settings/brand");
  await page.getByRole("heading", { name: /Brand/i }).waitFor({ timeout: 20000 });
  await stretch(page);
  checks[`brand-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-brand-${width}`, true);

  await openReady(page, "/settings/team");
  await page.getByRole("heading", { name: /Team/i }).first().waitFor({ timeout: 20000 });
  await stretch(page);
  checks[`team-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-team-${width}`, true);

  await openReady(page, "/settings#firm-billing");
  await page.locator("#firm-billing").waitFor({ timeout: 20000 });
  await page.locator("#firm-billing").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await stretch(page);
  checks[`billing-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-billing-${width}`);

  await openReady(page, "/owner-door?view=settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 20000 });
  await stretch(page);
  checks[`owner-settings-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-owner-settings-${width}`, true);

  await clickSelector(page, ".owner-account .profile-chip");
  await page.waitForSelector(".owner-menu", { timeout: 5000 });
  await stretch(page);
  checks[`owner-menu-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-owner-menu-${width}`);

  await openReady(page, "/owner-door?view=plan&bill=firm");
  await page.getByRole("heading", { name: "Plan" }).waitFor({ timeout: 20000 });
  await stretch(page);
  checks[`owner-plan-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-owner-plan-${width}`, true);

  await clickSelector(page, "[data-settings-trigger]");
  await page.waitForSelector("[data-settings-menu]", { timeout: 5000 });
  checks[`owner-settings-menu-${width}`] = await audit(page);
  await shot(page, `settings-${phase}-owner-settings-menu-${width}`);

  await page.close();
}

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/settings-${phase}-audit.json`, JSON.stringify(checks, null, 2));
console.log(JSON.stringify({ phase, written, checks }, null, 2));
await browser.close();
