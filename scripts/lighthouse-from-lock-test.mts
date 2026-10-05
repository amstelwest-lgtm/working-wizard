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

console.log("lighthouse-from-lock-test: ok");
