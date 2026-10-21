/**
 * Apex auth links are built for www, and the apex host 308 keeps path and query.
 * Browsers reapply the URL fragment after that redirect, so the Location header
 * is asserted without a hash and Chrome is checked for #access_token.
 * Run: pnpm test:apex-www-redirect
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import {
  appRedirectOrigin,
  CANONICAL_APP_ORIGIN,
  canonicalAuthOrigin,
  canonicalAuthUrl,
} from "../src/lib/app-origin";
import { emailSignInRedirectTo } from "../src/lib/email-sign-in";
import { checkoutEmailRedirectTo } from "../src/lib/pending-checkout";
import { googleOAuthRedirectTo } from "../src/lib/google-auth";
import { staffInviteEmailRedirectTo } from "../src/lib/staff-invite-landing";
import { inviteSiteUrl } from "../src/lib/client-invite-email";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const WWW = CANONICAL_APP_ORIGIN;

assert(
  emailSignInRedirectTo("https://milonfinance.com", "accountant") ===
    `${WWW}/auth/callback?door=accountant`,
  "a magic link built on the apex returns on www",
);
assert(
  emailSignInRedirectTo("https://www.milonfinance.com/", "owner", "/ops") ===
    `${WWW}/auth/callback?door=owner&next=%2Fops`,
  "www magic links stay on www and keep next",
);
assert(
  checkoutEmailRedirectTo("https://milonfinance.com", {
    plan: "solo",
    interval: "month",
    market: "za",
  }).startsWith(`${WWW}/auth/callback?`),
  "checkout confirmation built on the apex returns on www",
);
assert(
  googleOAuthRedirectTo("https://milonfinance.com", { token: "tok", clientCode: "MLN-1" }) ===
    `${WWW}/auth/callback?invite=tok&cc=MLN-1`,
  "owner-invite Google on the apex returns on www",
);
assert(
  googleOAuthRedirectTo("https://milonfinance.com", { join: "joinTok" }) ===
    `${WWW}/auth/callback?join=joinTok`,
  "accountant-join Google on the apex returns on www",
);
assert(
  googleOAuthRedirectTo("http://localhost:5000") === "http://localhost:5000/auth/callback",
  "a local Google callback stays on localhost",
);
assert(
  staffInviteEmailRedirectTo("https://milonfinance.com", "abc123") ===
    `${WWW}/auth/callback?next=${encodeURIComponent("/access/abc123")}`,
  "a staff invite confirmation built on the apex returns on www",
);
assert(canonicalAuthUrl("/reset-password") === `${WWW}/reset-password`, "reset links use www");
assert(canonicalAuthUrl("/auth/verified") === `${WWW}/auth/verified`, "verify links use www");
assert(canonicalAuthUrl("/app") === `${WWW}/app`, "signup fallback links use www");
assert(
  canonicalAuthOrigin("https://milonfinance.com/auth/callback") === WWW,
  "the apex auth origin is www",
);
assert(
  canonicalAuthOrigin("https://working-wizard-git-preview.vercel.app") ===
    "https://working-wizard-git-preview.vercel.app",
  "a preview host stays a preview host",
);
assert(
  appRedirectOrigin(["https://milonfinance.com/settings"]) === "https://milonfinance.com",
  "non-auth redirects still keep the apex",
);

const previousSite = process.env.SITE_URL;
const previousApp = process.env.VITE_APP_URL;
process.env.SITE_URL = "https://milonfinance.com";
delete process.env.VITE_APP_URL;
assert(inviteSiteUrl() === WWW, "an apex SITE_URL becomes www on invite links");
process.env.SITE_URL = "https://working-wizard-git-preview.vercel.app";
assert(
  inviteSiteUrl() === "https://working-wizard-git-preview.vercel.app",
  "a preview SITE_URL stays on that preview",
);
if (previousSite === undefined) delete process.env.SITE_URL;
else process.env.SITE_URL = previousSite;
if (previousApp === undefined) delete process.env.VITE_APP_URL;
else process.env.VITE_APP_URL = previousApp;

type HostHas = { type: string; value: { eq?: string; suf?: string } };
type RedirectRule = {
  source: string;
  has?: HostHas[];
  destination: string;
  permanent?: boolean;
};

const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
  redirects?: RedirectRule[];
};
const apex = (vercel.redirects ?? []).find(
  (rule) => rule.has?.[0]?.type === "host" && rule.has[0].value.eq === "milonfinance.com",
);
assert(apex, "vercel.json has an apex milonfinance.com host rule");
assert(apex?.permanent === true, "the apex host rule is permanent (308)");
assert(
  apex?.destination.startsWith(`${WWW}/`) &&
    (apex.destination.includes("$1") || apex.destination.includes(":path")) &&
    !apex.destination.includes("?"),
  "the apex destination keeps the path and does not replace the query",
);
assert(apex?.source.includes("well-known"), "the apex source names the well-known exemption");
assert(
  !(vercel.redirects ?? []).some(
    (rule) => rule.has?.[0]?.value.eq === "www.milonfinance.com" && rule.permanent,
  ),
  "www is not redirected",
);

function apexLocation(pathname: string, search = ""): string | null {
  const source = apex?.source ?? "";
  const matched = pathname.match(new RegExp(`^${source}$`));
  if (!matched) return null;
  const dest = (apex?.destination ?? "").replace(/\$1/g, matched[1] ?? "").replace(/:path\*/g, pathname.replace(/^\//, ""));
  return `${dest}${search}`;
}

assert(
  apexLocation("/auth/callback", "?door=accountant") ===
    `${WWW}/auth/callback?door=accountant`,
  "Location keeps the callback path and the door query",
);
assert(apexLocation("/clients") === `${WWW}/clients`, "Location keeps a normal path");
assert(apexLocation("/") === `${WWW}/`, "Location keeps the site root");
assert(apexLocation("/.well-known") === null, "/.well-known is not redirected");
assert(
  apexLocation("/.well-known/assetlinks.json") === null,
  "/.well-known/assetlinks.json is not redirected",
);
assert(
  !String(apexLocation("/auth/callback", "?door=accountant")).includes("#"),
  "Location does not include a fragment",
);

async function liveLocation(): Promise<void> {
  const res = await fetch("https://milonfinance.com/auth/callback?door=accountant", {
    redirect: "manual",
  });
  assert(res.status === 308 || res.status === 301, `apex callback redirect status ${res.status}`);
  const location = res.headers.get("location") ?? "";
  const landed = new URL(location);
  assert(landed.origin === WWW, `live Location origin ${landed.origin}`);
  assert(landed.pathname === "/auth/callback", `live Location path ${landed.pathname}`);
  assert(landed.searchParams.get("door") === "accountant", "live Location keeps door");
  assert(!location.includes("#"), "live Location has no fragment");
}

function installChromium(): Promise<void> {
  return new Promise((resolveInstall, reject) => {
    const child = spawn("pnpm", ["exec", "playwright", "install", "chromium"], {
      stdio: "inherit",
      detached: true,
    });
    const timer = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      reject(new Error("playwright install timed out"));
    }, 180_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveInstall();
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

async function hashSurvives(): Promise<void> {
  const browser = await launchBrowser();
  const killer = setTimeout(() => {
    killDirectChildren(process.pid);
  }, 60_000);
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      (globalThis as { __milonLandedHref?: string }).__milonLandedHref = location.href;
    });
    const start =
      "https://milonfinance.com/auth/callback?door=accountant#access_token=fake-access&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=magiclink";
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const early = await page.evaluate(
      () => (globalThis as { __milonLandedHref?: string }).__milonLandedHref ?? "",
    );
    const href = early.includes("access_token=") ? early : page.url();
    const landed = new URL(href);
    assert(landed.origin === WWW, `browser landed on ${landed.origin}`);
    assert(landed.pathname === "/auth/callback", `browser path ${landed.pathname}`);
    assert(landed.searchParams.get("door") === "accountant", "browser kept the door query");
    assert(
      landed.hash.includes("access_token=fake-access"),
      `browser reapplied the fragment (${landed.hash || "empty"})`,
    );
  } finally {
    clearTimeout(killer);
    await Promise.race([
      browser.close().catch(() => undefined),
      new Promise((done) => setTimeout(done, 2_000)),
    ]);
    killDirectChildren(process.pid);
  }
}

async function shutdown(code: number): Promise<void> {
  killDirectChildren(process.pid);
  process.exit(code);
}

try {
  await liveLocation();
  await hashSurvives();
  console.log("apex-www-redirect-test: ok");
  await shutdown(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  await shutdown(1);
}
