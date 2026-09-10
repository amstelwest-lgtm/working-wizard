/**
 * Lighthouse accountant_v1 v2 — Reply-To lock + Day-3 both teasers.
 * Run: pnpm test:lighthouse-accountant-v2
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LIGHTHOUSE_REPLY_TO, resolveLighthouseReplyTo } from "../src/lib/lighthouse-reply-to";
import { replyInterestCtaBrief, watchVideoCtaBrief } from "../src/lib/lighthouse-draft-cta";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(LIGHTHOUSE_REPLY_TO === "team@milonfinance.com", "locked mailbox");
assert(resolveLighthouseReplyTo("") === LIGHTHOUSE_REPLY_TO, "empty → team");
assert(resolveLighthouseReplyTo("   ") === LIGHTHOUSE_REPLY_TO, "whitespace → team");
assert(resolveLighthouseReplyTo(null) === LIGHTHOUSE_REPLY_TO, "null → team");
assert(resolveLighthouseReplyTo(undefined) === LIGHTHOUSE_REPLY_TO, "undefined → team");
assert(
  resolveLighthouseReplyTo("hello@milon.co.za") === LIGHTHOUSE_REPLY_TO,
  "hello@milon.co.za → team",
);
assert(
  resolveLighthouseReplyTo("HELLO@MILON.CO.ZA") === LIGHTHOUSE_REPLY_TO,
  "hello@ case-insensitive",
);
assert(
  resolveLighthouseReplyTo("ops@milon.co.za") === LIGHTHOUSE_REPLY_TO,
  "any @milon.co.za → team",
);
assert(
  resolveLighthouseReplyTo("team@milonfinance.com") === LIGHTHOUSE_REPLY_TO,
  "already locked stays",
);
assert(
  resolveLighthouseReplyTo("  amstel.west@gmail.com  ") === "amstel.west@gmail.com",
  "non-ZA mailbox kept",
);

const both = watchVideoCtaBrief([
  "https://youtu.be/J4vJki7HcIs",
  "https://youtu.be/k3aRM4toTvU",
]);
assert(both.includes("https://youtu.be/J4vJki7HcIs"), "watch brief includes practice YT");
assert(both.includes("https://youtu.be/k3aRM4toTvU"), "watch brief includes owner YT");
assert(both.includes("BOTH"), "watch brief requires both URLs");
assert(!both.includes("/?lh="), "watch brief does not include a trial URL");

const one = watchVideoCtaBrief(["https://youtu.be/J4vJki7HcIs", ""]);
assert(one.includes("https://youtu.be/J4vJki7HcIs"), "single ready URL is used");
assert(!one.includes("BOTH"), "one URL is not a both-links brief");

const none = watchVideoCtaBrief(["", ""]);
assert(none.toLowerCase().includes("not produced"), "no ready URL degrades honestly");

assert(!replyInterestCtaBrief({ day: 0, trialLink: "https://x" }).includes("http"), "day0 no URL");
assert(
  replyInterestCtaBrief({ day: 7, trialLink: "https://milon.example/t" }).includes(
    "https://milon.example/t",
  ),
  "day7 may soft-ask signup link",
);
assert(
  replyInterestCtaBrief({ day: 18, trialLink: "https://x" }).toLowerCase().includes("later"),
  "day18 invites reply later",
);
assert(
  !replyInterestCtaBrief({ day: 18, trialLink: "https://x" }).includes("https://x"),
  "day18 body has no link",
);

const fns = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
assert(fns.includes("resolveLighthouseReplyTo"), "settings + send use the reply-to lock");
assert(fns.includes("watchVideoCtaBrief"), "watch CTA uses both-ready helper");
assert(fns.includes("readyAssetsByKeys"), "drafter loads primary and fallback together");
assert(fns.includes('replyTo: LIGHTHOUSE_REPLY_TO'), "DEFAULT_SETTINGS.replyTo is locked");
assert(fns.includes("You write as Theo, founder of MILŌN"), "SYSTEM_RULES voice is Theo");
assert(fns.includes("https://youtu.be/J4vJki7HcIs"), "SYSTEM_RULES has practice teaser");
assert(fns.includes("https://youtu.be/k3aRM4toTvU"), "SYSTEM_RULES has owner teaser");
assert(fns.includes("Day 0: no URLs"), "SYSTEM_RULES day0");
assert(fns.includes("Day 7: no fake cases"), "SYSTEM_RULES day7");
assert(fns.includes("Day 12: only the firm-signup"), "SYSTEM_RULES day12");
assert(fns.includes('reply "later"'), "SYSTEM_RULES day18");
assert(fns.includes("Prefer under 120 words"), "SYSTEM_RULES length");
assert(fns.includes("from: `${senderName} <${fromAddr}>`"), "From stays RESEND_FROM_EMAIL");
assert(fns.includes("reply_to: replyTo"), "Resend payload always sets reply_to");
assert(
  !/reply_to:\s*["']hello@milon\.co\.za["']/.test(fns),
  "send path never hardcodes hello@milon.co.za as reply_to",
);

const sendSlice = fns.slice(fns.indexOf("export const sendLighthouseTouch"));
const resendBody = sendSlice.slice(0, sendSlice.indexOf("export const upsertLighthouseAsset"));
assert(resendBody.includes("resolveLighthouseReplyTo"), "send path resolves reply_to");
assert(!resendBody.includes("hello@milon.co.za"), "send path never uses hello@milon.co.za");

const migration = readFileSync(
  resolve("supabase/migrations/20260910210000_lighthouse_accountant_v1_sequence_v2.sql"),
  "utf8",
);
assert(migration.includes("accountant_v1"), "migration updates accountant_v1");
assert(!/WHERE key = ['"]owner_v1['"]/.test(migration), "migration does not rewrite owner_v1");
assert(migration.includes('"day":0'), "step 1 day 0");
assert(migration.includes('"day":3'), "step 2 day 3");
assert(migration.includes('"day":7'), "step 3 day 7");
assert(migration.includes('"day":12'), "step 4 day 12");
assert(migration.includes('"day":18'), "step 5 day 18");
assert(migration.includes("teaser_accountant"), "day3 primary teaser");
assert(migration.includes("teaser_owner"), "day3 fallback teaser");
assert(migration.includes("https://youtu.be/J4vJki7HcIs"), "day3 practice YT in goal");
assert(migration.includes("https://youtu.be/k3aRM4toTvU"), "day3 owner YT in goal");
assert(migration.includes('"max_words":90'), "day0 max 90");
assert(migration.includes('"max_words":100'), "mid steps max 100");
assert(migration.includes('"max_words":60'), "day18 max 60");
assert(migration.includes("hello@milon.co.za"), "reply_to lock targets hello@");
assert(migration.includes("team@milonfinance.com"), "reply_to lock writes team@");
assert(migration.includes("ON CONFLICT"), "settings upsert is idempotent");

console.log("lighthouse-accountant-v2-test: ok");
