/**
 * Local screenshots of the owner walkthrough fixes. No Vercel deploy.
 * Expects the harness on 127.0.0.1:4179.
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

async function openOwner(page: Page, view: string) {
  await page.goto(`${base}/owner-door?view=${view}`, { waitUntil: "networkidle" });
  await page.locator("[data-owner-ready='true']").waitFor({ timeout: 20000 });
}

async function menuContrast(page: Page) {
  await page.getByRole("button", { name: "Owner menu" }).click();
  await page.locator(".owner-menu").waitFor();
  const colors = await page.evaluate(() => {
    const menu = document.querySelector(".owner-menu");
    const item = document.querySelector(".owner-menu-item");
    if (!menu || !item) return null;
    const menuStyle = getComputedStyle(menu);
    const itemStyle = getComputedStyle(item);
    return {
      menu: menuStyle.backgroundColor,
      item: itemStyle.color,
      label: item.textContent?.trim() ?? "",
    };
  });
  assert(colors, "owner menu did not render");
  assert(colors.item === "rgb(16, 42, 67)", `menu item ink is ${colors.item}`);
  assert(colors.menu === "rgb(255, 255, 255)", `menu surface is ${colors.menu}`);
  await page.keyboard.press("Escape");
  await page.locator(".owner-menu").waitFor({ state: "hidden" });
}

async function waterfallLabels(page: Page) {
  const labels = await page.locator("[data-waterfall-layout='horizontal'] li span").allTextContents();
  const joined = labels.join(" | ");
  assert(labels.some((label) => label.trim() === "Revenue"), `waterfall labels: ${joined}`);
  assert(labels.some((label) => /Cost of Sales/i.test(label)), `waterfall labels: ${joined}`);
  assert(labels.some((label) => /Gross Profit/i.test(label)), `waterfall labels: ${joined}`);
  assert(!labels.some((label) => /^Rever|COS$|J\.\./.test(label.trim())), `clipped waterfall label: ${joined}`);
}

async function budgetAxis(page: Page) {
  const axis = await page.evaluate(() => {
    const ticks = [...document.querySelectorAll(".recharts-xAxis text")].map((node) => node.textContent ?? "");
    const readout = document.querySelector("[data-budget-axis='readout']");
    const hidden = readout ? getComputedStyle(readout).display === "none" : false;
    return { ticks, hidden };
  });
  assert(axis.ticks.length > 0, "budget chart has no month axis");
  assert(axis.ticks.every((tick) => !tick.includes("..")), `budget ticks truncated: ${axis.ticks.join(",")}`);
  assert(axis.ticks.some((tick) => tick.length >= 3), `budget ticks are not month names: ${axis.ticks.join(",")}`);
  assert(axis.hidden, "the second budget axis row is still visible");
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll(".recharts-xAxis text")].map((node) => {
      const box = node.getBoundingClientRect();
      return { t: node.textContent ?? "", left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
  );
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      assert(overlapX < 1 || overlapY < 1, `${a.t} overlaps ${b.t}`);
    }
  }
}

async function pillarFit(page: Page) {
  await page.getByRole("button", { name: /Business Health Score/ }).click();
  await page.locator(".owner-pillar-card").first().waitFor();
  const overflow = await page.evaluate(() => {
    return [...document.querySelectorAll(".owner-pillar-card")].map((card) => {
      const orb = card.querySelector(".sphere-orb");
      const cardBox = card.getBoundingClientRect();
      const orbBox = orb?.getBoundingClientRect();
      if (!orbBox) return { label: "missing", overflow: 99 };
      const spill = Math.max(
        cardBox.left - orbBox.left,
        orbBox.right - cardBox.right,
        cardBox.top - orbBox.top,
        orbBox.bottom - cardBox.bottom,
      );
      return { label: orb.getAttribute("aria-label"), overflow: Math.round(spill) };
    });
  });
  for (const row of overflow) {
    assert(row.overflow <= 1, `${row.label} overflows its card by ${row.overflow}px`);
  }
}

async function navVertical(page: Page) {
  const strip = await page.evaluate(() => {
    const rail = document.querySelector(".deliverable-rail");
    if (!rail) return { display: "missing", direction: "" };
    const style = getComputedStyle(rail);
    return { display: style.display, direction: style.flexDirection };
  });
  assert(strip.display === "none", `phone rail is ${strip.display} ${strip.direction}`);
  await page.getByRole("button", { name: "Open menu" }).click();
  const open = await page.evaluate(() => {
    const rail = document.querySelector(".deliverable-rail");
    const style = rail ? getComputedStyle(rail) : null;
    const labels = [...document.querySelectorAll(".deliverable-rail .tab-text")].map((node) =>
      (node.textContent ?? "").trim(),
    );
    return { direction: style?.flexDirection ?? "", labels };
  });
  assert(open.direction === "column", `open nav is ${open.direction}`);
  assert(open.labels.includes("Home") && open.labels.includes("Next moves"), open.labels.join(", "));
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await openOwner(phone, "rest");
await menuContrast(phone);
await shot(phone, "owner-menu-390");
await phone.getByRole("button", { name: "Owner menu" }).click();
await phone.locator(".owner-menu").waitFor();
await shot(phone, "owner-menu-open-390");

await openOwner(phone, "profit");
await waterfallLabels(phone);
await shot(phone, "owner-profit-390");

await openOwner(phone, "budget");
await phone.locator("[data-budget-axis='chart']").waitFor();
await budgetAxis(phone);
await shot(phone, "owner-budget-390");

await openOwner(phone, "health");
await pillarFit(phone);
await shot(phone, "owner-health-pillars-390");

await openOwner(phone, "rest");
await navVertical(phone);
await shot(phone, "owner-nav-390");

const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await openOwner(desk, "rest");
await menuContrast(desk);
await desk.getByRole("button", { name: "Owner menu" }).click();
await desk.locator(".owner-menu").waitFor();
await shot(desk, "owner-menu-open-1280");

await openOwner(desk, "profit");
await desk.locator(".min-w-\\[560px\\]").waitFor();
await shot(desk, "owner-profit-1280");

await openOwner(desk, "budget");
await desk.locator("[data-budget-axis='readout']").waitFor();
const deskReadout = await desk.evaluate(() => {
  const readout = document.querySelector("[data-budget-axis='readout']");
  return readout ? getComputedStyle(readout).display : "missing";
});
assert(deskReadout !== "none", "desktop budget readout should stay");
await shot(desk, "owner-budget-1280");

await openOwner(desk, "health");
await pillarFit(desk);
await shot(desk, "owner-health-pillars-1280");

const deskNav = await desk.evaluate(() => {
  const rail = document.querySelector(".deliverable-rail");
  return rail ? getComputedStyle(rail).flexDirection : "missing";
});
assert(deskNav === "column", `desktop rail is ${deskNav}`);
await shot(desk, "owner-nav-1280");

await browser.close();
console.log("owner fix screenshots ok");
