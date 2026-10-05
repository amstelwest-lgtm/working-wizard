/**
 * Lighthouse cold From lock — team@trymilon.com only.
 * Run: pnpm test:lighthouse-from-lock
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIGHTHOUSE_FROM_EMAIL,
  lighthouseFromAddressOf,
  resolveLighthouseFromAddress,
} from "../src/lib/lighthouse-from";
import { LIGHTHOUSE_REPLY_TO, resolveLighthouseReplyTo } from "../src/lib/lighthouse-reply-to";
import {
  LIGHTHOUSE_SENDER_NAME,
  resolveLighthouseSenderName,
  resolveLighthouseSenderTitle,
} from "../src/lib/lighthouse-sender";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(LIGHTHOUSE_FROM_EMAIL === "team@trymilon.com", "locked From mailbox");

assert(resolveLighthouseFromAddress("") === LIGHTHOUSE_FROM_EMAIL, "empty → team@trymilon.com");
assert(resolveLighthouseFromAddress("   ") === LIGHTHOUSE_FROM_EMAIL, "whitespace → team@trymilon.com");
assert(resolveLighthouseFromAddress(null) === LIGHTHOUSE_FROM_EMAIL, "null → team@trymilon.com");
assert(resolveLighthouseFromAddress(undefined) === LIGHTHOUSE_FROM_EMAIL, "undefined → team@trymilon.com");

assert(
  resolveLighthouseFromAddress("noreply@milon.co.za") === LIGHTHOUSE_FROM_EMAIL,
  "noreply@milon.co.za is rewritten",
);
assert(
  resolveLighthouseFromAddress("NOREPLY@MILON.CO.ZA") === LIGHTHOUSE_FROM_EMAIL,
  "milon.co.za From is case-insensitive",
);
assert(
  resolveLighthouseFromAddress("Milōn <noreply@milon.co.za>") === LIGHTHOUSE_FROM_EMAIL,
  "display-name milon.co.za From is rewritten",
);
assert(
  resolveLighthouseFromAddress("team@milonfinance.com") === LIGHTHOUSE_FROM_EMAIL,
  "milonfinance.com From is rewritten",
);
assert(
  resolveLighthouseFromAddress("Milōn <hello@milonfinance.com>") === LIGHTHOUSE_FROM_EMAIL,
  "angled milonfinance.com From is rewritten",
);
assert(
  resolveLighthouseFromAddress("hello@trymilon.com") === LIGHTHOUSE_FROM_EMAIL,
  "other trymilon.com mailbox is rewritten to team@",
);
assert(
  resolveLighthouseFromAddress("amstel.west@gmail.com") === LIGHTHOUSE_FROM_EMAIL,
  "non-trymilon host is rewritten",
);
assert(
  resolveLighthouseFromAddress("team@trymilon.com.evil.com") === LIGHTHOUSE_FROM_EMAIL,
  "lookalike host is rewritten",
);

assert(
  resolveLighthouseFromAddress("team@trymilon.com") === LIGHTHOUSE_FROM_EMAIL,
  "bare locked mailbox stays",
);
assert(
  resolveLighthouseFromAddress("TEAM@TRYMILON.COM") === LIGHTHOUSE_FROM_EMAIL,
  "locked mailbox is case-insensitive",
);
assert(
  resolveLighthouseFromAddress("Milōn <team@trymilon.com>") === LIGHTHOUSE_FROM_EMAIL,
  "Name <team@trymilon.com> stays the locked mailbox",
);
assert(
  resolveLighthouseFromAddress("  Milōn <team@trymilon.com>  ") === LIGHTHOUSE_FROM_EMAIL,
  "padded angled form stays the locked mailbox",
);

assert(lighthouseFromAddressOf("Milōn <team@trymilon.com>") === "team@trymilon.com", "parses angled addr");
assert(lighthouseFromAddressOf("noreply@milon.co.za") === "noreply@milon.co.za", "parses bare addr");
assert(lighthouseFromAddressOf("not an email") === "", "rejects unparseable");
assert(lighthouseFromAddressOf("Milōn <not an email>") === "", "rejects angled junk");

const fns = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
assert(fns.includes("resolveLighthouseFromAddress"), "send fn uses the From lock");
assert(fns.includes("from: `${senderName} <${fromAddr}>`"), "display name stays sender_name");
assert(!fns.includes("noreply@milon.co.za"), "lighthouse send module has no milon.co.za From fallback");
assert(
  !fns.includes('process.env.RESEND_FROM_EMAIL || "'),
  "lighthouse send module has no RESEND_FROM_EMAIL string fallback",
);

assert(LIGHTHOUSE_REPLY_TO === "hello@milonfinance.com", "Reply-To lock is hello@");
assert(
  resolveLighthouseFromAddress("hello@milonfinance.com") === LIGHTHOUSE_FROM_EMAIL,
  "hello@ is not cold From",
);
assert(
  resolveLighthouseFromAddress("Milōn <hello@milonfinance.com>") === LIGHTHOUSE_FROM_EMAIL,
  "angled hello@ is not cold From",
);
assert(
  resolveLighthouseReplyTo("team@trymilon.com") === LIGHTHOUSE_REPLY_TO,
  "cold From mailbox is not Reply-To",
);
assert(
  resolveLighthouseReplyTo("noreply@milon.co.za") === LIGHTHOUSE_REPLY_TO,
  "milon.co.za reply-to still retires to hello@",
);

const replyTo = readFileSync(resolve("src/lib/lighthouse-reply-to.ts"), "utf8");
assert(
  replyTo.includes('export const LIGHTHOUSE_REPLY_TO = "hello@milonfinance.com"'),
  "Reply-To constant is hello@",
);
assert(!replyTo.includes('"milonfinance.com"'), "Reply-To does not retire the milonfinance.com host");
assert(replyTo.includes('"milon.co.za"'), "Reply-To still retires milon.co.za");
assert(!replyTo.includes("resolveLighthouseFromAddress"), "Reply-To helper does not own From");

assert(LIGHTHOUSE_SENDER_NAME === "The MILŌN Team", "display name is The MILŌN Team");
assert(resolveLighthouseSenderName() === LIGHTHOUSE_SENDER_NAME, "empty sender → team");
assert(resolveLighthouseSenderName("") === LIGHTHOUSE_SENDER_NAME, "blank sender → team");
assert(resolveLighthouseSenderName(null, undefined) === LIGHTHOUSE_SENDER_NAME, "null sender → team");
assert(
  resolveLighthouseSenderName("Theo van der Westhuizen") === LIGHTHOUSE_SENDER_NAME,
  "founder name is not the display name",
);
assert(
  resolveLighthouseSenderName("Theo van der Westhuizen", "Theo van der Westhuizen") ===
    LIGHTHOUSE_SENDER_NAME,
  "camelCase founder name is not the display name",
);
assert(
  resolveLighthouseSenderName("Theo van der Westhuizen", "Ops desk") === "Ops desk",
  "a non-founder camelCase name can still win when snake_case is retired",
);
assert(resolveLighthouseSenderName("Ops desk") === "Ops desk", "custom display name is kept");
assert(resolveLighthouseSenderTitle() === "", "empty title stays empty");
assert(resolveLighthouseSenderTitle("Founder, Milōn") === "", "founder title is dropped");
assert(resolveLighthouseSenderTitle("Founder") === "", "Founder title is dropped");
assert(
  resolveLighthouseSenderTitle("Founder, Milōn", "Advisor") === "Advisor",
  "a non-founder title is kept",
);

assert(fns.includes("resolveLighthouseSenderName"), "send and settings resolve the display name");
assert(fns.includes("senderName: LIGHTHOUSE_SENDER_NAME"), "code default is the team display name");
assert(fns.includes('senderTitle: ""'), "code default has no founder title");
assert(!fns.includes("Theo van der Westhuizen"), "lighthouse send module does not name Theo as sender");
assert(!fns.includes("Founder, Milōn"), "lighthouse send module does not seed a Founder title");
assert(!fns.includes("Sound like one founder"), "owner rules do not write as a founder");

const seed = readFileSync(resolve("supabase/migrations/20260820100000_milon_lighthouse.sql"), "utf8");
assert(seed.includes('"sender_name": "The MILŌN Team"'), "settings seed display name is the team");
assert(!seed.includes("Theo van der Westhuizen"), "settings seed does not name Theo");
assert(!seed.includes("Founder, Mil"), "settings seed does not include a Founder title");

const senderMigration = readFileSync(
  resolve("supabase/migrations/20261005143000_lighthouse_sender_milon_team.sql"),
  "utf8",
);
assert(senderMigration.includes("The MILŌN Team"), "sender migration writes the team display name");
assert(senderMigration.includes("sender_name"), "sender migration sets sender_name");
assert(senderMigration.includes("senderName"), "sender migration covers the camelCase path");
assert(senderMigration.includes("sender_title"), "sender migration clears founder sender_title");
assert(senderMigration.includes("senderTitle"), "sender migration clears founder senderTitle");
const senderSql = senderMigration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
assert(!senderSql.includes("reply_to"), "sender migration does not move Reply-To");
assert(!senderSql.includes("auto_send"), "sender migration does not enable auto_send");
assert(!senderSql.includes("team@trymilon.com"), "sender migration does not move From");
assert(!senderSql.includes("hello@milonfinance.com"), "sender migration does not rewrite Reply-To");

console.log("lighthouse-from-lock-test: ok");
