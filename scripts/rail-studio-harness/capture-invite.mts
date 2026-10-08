/**
 * Staff-invite landing screenshots. Expects the harness on 127.0.0.1:4179.
 * Does not start the production app, call Supabase, or send email.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4179";
const outDir = "/opt/cursor/artifacts/screenshots";

const shots: { name: string; path: string; width: number; height: number }[] = [
  { name: "invite-landing-new-user-1280", path: "/invite?view=landing", width: 1280, height: 900 },
  { name: "invite-create-account-1280", path: "/invite?view=create", width: 1280, height: 900 },
  { name: "invite-accepted-workspace-1280", path: "/invite?view=workspace", width: 1280, height: 900 },
  { name: "invite-revoked-1280", path: "/invite?view=revoked", width: 1280, height: 900 },
  { name: "invite-landing-390", path: "/invite?view=landing", width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const written: string[] = [];
await mkdir(outDir, { recursive: true });

for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  const blocked: string[] = [];
  page.on("request", (request) => {
    if (/supabase\.(co|in|com)/i.test(request.url())) blocked.push(request.url());
  });
  await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-invite-ready='true']");
  if (shot.name.includes("revoked")) {
    await page.getByText("This invite is no longer valid. Ask your firm admin to send a new one.").waitFor();
  }
  if (shot.name.includes("create-account")) {
    await page.locator("#staff-invite-password").focus();
  }
  const file = `${outDir}/${shot.name}.png`;
  await page.screenshot({ path: file, fullPage: shot.width < 500 });
  if (blocked.length) throw new Error(`Supabase request during ${shot.name}: ${blocked.join(", ")}`);
  written.push(file);
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ written }, null, 2));
