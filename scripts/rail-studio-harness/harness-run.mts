/**
 * Runs a Playwright check against the rail harness. Starts its own harness on
 * `port` unless HARNESS_URL points at one already running (pnpm harness:dev),
 * launches a browser, and always exits: a failure, a thrown error or the time
 * limit stops the browser and the harness instead of leaving the job open.
 */
import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { chromium, type Browser } from "playwright";

type Harness = { base: string; browser: Browser };

const BOOT_MS = 120_000;

let child: ReturnType<typeof spawn> | null = null;

function stopHarness() {
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
  child = null;
}

function startHarness(name: string, port: number): string {
  const fd = openSync(`/tmp/${name}-harness.log`, "w");
  child = spawn(
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
      String(port),
      "--strictPort",
    ],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  process.on("exit", stopHarness);
  return `http://127.0.0.1:${port}`;
}

async function waitForHarness(base: string, name: string) {
  const deadline = Date.now() + BOOT_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/clients`);
      if (res.status === 200) {
        if ((await res.text()).includes("Rail harness")) return;
        last = "200 without the harness shell";
      } else last = String(res.status);
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`the harness did not come up at ${base} (${last}); see /tmp/${name}-harness.log`);
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
  const inst = spawnSync("pnpm", ["exec", "playwright", "install", "chromium"], {
    stdio: "inherit",
  });
  if (inst.status !== 0) throw new Error("could not install Playwright chromium");
  return chromium.launch({ headless: true });
}

export async function runOnHarness(
  name: string,
  { port, limitMs = 5 * 60_000 }: { port: number; limitMs?: number },
  check: (harness: Harness) => Promise<void>,
): Promise<never> {
  let browser: Browser | null = null;
  const finish = async (code: number) => {
    await browser?.close().catch(() => undefined);
    stopHarness();
    process.exit(code);
  };
  const timer = setTimeout(() => {
    console.error(`FAIL: ${name} did not finish within ${limitMs / 1000}s`);
    void finish(1);
  }, limitMs);
  try {
    const base = process.env.HARNESS_URL ?? startHarness(name, port);
    await waitForHarness(base, name);
    browser = await launch();
    // A cold harness optimises its dependencies on the first visit and reloads the
    // page; take that hit here so the check's own waits measure the page.
    const warm = await browser.newPage();
    await warm.goto(`${base}/milon-team-desk?fixture=live&agent=advisor`, {
      waitUntil: "networkidle",
      timeout: BOOT_MS,
    });
    await warm.waitForSelector("[data-agent-stage]", { timeout: BOOT_MS });
    await warm.close();
    await check({ base, browser });
    clearTimeout(timer);
    return await finish(0);
  } catch (err) {
    clearTimeout(timer);
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    return await finish(1);
  }
}
