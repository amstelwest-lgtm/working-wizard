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

const url = "https://milon.co.za/?invite=abc123&mode=signup";
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

assert(inviteFromHeader("noreply@milon.co.za") === "MILŌN <noreply@milon.co.za>", "From header");
assert(
  inviteFromWhenSendable({ apiKey: "", fromEmail: "noreply@milon.co.za" }) == null,
  "From is hidden when send is not configured",
);
assert(
  inviteFromWhenSendable({ apiKey: "re_test", fromEmail: "MILŌN <hello@milon.co.za>" }) ===
    "MILŌN <hello@milon.co.za>",
  "From shows when send is configured",
);

const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
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

assert(RESEND_SEND_TIMEOUT_MS <= 8_000, "Resend abort stays inside the gateway window");
const sendSrc = readFileSync(resolve("src/lib/client-invite-email.ts"), "utf8");
assert(sendSrc.includes("AbortSignal.timeout"), "Resend fetch is abortable");
assert(sendSrc.includes("TimeoutError") && sendSrc.includes("AbortError"), "timeout is returned, not thrown");

console.log("client-invite-email-test: ok");
