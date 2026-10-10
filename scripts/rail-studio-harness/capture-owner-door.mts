/**
 * Local screenshots of the owner-door preview. No production server, no Vercel.
 * Expects the harness on 127.0.0.1:4179.
 */
import { copyFile, mkdir, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4179/owner-door";
const outDir = "/opt/cursor/artifacts/screenshots";

const shots: { name: string; view: string }[] = [
  { name: "owner-door-home-rest", view: "rest" },
  { name: "owner-door-home-work", view: "work" },
  { name: "owner-door-chat", view: "chat" },
  { name: "owner-door-ask", view: "ask" },
];

const widths = [
  { suffix: "1280", width: 1280, height: 900 },
  { suffix: "390", width: 390, height: 844 },
];

function seconds(file: string): number {
  const ffmpeg = "/home/ubuntu/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux";
  const probe = spawnSync(ffmpeg, ["-i", file], { encoding: "utf8" });
  const text = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  const match = text.match(/Duration:\s(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`no duration for ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const size of widths) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  for (const shot of shots) {
    await page.goto(`${base}?view=${shot.view}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-owner-ready='true']");
    const target =
      shot.view === "ask" ? page.locator(".owner-agents") : page.locator(".owner-door");
    const file = `${outDir}/${shot.name}-${size.suffix}.png`;
    await target.screenshot({ path: file });
    console.log(file);
  }
  await page.close();
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: "/tmp/owner-door-motion", size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto(`${base}?view=reel`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-owner-reel='play']");
await page.waitForSelector("[data-owner-reel='done']", { timeout: 20000 });
await page.close();
await context.close();
const video = page.video();
if (!video) throw new Error("no motion clip");
const raw = await video.path();
const clip = `${outDir}/owner-door-motion.webm`;
await copyFile(raw, clip);
await unlink(raw).catch(() => undefined);
const duration = seconds(clip);
console.log(`${clip} ${duration.toFixed(2)}s`);
if (duration < 6 || duration > 8.2) throw new Error(`motion clip is ${duration.toFixed(2)}s`);

await browser.close();
