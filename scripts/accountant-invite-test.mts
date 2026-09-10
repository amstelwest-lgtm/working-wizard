/**
 * Owner → accountant invite: URL, copy, redeem plan, purpose guards.
 * Run: pnpm test:accountant-invite
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCOUNTANT_INVITE_PURPOSE,
  accountantInviteLandingPath,
  accountantInviteTokenFromPath,
  assertAccountantLinkPurpose,
  assertOwnerHandoffPurpose,
  defaultPracticeName,
  planAccountantLink,
  templateAccountantInviteDraft,
} from "../src/lib/accountant-invite";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function throws(fn: () => void, needle: string, msg: string) {
  try {
    fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (text.includes(needle)) return;
    throw new Error(`${msg} — got: ${text}`);
  }
  throw new Error(`${msg} — did not throw`);
}

const owner = "11111111-1111-4111-8111-111111111111";
const accountant = "22222222-2222-4222-8222-222222222222";
const firmA = "33333333-3333-4333-8333-333333333333";
const firmB = "44444444-4444-4444-8444-444444444444";

assert(
  accountantInviteLandingPath("abc123") === "/join/abc123",
  "landing path is /join/:token — not /?invite=",
);
assert(accountantInviteTokenFromPath("/join/abc123") === "abc123", "token from /join path");
assert(accountantInviteTokenFromPath("/?invite=abc123") === null, "owner-invite URL is not an accountant join");

assert(defaultPracticeName("theo@west.co.za") === "West", "firm name from email domain");
assert(defaultPracticeName("theo@west.co.za", " West & Co ") === "West & Co", "override wins");

assert(
  planAccountantLink({
    clientOwnerUserId: owner,
    clientFirmId: null,
    redeemerUserId: accountant,
    redeemerFirmId: null,
  }).kind === "create_firm",
  "unlinked client + new accountant → create firm",
);
assert(
  planAccountantLink({
    clientOwnerUserId: owner,
    clientFirmId: null,
    redeemerUserId: accountant,
    redeemerFirmId: firmA,
  }).kind === "link_existing_firm",
  "unlinked client + existing practice → link that firm",
);
assert(
  planAccountantLink({
    clientOwnerUserId: owner,
    clientFirmId: firmA,
    redeemerUserId: accountant,
    redeemerFirmId: firmA,
  }).kind === "already_on_firm",
  "already on this firm is idempotent",
);
assert(
  planAccountantLink({
    clientOwnerUserId: owner,
    clientFirmId: firmA,
    redeemerUserId: accountant,
    redeemerFirmId: firmB,
  }).kind === "reject_other_firm",
  "do not steal a client from another practice",
);
assert(
  planAccountantLink({
    clientOwnerUserId: owner,
    clientFirmId: null,
    redeemerUserId: owner,
    redeemerFirmId: null,
  }).kind === "reject_self",
  "owner cannot redeem their own accountant invite",
);

throws(() => assertOwnerHandoffPurpose(ACCOUNTANT_INVITE_PURPOSE), "accountant", "owner redeem rejects accountant_link");
assertOwnerHandoffPurpose("owner_handoff");
throws(() => assertAccountantLinkPurpose("owner_handoff"), "business owner", "accountant redeem rejects owner_handoff");
throws(() => assertAccountantLinkPurpose(undefined), "business owner", "accountant redeem rejects missing purpose");
assertAccountantLinkPurpose(ACCOUNTANT_INVITE_PURPOSE);

const draft = templateAccountantInviteDraft({
  clientName: "Karoo Traders",
  ownerName: "Ana Owner",
  inviteUrl: "https://milon.co.za/join/tok123",
});
assert(draft.subject.includes("Karoo Traders"), "subject names the business");
assert(draft.body.includes("https://milon.co.za/join/tok123"), "body has /join URL");
assert(!draft.body.includes("mode=signup"), "accountant email must not use owner-handoff query");
assert(draft.body.includes("Ana Owner"), "names the owner");
assert(/accountant|practice/i.test(draft.body), "says they join as accountant");

const ownerInvite = readFileSync(resolve("src/lib/invite-member.server.ts"), "utf8");
assert(ownerInvite.includes("assertOwnerHandoffPurpose"), "owner redeem path guards accountant_link");

const mintOwner = readFileSync(resolve("src/lib/invite-tokens.functions.ts"), "utf8");
assert(mintOwner.includes("mint_owner_invite"), "firm→owner mint preserved");
assert(!mintOwner.includes("accountant_link"), "owner mint helper stays owner-only");

const joinPage = readFileSync(resolve("src/routes/join.$token.tsx"), "utf8");
assert(joinPage.includes("forcePortal(\"accountant\")"), "join page forces accountant portal");
assert(joinPage.includes('to: "/dashboard"'), "join page lands on practice portal");

const card = readFileSync(resolve("src/components/invite-accountant-card.tsx"), "utf8");
assert(card.includes("inviteAccountant"), "owner UI calls mint/send");

console.log("accountant-invite-test: ok");
