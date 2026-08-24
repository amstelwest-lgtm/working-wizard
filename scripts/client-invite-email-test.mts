/**
 * Owner-invite paste text + template fallback.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/client-invite-email-test.mts
 */
import { invitePasteText, templateInviteDraft } from "../src/lib/client-invite-email";

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

console.log("client-invite-email-test: ok");
