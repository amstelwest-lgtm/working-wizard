/**
 * Edge mail must not name the retired public suffix, and a SITE_URL or
 * RESEND_FROM_EMAIL that still contains it is ignored.
 * Run: pnpm test:edge-no-coza
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CANONICAL_APP_ORIGIN } from "../supabase/functions/_shared/app-origin.ts";
import {
  containsRetiredPublicSuffix,
  TRANSACTIONAL_FROM,
  transactionalFrom,
  transactionalSiteUrl,
} from "../supabase/functions/_shared/transactional-mail.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const RETIRED = "co.za";
const LOCKED_FROM = "Mil\u014dn <noreply@milonfinance.com>";

assert(
  CANONICAL_APP_ORIGIN === "https://www.milonfinance.com",
  "canonical site is www.milonfinance.com",
);
assert(TRANSACTIONAL_FROM === LOCKED_FROM, "locked From is Milōn <noreply@milonfinance.com>");
assert(!TRANSACTIONAL_FROM.toLowerCase().includes(RETIRED), "locked From has no retired suffix");

assert(
  containsRetiredPublicSuffix(`https://milon.${RETIRED}`),
  "host with the retired suffix is detected",
);
assert(containsRetiredPublicSuffix("NOREPLY@NOTIFY.MILON.CO.ZA"), "detection is case-insensitive");
assert(
  !containsRetiredPublicSuffix("https://www.milonfinance.com"),
  "milonfinance.com is not retired",
);
assert(
  !containsRetiredPublicSuffix("https://working-wizard.vercel.app"),
  "a Vercel host is not retired",
);
assert(!containsRetiredPublicSuffix(null), "a missing env value is not retired");
assert(!containsRetiredPublicSuffix(""), "an empty env value is not retired");

const retiredFroms = [
  null,
  undefined,
  "",
  "   ",
  "noreply@milon.co.za",
  "Mil\u014dn <noreply@notify.milon.co.za>",
  "NOREPLY@MILON.CO.ZA",
  "Working Capital Compass <noreply@milon.co.za>",
  "Mil\u014dn <noreply@milonfinance.com>",
  "team@trymilon.com",
];
for (const raw of retiredFroms) {
  const from = transactionalFrom(raw);
  assert(from === LOCKED_FROM, `From falls back for ${String(raw)}`);
  assert(
    !from.toLowerCase().includes(RETIRED),
    `From does not echo a retired address for ${String(raw)}`,
  );
}

assert(
  transactionalSiteUrl("https://milon.co.za") === CANONICAL_APP_ORIGIN,
  "a retired SITE_URL becomes https://www.milonfinance.com",
);
assert(
  transactionalSiteUrl("https://www.milon.co.za/t/abc") === CANONICAL_APP_ORIGIN,
  "a retired host with a path is ignored",
);
assert(
  transactionalSiteUrl("https://notify.milon.co.za") === CANONICAL_APP_ORIGIN,
  "the notify host is ignored",
);
assert(
  transactionalSiteUrl("HTTPS://MILON.CO.ZA/app") === CANONICAL_APP_ORIGIN,
  "a retired SITE_URL is case-insensitive",
);
assert(
  transactionalSiteUrl("https://working-wizard.vercel.app/start?from=https://milon.co.za") ===
    CANONICAL_APP_ORIGIN,
  "a retired suffix in a query drops the whole SITE_URL",
);
assert(
  transactionalSiteUrl("https://www.milonfinance.com/welcome?src=milon.co.za") ===
    CANONICAL_APP_ORIGIN,
  "a retired suffix on an allowlisted host drops the whole SITE_URL",
);
assert(
  transactionalSiteUrl("https://working-wizard.vercel.app") === "https://working-wizard.vercel.app",
  "an allowlisted host without the retired suffix stays",
);
assert(
  transactionalSiteUrl("https://www.milonfinance.com/t/token") === "https://www.milonfinance.com",
  "www.milonfinance.com stays",
);
assert(
  transactionalSiteUrl("https://milonfinance.com/app") === "https://milonfinance.com",
  "the apex host stays",
);
assert(
  transactionalSiteUrl(null) === CANONICAL_APP_ORIGIN,
  "a missing SITE_URL uses the canonical site",
);
assert(
  transactionalSiteUrl("") === CANONICAL_APP_ORIGIN,
  "an empty SITE_URL uses the canonical site",
);
assert(
  transactionalSiteUrl("https://evil.example") === CANONICAL_APP_ORIGIN,
  "an unknown host is not used",
);

const functionsRoot = resolve("supabase/functions");
const hits: string[] = [];
for (const file of walk(functionsRoot)) {
  const src = readFileSync(file, "utf8");
  const rel = relative(process.cwd(), file);
  src.split("\n").forEach((line, index) => {
    if (line.toLowerCase().includes(RETIRED)) hits.push(`${rel}:${index + 1}`);
  });
}
assert(hits.length === 0, `retired suffix still in edge functions:\n${hits.join("\n")}`);

const nudge = readFileSync(resolve("supabase/functions/nudge-action-items/index.ts"), "utf8");
const taskLink = readFileSync(resolve("supabase/functions/task-link/index.ts"), "utf8");
const helper = readFileSync(resolve("supabase/functions/_shared/transactional-mail.ts"), "utf8");

assert(helper.includes('from "./app-origin.ts"'), "helper import keeps the .ts extension");
assert(
  nudge.includes('from "../_shared/transactional-mail.ts"'),
  "nudge import keeps the .ts extension",
);
assert(
  taskLink.includes('from "../_shared/transactional-mail.ts"'),
  "task-link import keeps the .ts extension",
);
assert(
  nudge.includes('transactionalFrom(Deno.env.get("RESEND_FROM_EMAIL"))'),
  "nudge reads RESEND_FROM_EMAIL through the lock",
);
assert(
  taskLink.includes('transactionalFrom(Deno.env.get("RESEND_FROM_EMAIL"))'),
  "task-link reads RESEND_FROM_EMAIL through the lock",
);
assert(
  nudge.includes('transactionalSiteUrl(Deno.env.get("SITE_URL"))'),
  "nudge reads SITE_URL through the lock",
);
assert(
  taskLink.includes('transactionalSiteUrl(Deno.env.get("SITE_URL"))'),
  "task-link reads SITE_URL through the lock",
);
assert(nudge.includes("The MIL\u014cN Team"), "nudge signs as The MILŌN Team");
assert(taskLink.includes("The MIL\u014cN Team"), "task-link signs as The MILŌN Team");
assert(!nudge.includes("Working Capital Compass"), "nudge drops Working Capital Compass");
assert(!taskLink.includes("Working Capital Compass"), "task-link has no Working Capital Compass");

console.log("edge-no-coza: OK");
