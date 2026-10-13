/**
 * 390px screenshots of the owner mobile pass. Local harness only.
 * No Vercel deploy.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const outDir = "/opt/cursor/artifacts/screenshots";
const base = "http://127.0.0.1:4179";

const shots: { name: string; url: string; ready: string; click?: string }[] = [
  { name: "owner-home-390", url: "/owner-door?view=rest&signoff=signed", ready: "[data-owner-ready='true']" },
  { name: "owner-health-390", url: "/owner-door?view=health&signoff=signed", ready: "[data-owner-page='health']" },
  { name: "owner-cash-390", url: "/owner-door?view=cash&signoff=signed", ready: "[data-owner-page='cash']" },
  { name: "owner-profit-390", url: "/owner-door?view=profit&signoff=signed", ready: "[data-owner-page='profit']" },
  { name: "owner-budget-390", url: "/owner-door?view=budget&signoff=signed", ready: "[data-owner-page='budget']" },
  { name: "owner-moves-390", url: "/owner-door?view=moves&signoff=signed", ready: "[data-owner-page='moves']" },
  {
    name: "owner-cash-graph-enlarged-390",
    url: "/owner-door?view=cash&signoff=signed",
    ready: "[data-owner-page='cash']",
    click: "Enlarge cash flow graph",
  },
  {
    name: "owner-cash-table-enlarged-390",
    url: "/owner-door?view=cash&signoff=signed",
    ready: "[data-owner-page='cash']",
    click: "Enlarge cash flow table",
  },
  {
    name: "owner-profit-enlarged-390",
    url: "/owner-door?view=profit&signoff=signed",
    ready: "[data-owner-page='profit']",
    click: "Enlarge profitability waterfall",
  },
  { name: "accountant-cash-390", url: "/clients/harness-client?tab=cash", ready: "#pane-cash" },
  { name: "accountant-profit-390", url: "/clients/harness-client?tab=profit", ready: "#pane-profit" },
  { name: "accountant-reports-390", url: "/clients/harness-client?tab=reports", ready: "#reports-pdfs" },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

for (const shot of shots) {
  await page.goto(`${base}${shot.url}`, { waitUntil: "networkidle" });
  await page.waitForSelector(shot.ready, { timeout: 20000 });
  await page.waitForTimeout(400);
  if (shot.click) {
    await page.getByRole("button", { name: shot.click }).click();
    await page.waitForSelector(".enlarge-sheet", { timeout: 5000 });
    await page.waitForTimeout(500);
  }
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const offenders: string[] = [];
    const nodes = document.body.querySelectorAll<HTMLElement>("*");
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (rect.right > root.clientWidth + 2 || rect.left < -2) {
        const id = el.id ? `#${el.id}` : el.className?.toString?.().slice(0, 80) || el.tagName;
        offenders.push(`${id} L${Math.round(rect.left)} R${Math.round(rect.right)}`);
        if (offenders.length > 8) break;
      }
    }
    return { scroll: root.scrollWidth - root.clientWidth, offenders };
  });
  const file = `${outDir}/${shot.name}.png`;
  await page.screenshot({ path: file, fullPage: !shot.click });
  console.log(file, JSON.stringify(overflow));
  if (shot.click) await page.keyboard.press("Escape");
}

await browser.close();
