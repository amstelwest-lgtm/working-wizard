/**
 * 390px proof that the phone drawer closes from the overlay, Escape, and the corner X.
 * Expects the harness on 127.0.0.1:4179. No Vercel deploy.
 */
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function shot(page: Page, name: string) {
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(file);
}

async function drawerOpen(page: Page) {
  return page.evaluate(() => document.querySelector(".accountant-portal")?.classList.contains("nav-open") ?? false);
}

async function openDrawer(page: Page) {
  if (!(await drawerOpen(page))) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await page.locator(".drawer-close").waitFor();
  assert(await drawerOpen(page), "drawer did not open");
}

async function closeButtonSitsInTheCorner(page: Page) {
  const box = await page.evaluate(() => {
    const rail = document.querySelector(".deliverable-rail");
    const close = document.querySelector(".drawer-close");
    if (!rail || !close) return null;
    const railBox = rail.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    const style = getComputedStyle(close);
    return {
      display: style.display,
      railRight: railBox.right,
      closeRight: closeBox.right,
      closeTop: closeBox.top,
      railTop: railBox.top,
      label: close.getAttribute("aria-label"),
    };
  });
  assert(box, "close button is missing");
  assert(box.display !== "none", "close button is hidden");
  assert(box.label === "Close menu", "close button is unnamed");
  assert(box.closeTop < 48, `close button is not at the top (${box.closeTop})`);
  assert(Math.abs(box.railRight - box.closeRight) < 28, `close button is not at the drawer's right edge (${box.closeRight} vs ${box.railRight})`);
}

async function outsideTapCloses(page: Page) {
  await openDrawer(page);
  const point = await page.evaluate(() => {
    const rail = document.querySelector(".deliverable-rail")!.getBoundingClientRect();
    return { x: Math.min(window.innerWidth - 12, rail.right + 24), y: 180 };
  });
  await page.mouse.click(point.x, point.y);
  await page.locator(".deliverable-rail").waitFor({ state: "hidden" });
  assert(!(await drawerOpen(page)), "a tap outside left the drawer open");
}

async function escapeCloses(page: Page) {
  await openDrawer(page);
  await page.keyboard.press("Escape");
  await page.locator(".deliverable-rail").waitFor({ state: "hidden" });
  assert(!(await drawerOpen(page)), "Escape left the drawer open");
}

async function cornerXCloses(page: Page) {
  await openDrawer(page);
  await page.locator(".drawer-close").click();
  await page.locator(".deliverable-rail").waitFor({ state: "hidden" });
  assert(!(await drawerOpen(page)), "the corner X left the drawer open");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
await mkdir(outDir, { recursive: true });

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${base}/owner-door?view=home`, { waitUntil: "networkidle" });
await phone.locator("[data-owner-ready='true']").waitFor();
await openDrawer(phone);
await closeButtonSitsInTheCorner(phone);
await shot(phone, "owner-drawer-close-390");
await phone.locator(".drawer-close").click();
await phone.locator(".deliverable-rail").waitFor({ state: "hidden" });
await outsideTapCloses(phone);
await escapeCloses(phone);
await cornerXCloses(phone);

await phone.goto(`${base}/clients/harness-client?tab=health`, { waitUntil: "networkidle" });
await phone.locator("[data-rail-ready='true']").waitFor();
await openDrawer(phone);
await phone.locator(".nav-sub-link").first().waitFor();
await closeButtonSitsInTheCorner(phone);
await shot(phone, "accountant-drawer-close-390");
await outsideTapCloses(phone);
await escapeCloses(phone);
await cornerXCloses(phone);

await browser.close();
console.log("drawer dismiss captured");
