/**
 * The block menu on accountant client Home switches views in place: the page does
 * not jump back to the top, and the menu stays where it was on screen even when the
 * next view is shorter. Starts its own harness, or uses HARNESS_URL.
 * Run: pnpm e2e:paged-menu-scroll
 */
import { runOnHarness } from "./harness-run.mts";

const cases = [{ path: "/clients/harness-client?tab=home", menu: "[data-home-menu]" }];
const sizes = [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
];

const failures: string[] = [];
await runOnHarness("paged-menu-scroll", { port: 5203 }, async ({ base, browser }) => {
  for (const size of sizes) {
    for (const { path, menu } of cases) {
      const context = await browser.newContext({ viewport: size });
      const page = await context.newPage();
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      const tabs = page.locator(`${menu} [role="tab"]`);
      await tabs.first().waitFor({ timeout: 20000 });
      const count = await tabs.count();
      for (let i = 1; i < count + 1; i += 1) {
        const tab = tabs.nth(i % count);
        await tab.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(150);
        const menuTop = () =>
          page.evaluate(
            (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? Number.NaN,
            menu,
          );
        const before = await page.evaluate(() => window.scrollY);
        const topBefore = await menuTop();
        const label = (await tab.innerText()).split("\n")[0];
        const box = await tab.boundingBox();
        if (!box) throw new Error(`no box for ${label}`);
        // A plain mouse click: locator.click() may scroll the page itself before clicking.
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1300);
        const after = await page.evaluate(() => window.scrollY);
        const topAfter = await menuTop();
        const selected = await tab.getAttribute("aria-selected");
        const where = `${path} ${size.width}x${size.height} "${label}"`;
        if (selected !== "true") failures.push(`${where}: the tab did not open`);
        if (before > 0 && after < before - 2) {
          failures.push(
            `${where}: the page jumped from ${Math.round(before)} to ${Math.round(after)}`,
          );
        }
        if (!(Math.abs(topAfter - topBefore) <= 2)) {
          failures.push(
            `${where}: the menu moved from ${Math.round(topBefore)} to ${Math.round(topAfter)}`,
          );
        }
      }
      await context.close();
    }
  }
  if (failures.length) throw new Error(failures.join("\nFAIL: "));
  console.log("ok: the Home block menu stays in place when switching views");
});
