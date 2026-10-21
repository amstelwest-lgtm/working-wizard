/**
 * Browser: sign in on one tab, open /clients and /app in new tabs, stay signed in.
 * Run: pnpm test:new-tab-session-e2e
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const PORT = 4191;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CLIENT = "00000000-0000-4000-8000-000000000102";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function sessionJson(): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  return JSON.stringify({
    access_token: "access-new-tab",
    refresh_token: "refresh-new-tab",
    expires_at: exp,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: "user-new-tab",
      aud: "authenticated",
      role: "authenticated",
      email: "aqa@firm.example",
      app_metadata: {},
      user_metadata: { signup_type: "accountant", firm_name: "AQA Firm" },
    },
  });
}

function installChromium(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "playwright", "install", "chromium"], {
      stdio: "inherit",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("playwright install timed out"));
    }, 180_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`playwright install exited ${code}`));
    });
  });
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    /* system Chrome is not on every image */
  }
  try {
    return await chromium.launch({ headless: true });
  } catch {
    /* bundled browser not installed yet */
  }
  await installChromium();
  return chromium.launch({ headless: true });
}

function startDevServer(): ChildProcess {
  return spawn(
    "pnpm",
    ["exec", "vite", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

/** `detached: true` makes this pid the process-group leader, so Vite dies with pnpm. */
function killGroup(child: ChildProcess | undefined): void {
  const pid = child?.pid;
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function killPid(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Chrome is a child of this process. Close can hang, so the leftover tree is killed too. */
function killDirectChildren(parentPid: number): void {
  let entries: string[] = [];
  try {
    entries = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 2);
      const ppid = Number(rest.split(" ")[1]);
      if (ppid === parentPid) killPid(Number(entry));
    } catch {
      /* process exited while we were reading */
    }
  }
}

async function waitForServer(child: ChildProcess): Promise<void> {
  let log = "";
  child.stdout?.on("data", (chunk) => {
    log += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    log += String(chunk);
  });
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    if (child.exitCode != null) throw new Error(`vite exited ${child.exitCode}\n${log}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    try {
      const res = await fetch(ORIGIN, { signal: ctrl.signal });
      if (res.status < 500) return;
    } catch {
      /* not up yet, or this probe timed out */
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`vite did not listen on ${ORIGIN}\n${log.slice(-2000)}`);
}

async function staySignedIn(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const deadline = Date.now() + 25_000;
  let path = new URL(page.url()).pathname;
  while (Date.now() < deadline) {
    path = new URL(page.url()).pathname;
    if (path === "/auth" || path.startsWith("/auth/")) break;
    const text = await page.locator("body").innerText().catch(() => "");
    if (/practice sign-in/i.test(text)) break;
    if (text.length > 0 && !/loading dashboard/i.test(text)) break;
    await page.waitForTimeout(400);
  }
  path = new URL(page.url()).pathname;
  const text = await page.locator("body").innerText().catch(() => "");
  assert(path !== "/auth" && !path.startsWith("/auth/"), `${label} redirected to ${path}`);
  assert(!/practice sign-in/i.test(text), `${label} shows Practice sign-in`);
}

async function main() {
  const server = startDevServer();
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let killer: ReturnType<typeof setTimeout> | undefined;
  let shuttingDown = false;

  async function shutdown(code: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    if (killer) clearTimeout(killer);
    try {
      await Promise.race([
        (async () => {
          await context?.close().catch(() => undefined);
          await browser?.close().catch(() => undefined);
        })(),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    } finally {
      killGroup(server);
      killDirectChildren(process.pid);
      process.exit(code);
    }
  }

  killer = setTimeout(() => {
    console.error("new-tab-session-e2e: timed out");
    void shutdown(1);
  }, 240_000);

  try {
    await waitForServer(server);
    browser = await launchBrowser();
    context = await browser.newContext();
    await context.route(/supabase\.co/, (route) => route.abort());

    const tab1 = await context.newPage();
    await tab1.goto(`${ORIGIN}/auth`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const storageKey = "sb-example-auth-token";
    const body = sessionJson();
    await tab1.evaluate(
      ({ storageKey, body }) => {
        sessionStorage.setItem(storageKey, body);
      },
      { storageKey, body },
    );
    await tab1.reload({ waitUntil: "domcontentloaded" });
    await tab1.waitForFunction((storageKey) => localStorage.getItem(storageKey), storageKey, {
      timeout: 30_000,
    });
    const published = await tab1.evaluate((storageKey) => localStorage.getItem(storageKey), storageKey);
    assert(published != null && published.includes("user-new-tab"), "tab 1 published the session to localStorage");

    await tab1.goto(`${ORIGIN}/clients/${CLIENT}?tab=home`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await staySignedIn(tab1, "tab 1 /clients");

    const tab2 = await context.newPage();
    await tab2.goto(`${ORIGIN}/clients`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await staySignedIn(tab2, "tab 2 /clients");
    await tab2.reload({ waitUntil: "domcontentloaded" });
    await staySignedIn(tab2, "tab 2 first reload");
    await tab2.reload({ waitUntil: "domcontentloaded" });
    await staySignedIn(tab2, "tab 2 second reload");

    const owner = await context.newPage();
    await owner.goto(`${ORIGIN}/app`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await staySignedIn(owner, "owner /app");
    assert(new URL(owner.url()).pathname === "/app", `owner tab left /app for ${owner.url()}`);

    const tab1Path = new URL(tab1.url()).pathname;
    assert(tab1Path.startsWith("/clients"), `tab 1 left the client for ${tab1Path}`);
    console.log("new-tab-session-e2e: ok");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await shutdown(process.exitCode === 1 ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
