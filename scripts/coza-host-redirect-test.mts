/**
 * Retired milon.co.za hosts 308 to https://www.milonfinance.com.
 * Run: pnpm test:coza-host-redirect
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CANONICAL_APP_ORIGIN } from "../src/lib/app-origin";
import {
  isRetiredMilonCoZaHost,
  retiredCoZaRedirect,
} from "../src/lib/retired-coza-host";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type HostHas = { type: string; value: { eq?: string; suf?: string } };
type RedirectRule = {
  source: string;
  has?: HostHas[];
  destination: string;
  permanent?: boolean;
};

const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
  redirects?: RedirectRule[];
  rewrites?: Array<{ source: string; destination: string }>;
};

const redirects = vercel.redirects ?? [];
const cozaRedirects = redirects.filter((rule) => {
  const host = rule.has?.[0]?.value;
  return host?.eq === "milon.co.za" || host?.suf === ".milon.co.za";
});
assert(cozaRedirects.length >= 2, "vercel.json has milon.co.za host redirects");
for (const rule of cozaRedirects) {
  assert(rule.source === "/:path*", "redirect matches every path");
  assert(rule.destination === `${CANONICAL_APP_ORIGIN}/:path*`, "redirect keeps the path on www");
  assert(rule.permanent === true, "redirect is permanent (308)");
  assert(!rule.destination.includes("?"), "destination has no query, so the original query is kept");
  assert(rule.has?.length === 1 && rule.has[0].type === "host", "redirect is conditioned on host");
}
const eq = redirects.find((rule) => rule.has?.[0]?.value.eq === "milon.co.za");
const suf = redirects.find((rule) => rule.has?.[0]?.value.suf === ".milon.co.za");
assert(eq, "apex milon.co.za has an exact host match");
assert(suf, "subdomains match a .milon.co.za host suffix");
assert(
  vercel.rewrites?.some((rule) => rule.destination === "/api/server"),
  "the app rewrite still reaches the server",
);

function edgeRedirect(host: string, pathAndQuery: string): string | null {
  const normalized = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const matches = cozaRedirects.some((rule) => {
    const value = rule.has?.[0]?.value;
    if (!value) return false;
    if (value.eq) return normalized === value.eq;
    if (value.suf) return normalized.endsWith(value.suf);
    return false;
  });
  if (!matches) return null;
  const url = new URL(pathAndQuery, CANONICAL_APP_ORIGIN);
  return url.toString();
}

function request(url: string, host?: string, forwarded?: string): Request {
  const headers = new Headers();
  if (host) headers.set("host", host);
  if (forwarded) headers.set("x-forwarded-host", forwarded);
  return new Request(url, { headers });
}

const cases: Array<{ host: string; path: string }> = [
  { host: "milon.co.za", path: "/" },
  { host: "www.milon.co.za", path: "/pricing" },
  { host: "app.milon.co.za", path: "/dashboard" },
  { host: "a.b.milon.co.za", path: "/clients/abc" },
  { host: "WWW.Milon.CO.ZA", path: "/auth/callback?code=abc&next=%2Fdashboard" },
  { host: "www.milon.co.za:443", path: "/auth/callback?code=pkce&type=signup" },
  { host: "auth.milon.co.za", path: "/auth/v1/callback?code=xyz" },
];

for (const sample of cases) {
  assert(isRetiredMilonCoZaHost(sample.host), `${sample.host} is retired`);
  const url = `https://${sample.host.split(":")[0]}${sample.path}`;
  const response = retiredCoZaRedirect(request(url, sample.host));
  assert(response?.status === 308, `${sample.host} ${sample.path} is a 308`);
  const location = response?.headers.get("location");
  const expected = edgeRedirect(sample.host, sample.path);
  assert(location === expected, `${sample.host} location ${location} matches edge ${expected}`);
  const landed = new URL(location ?? "");
  const source = new URL(sample.path, CANONICAL_APP_ORIGIN);
  assert(landed.origin === CANONICAL_APP_ORIGIN, "location origin is www");
  assert(landed.pathname === source.pathname, "path is preserved");
  assert(landed.search === source.search, "query is preserved");
}

const callback = retiredCoZaRedirect(
  request(
    "https://working-wizard2.vercel.app/auth/callback?code=abc&next=%2Fdashboard",
    "working-wizard2.vercel.app",
    "www.milon.co.za",
  ),
);
assert(callback?.status === 308, "forwarded www host still redirects");
assert(
  callback?.headers.get("location") ===
    "https://www.milonfinance.com/auth/callback?code=abc&next=%2Fdashboard",
  "auth callback query survives the forwarded-host redirect",
);

const kept = [
  "www.milonfinance.com",
  "milonfinance.com",
  "staging.milonfinance.com",
  "working-wizard2.vercel.app",
  "localhost",
  "accounting.sageone.co.za",
  "notmilon.co.za",
  "milon.co.za.evil.com",
  "business.co.za",
];
for (const host of kept) {
  assert(!isRetiredMilonCoZaHost(host), `${host} stays on its own host`);
  const response = retiredCoZaRedirect(
    request(`https://${host}/auth/callback?code=abc`, host),
  );
  assert(response === null, `${host} is not redirected`);
  assert(edgeRedirect(host, "/auth/callback?code=abc") === null, `${host} misses the edge rule`);
}

const server = readFileSync(resolve("src/server.ts"), "utf8");
assert(server.includes("retiredCoZaRedirect"), "the server entry applies the redirect before the app");

console.log("coza-host-redirect-test: ok");
