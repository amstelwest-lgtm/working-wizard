/**
 * Lighthouse accountant_v1 v3 — Reply-To lock + team voice + cadence 0/4/9/17/28.
 * Run: pnpm test:lighthouse-accountant-v3
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LIGHTHOUSE_REPLY_TO, resolveLighthouseReplyTo } from "../src/lib/lighthouse-reply-to";
import {
  ACCOUNTANT_ONE_PAGER_PATH,
  ACCOUNTANT_TEASER_OWNER,
  ACCOUNTANT_TEASER_PRACTICE,
  LIGHTHOUSE_TEAM_VOICE,
  accountantOnePagerUrl,
  lighthouseOnePagerAttachments,
  replyInterestCtaBrief,
  startTrialCtaBrief,
  watchVideoCtaBrief,
} from "../src/lib/lighthouse-draft-cta";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(LIGHTHOUSE_REPLY_TO === "hello@milonfinance.com", "locked mailbox");
assert(LIGHTHOUSE_TEAM_VOICE === "The Milōn Team", "team voice label");
assert(resolveLighthouseReplyTo("") === LIGHTHOUSE_REPLY_TO, "empty → hello@");
assert(resolveLighthouseReplyTo("   ") === LIGHTHOUSE_REPLY_TO, "whitespace → hello@");
assert(resolveLighthouseReplyTo(null) === LIGHTHOUSE_REPLY_TO, "null → hello@");
assert(resolveLighthouseReplyTo(undefined) === LIGHTHOUSE_REPLY_TO, "undefined → hello@");
assert(
  resolveLighthouseReplyTo("hello@milon.co.za") === LIGHTHOUSE_REPLY_TO,
  "hello@milon.co.za → hello@",
);
assert(
  resolveLighthouseReplyTo("HELLO@MILON.CO.ZA") === LIGHTHOUSE_REPLY_TO,
  "hello@ case-insensitive",
);
assert(
  resolveLighthouseReplyTo("ops@milon.co.za") === LIGHTHOUSE_REPLY_TO,
  "any @milon.co.za → hello@",
);
assert(
  resolveLighthouseReplyTo("team@milonfinance.com") === LIGHTHOUSE_REPLY_TO,
  "team@ reply-to remaps to hello@",
);
assert(
  resolveLighthouseReplyTo("TEAM@MILONFINANCE.COM") === LIGHTHOUSE_REPLY_TO,
  "team@ case-insensitive",
);
assert(
  resolveLighthouseReplyTo("hello@milonfinance.com") === LIGHTHOUSE_REPLY_TO,
  "already locked stays",
);
assert(
  resolveLighthouseReplyTo("  amstel.west@gmail.com  ") === "amstel.west@gmail.com",
  "non-ZA mailbox kept",
);

const both = watchVideoCtaBrief([ACCOUNTANT_TEASER_PRACTICE, ACCOUNTANT_TEASER_OWNER]);
assert(both.includes(ACCOUNTANT_TEASER_PRACTICE), "watch brief includes practice YT");
assert(both.includes(ACCOUNTANT_TEASER_OWNER), "watch brief includes owner YT");
assert(both.includes("BOTH"), "watch brief requires both URLs");
assert(!both.includes("/?lh="), "watch brief does not include a trial URL");

const one = watchVideoCtaBrief([ACCOUNTANT_TEASER_PRACTICE, ""]);
assert(one.includes(ACCOUNTANT_TEASER_PRACTICE), "single ready URL is used");
assert(!one.includes("BOTH"), "one URL is not a both-links brief");

const none = watchVideoCtaBrief(["", ""]);
assert(none.toLowerCase().includes("not produced"), "no ready URL degrades honestly");

const day0 = replyInterestCtaBrief({ day: 0, persona: "accountant" });
assert(!day0.includes("http"), "day0 accountant no URL");
assert(day0.toLowerCase().includes("capacity"), "day0 accountant capacity soft-ask");

const ownerDay0 = replyInterestCtaBrief({ day: 0, persona: "owner" });
assert(!ownerDay0.includes("http"), "owner day0 no URL");
assert(!ownerDay0.toLowerCase().includes("capacity"), "owner day0 is not accountant copy");

const day17 = replyInterestCtaBrief({ day: 17, persona: "accountant" });
assert(!day17.includes("http"), "day17 no URL");
assert(
  day17.toLowerCase().includes("do not include any url or pdf"),
  "day17 brief forbids URL and PDF",
);
assert(day17.toLowerCase().includes("unusual"), "day17 unusual-question bait");

const pager = accountantOnePagerUrl("https://app.example");
assert(pager === `https://app.example${ACCOUNTANT_ONE_PAGER_PATH}`, "one-pager uses SITE_URL + path");
assert(pager.endsWith("/lighthouse/milon-one-pager-accountants.pdf"), "one-pager public path");

const day9 = startTrialCtaBrief({
  day: 9,
  trialDays: 14,
  trialLink: "https://app.example/?lh=tok#register",
  onePagerUrl: pager,
});
assert(day9.includes("https://app.example/?lh=tok#register"), "day9 trial_link");
assert(day9.includes(pager), "day9 CTA brief mentions one-pager URL");
assert(!day9.includes("youtu.be"), "day9 has no YouTube CTA");
assert(day9.toLowerCase().includes("only"), "day9 only CTA is trial");

const day9NoPager = startTrialCtaBrief({
  day: 9,
  trialDays: 14,
  trialLink: "https://app.example/?lh=tok#register",
});
assert(!day9NoPager.includes(ACCOUNTANT_ONE_PAGER_PATH), "day9 omits pager when not ready");

const day28 = startTrialCtaBrief({
  day: 28,
  trialDays: 14,
  trialLink: "https://app.example/?lh=tok#register",
  onePagerUrl: pager,
  teaserUrls: [ACCOUNTANT_TEASER_PRACTICE, ACCOUNTANT_TEASER_OWNER],
});
assert(day28.includes("https://app.example/?lh=tok#register"), "day28 trial_link");
assert(day28.includes(ACCOUNTANT_TEASER_PRACTICE), "day28 practice YT");
assert(day28.includes(ACCOUNTANT_TEASER_OWNER), "day28 owner YT");
assert(day28.includes(pager), "day28 one-pager URL");

const ownerTrial = startTrialCtaBrief({
  day: 12,
  trialDays: 14,
  trialLink: "https://app.example/?lh=own#register",
});
assert(ownerTrial.includes("https://app.example/?lh=own#register"), "owner start_trial still trial-only");
assert(!ownerTrial.includes(ACCOUNTANT_ONE_PAGER_PATH), "owner start_trial has no accountant pager");

const attached = lighthouseOnePagerAttachments(pager);
assert(attached.length === 1, "ready pager becomes a Resend attachment");
assert(attached[0].filename === "milon-one-pager-accountants.pdf", "attachment filename");
assert(attached[0].path === pager, "attachment path is the public URL");
assert(lighthouseOnePagerAttachments(null).length === 0, "no attachment when pager missing");
assert(lighthouseOnePagerAttachments("").length === 0, "no attachment when pager empty");

const fns = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
assert(fns.includes("resolveLighthouseReplyTo"), "settings + send use the reply-to lock");
assert(fns.includes("watchVideoCtaBrief"), "watch CTA uses both-ready helper");
assert(fns.includes("startTrialCtaBrief"), "start_trial CTA uses v3 helper");
assert(fns.includes("readyAssetsByKeys"), "drafter loads primary and fallback together");
assert(fns.includes("lighthouseOnePagerAttachments"), "send path can attach the one-pager");
assert(fns.includes("replyTo: LIGHTHOUSE_REPLY_TO"), "DEFAULT_SETTINGS.replyTo is locked");
assert(fns.includes("You write as The Milōn Team"), "SYSTEM_RULES voice is The Milōn Team");
assert(!fns.includes("You write as Theo, founder of MILŌN"), "SYSTEM_RULES is not Theo first-person");
assert(fns.includes("Never write in founder first-person as Theo"), "SYSTEM_RULES forbids Theo voice");
assert(fns.includes(ACCOUNTANT_TEASER_PRACTICE), "SYSTEM_RULES has practice teaser");
assert(fns.includes(ACCOUNTANT_TEASER_OWNER), "SYSTEM_RULES has owner teaser");
assert(fns.includes("Day 0: capacity-ceiling"), "SYSTEM_RULES day0");
assert(fns.includes("Day 4: must include BOTH"), "SYSTEM_RULES day4");
assert(fns.includes("Day 9: only CTA is the free-trial link"), "SYSTEM_RULES day9");
assert(fns.includes("Day 17: unusual-question bait"), "SYSTEM_RULES day17");
assert(fns.includes("Day 28: capacity close"), "SYSTEM_RULES day28");
assert(fns.includes("Prefer under 120 words"), "SYSTEM_RULES length");
assert(fns.includes("from: `${senderName} <${fromAddr}>`"), "From stays RESEND_FROM_EMAIL");
assert(fns.includes("Reply-to is hello@milonfinance.com"), "SYSTEM_RULES reply-to is hello@");
assert(!fns.includes("From and reply-to are team@milonfinance.com"), "SYSTEM_RULES no longer conflates From/reply-to");
assert(fns.includes("reply_to: replyTo"), "Resend payload always sets reply_to");
assert(
  !/reply_to:\s*["']hello@milon\.co\.za["']/.test(fns),
  "send path never hardcodes hello@milon.co.za as reply_to",
);
assert(fns.includes("OWNER_SYSTEM_RULES"), "owner drafts keep a separate rule block");
assert(fns.includes("seqKey === \"accountant_v1\" ? SYSTEM_RULES"), "accountant rules are scoped");

const sendSlice = fns.slice(fns.indexOf("export const sendLighthouseTouch"));
const resendBody = sendSlice.slice(0, sendSlice.indexOf("export const upsertLighthouseAsset"));
assert(resendBody.includes("resolveLighthouseReplyTo"), "send path resolves reply_to");
assert(!resendBody.includes("hello@milon.co.za"), "send path never uses hello@milon.co.za");
assert(resendBody.includes("attachments"), "send path wires Resend attachments");

const migration = readFileSync(
  resolve("supabase/migrations/20260910220000_lighthouse_accountant_v1_sequence_v3.sql"),
  "utf8",
);
assert(migration.includes("accountant_v1"), "migration updates accountant_v1");
assert(!/WHERE key = ['"]owner_v1['"]/.test(migration), "migration does not rewrite owner_v1");
assert(migration.includes('"day":0'), "step 1 day 0");
assert(migration.includes('"day":4'), "step 2 day 4");
assert(migration.includes('"day":9'), "step 3 day 9");
assert(migration.includes('"day":17'), "step 4 day 17");
assert(migration.includes('"day":28'), "step 5 day 28");
assert(!migration.includes('"day":3'), "v3 does not keep day 3");
assert(!migration.includes('"day":7'), "v3 does not keep day 7");
assert(!migration.includes('"day":12'), "v3 does not keep day 12");
assert(!migration.includes('"day":18'), "v3 does not keep day 18");
assert(migration.includes("teaser_accountant"), "day4 primary teaser");
assert(migration.includes("teaser_owner"), "day4 fallback teaser");
assert(migration.includes(ACCOUNTANT_TEASER_PRACTICE), "practice YT in goals");
assert(migration.includes(ACCOUNTANT_TEASER_OWNER), "owner YT in goals");
assert(migration.includes("one_pager_accountant"), "day9/28 one-pager asset");
assert(migration.includes("hello@milon.co.za"), "v3 reply_to lock targets hello@milon.co.za");
assert(migration.includes("team@milonfinance.com"), "v3 reply_to lock historically wrote team@");
assert(migration.includes("ON CONFLICT"), "settings upsert is idempotent");

const replyToMigration = readFileSync(
  resolve("supabase/migrations/20260910230000_lighthouse_reply_to_hello.sql"),
  "utf8",
);
assert(replyToMigration.includes("hello@milonfinance.com"), "reply_to remaps to hello@");
assert(replyToMigration.includes("team@milonfinance.com"), "reply_to remaps team@");
assert(replyToMigration.includes("milon.co.za"), "reply_to remaps *@milon.co.za");
assert(replyToMigration.includes("ON CONFLICT"), "hello@ reply_to upsert is idempotent");
assert(!/jsonb_set\([^)]*from/i.test(replyToMigration), "reply_to migration does not rewrite From");

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert(panel.includes("Day 4 · both teaser videos"), "ops drawer shows accountant v3 day 4");
assert(panel.includes("Day 28 · capacity close"), "ops drawer shows accountant v3 day 28");
assert(panel.includes("Reply-to — hello@milonfinance.com"), "ops drawer placeholder is hello@");

console.log("lighthouse-accountant-v3-test: ok");
