/**
 * Owner-invite paste text + template fallback.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/client-invite-email-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inviteFromHeader,
  inviteFromWhenSendable,
  invitePasteText,
  RESEND_SEND_TIMEOUT_MS,
  templateInviteDraft,
} from "../src/lib/client-invite-email";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const url = "https://www.milonfinance.com/?invite=abc123&mode=signup";
const draft = templateInviteDraft({
  clientName: "Karoo Traders",
  clientCode: "MLN-AB12CD",
  inviteUrl: url,
  firmName: "West & Co",
  accountantName: "Theo West",
  accountantEmail: "theo@west.co.za",
});

assert(draft.draftedBy === "template", "template source");
assert(draft.subject.includes("Karoo Traders"), "subject names the business");
assert(draft.body.includes(url), "body contains the claim URL");
assert(draft.body.includes("MLN-AB12CD"), "body contains client code");
assert(draft.body.includes("Theo West"), "signed by accountant");
assert(draft.body.includes("West & Co"), "signed with firm");

const paste = invitePasteText(draft.subject, draft.body);
assert(paste.startsWith("Subject: "), "paste starts with Subject");
assert(paste.includes(url), "paste still has URL");

assert(inviteFromHeader() === "MILŌN <noreply@milonfinance.com>", "default From is noreply@milonfinance.com");
assert(inviteFromHeader("noreply@milonfinance.com") === "MILŌN <noreply@milonfinance.com>", "From header");
assert(
  inviteFromWhenSendable({ apiKey: "", fromEmail: "noreply@milonfinance.com" }) == null,
  "From is hidden when send is not configured",
);
assert(
  inviteFromWhenSendable({ apiKey: "re_test", fromEmail: "MILŌN <hello@milonfinance.com>" }) ===
    "MILŌN <hello@milonfinance.com>",
  "From shows when send is configured",
);

const dash = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
const openStart = dash.indexOf("const openOwnerInvite");
const copyStart = dash.indexOf("const copyInviteDraft");
assert(openStart > 0 && copyStart > openStart, "invite open and copy are separate");
const openFn = dash.slice(openStart, copyStart);
assert(!openFn.includes("clipboard"), "opening the invite drawer does not copy");
assert(!openFn.includes("Invite message copied"), "opening the invite drawer does not toast copied");
assert(openFn.includes("sendEmail: false"), "opening the invite drawer does not send");
assert(dash.includes("From {draft.from}"), "the invite drawer shows From when sendable");
assert(
  dash.includes("disabled={sending || !draft.email.trim() || !draft.from}"),
  "Send stays disabled until an email is present and sending is configured",
);
const team = readFileSync(resolve("src/routes/_authenticated/settings.team.tsx"), "utf8");
assert(!team.includes("Thandi Mokoena"), "team invite does not prefill Thandi Mokoena");
assert(!team.includes("thandi@practice.co.za"), "team invite does not prefill the demo email");
assert(team.includes('useState("")'), "team invite name and email start blank");

const taskAssigned = readFileSync(resolve("src/lib/email-templates/task-assigned.tsx"), "utf8");
const transactionalSend = readFileSync(
  resolve("src/routes/lovable/email/transactional/send.ts"),
  "utf8",
);
assert(taskAssigned.includes("const SITE_NAME = 'Milōn'"), "task mail names Milōn");
assert(!taskAssigned.includes("Working Capital Compass"), "task mail drops the old product name");
assert(
  transactionalSend.includes('const SITE_NAME = "Milōn"'),
  "transactional From display name is Milōn",
);
assert(
  transactionalSend.includes("noreply@${FROM_DOMAIN}"),
  "transactional From mailbox is noreply on the finance domain",
);
assert(transactionalSend.includes('const FROM_DOMAIN = "milonfinance.com"'), "From domain is milonfinance.com");
assert(
  !transactionalSend.includes("Working Capital Compass"),
  "transactional send drops the old product name",
);

assert(RESEND_SEND_TIMEOUT_MS <= 8_000, "Resend abort stays inside the gateway window");
const sendSrc = readFileSync(resolve("src/lib/client-invite-email.ts"), "utf8");
assert(sendSrc.includes("AbortSignal.timeout"), "Resend fetch is abortable");
assert(sendSrc.includes("TimeoutError") && sendSrc.includes("AbortError"), "timeout is returned, not thrown");

console.log("client-invite-email-test: ok");
