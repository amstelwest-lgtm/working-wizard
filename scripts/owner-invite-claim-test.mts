/**
 * Token invites join without a client code. The legacy UUID path still requires one.
 * Run: pnpm test:owner-invite-claim
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerInviteSignupPanel } from "../src/components/owner-invite-signup-panel";
import {
  accountantInviteLead,
  accountantInvitePreviewPayload,
  assertInviteTokenUsable,
  evaluateOwnerInviteClaim,
  ownerInviteLead,
  ownerInvitePreviewPayload,
} from "../src/lib/invite-claim";
import { AccountantInviteIntro } from "../src/routes/join.$token";

function assert(cond: unknown, msg: string) {
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

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const FUTURE = "2026-11-03T12:00:00.000Z";
const PAST = "2026-10-19T12:00:00.000Z";
const CODE = "MLN-AB12CD";

evaluateOwnerInviteClaim({
  legacy: false,
  tokenId: "22222222-2222-4222-8222-222222222222",
  clientCode: CODE,
  submittedCode: null,
});
evaluateOwnerInviteClaim({
  legacy: false,
  tokenId: "22222222-2222-4222-8222-222222222222",
  clientCode: CODE,
  submittedCode: "MLN-ZZZZZZ",
});

throws(
  () =>
    evaluateOwnerInviteClaim({
      legacy: true,
      tokenId: null,
      clientCode: CODE,
      submittedCode: null,
    }),
  "Enter the client code",
  "the legacy code path still requires the code",
);
throws(
  () =>
    evaluateOwnerInviteClaim({
      legacy: true,
      tokenId: null,
      clientCode: CODE,
      submittedCode: "MLN-ZZZZZZ",
    }),
  "does not match",
  "a wrong code on the legacy path is rejected",
);
evaluateOwnerInviteClaim({
  legacy: true,
  tokenId: null,
  clientCode: CODE,
  submittedCode: "mln ab12cd",
});
evaluateOwnerInviteClaim({
  legacy: true,
  tokenId: null,
  clientCode: null,
  submittedCode: null,
});

assertInviteTokenUsable({ redeemed_at: null, expires_at: FUTURE }, { now: NOW });
throws(
  () => assertInviteTokenUsable({ redeemed_at: null, expires_at: PAST }, { now: NOW }),
  "expired",
  "an expired token is rejected",
);
throws(
  () =>
    assertInviteTokenUsable(
      { redeemed_at: null, expires_at: new Date(NOW - 1000).toISOString() },
      { now: NOW },
    ),
  "expired",
  "a revoked token (expires_at in the past) is rejected",
);
throws(
  () => assertInviteTokenUsable({ redeemed_at: PAST, expires_at: FUTURE }, { now: NOW }),
  "already been used",
  "a used token is rejected",
);
assert(
  assertInviteTokenUsable(
    { redeemed_at: PAST, expires_at: FUTURE, redeemed_by: "user-1" },
    { redeemedByUserId: "user-1", now: NOW },
  ).alreadyRedeemedByCaller === true,
  "the same user may retry a token they already redeemed",
);

const tokenPreview = ownerInvitePreviewPayload({
  clientName: "Northwind",
  firmName: "  Ben Accountants  ",
  legacy: false,
  tokenId: "22222222-2222-4222-8222-222222222222",
  clientCode: CODE,
});
assert(tokenPreview.firmName === "Ben Accountants", "preview keeps the firm display name");
assert(tokenPreview.requiresClientCode === false, "a token preview does not ask for the code");
assert(
  Object.keys(tokenPreview).sort().join(",") === "clientName,firmName,requiresClientCode",
  "preview returns only the business name, firm name, and the code flag",
);
assert(!JSON.stringify(tokenPreview).includes(CODE), "the client code is not in the preview");

const codePreview = ownerInvitePreviewPayload({
  clientName: "Northwind",
  firmName: "Ben Accountants",
  legacy: true,
  tokenId: null,
  clientCode: CODE,
});
assert(codePreview.requiresClientCode === true, "the legacy path still flags the code");
assert(!JSON.stringify(codePreview).includes(CODE), "the legacy preview does not leak the code");

assert(
  ownerInviteLead("Ben Accountants", "Northwind") ===
    "Ben Accountants invited you to join Northwind",
  "the owner lead names the firm and the client",
);
assert(
  ownerInviteLead(null, "Northwind") === "Your accountant invited you to join Northwind",
  "a missing firm falls back to Your accountant",
);
assert(
  accountantInviteLead({ inviterName: "Ana Owner", clientName: "Northwind" }) ===
    "Ana Owner invited you to join Northwind",
  "the accountant lead names the inviting owner",
);
assert(
  accountantInviteLead({ inviterName: "ana@firm.test", clientName: "Northwind" }) ===
    "Northwind invited you as their accountant",
  "an owner email is not shown as a name",
);

const accountantPreview = accountantInvitePreviewPayload({
  clientName: "Northwind",
  invitedEmail: "acct@firm.test",
  ownerName: "ana@firm.test",
});
assert(
  accountantPreview.inviterName === null,
  "accountant preview drops an email-shaped owner name",
);
assert(
  Object.keys(accountantPreview).sort().join(",") === "clientName,invitedEmail,inviterName",
  "accountant preview does not add owner id or firm columns",
);

function panel(needsCode: boolean) {
  return renderToStaticMarkup(
    createElement(OwnerInviteSignupPanel, {
      inviteToken: "abc123token",
      businessName: "Northwind",
      firmName: "Ben Accountants",
      inviteNeedsCode: needsCode,
      inviteIsLegacyUuid: needsCode,
      regClientCode: "",
      onRegClientCodeChange: () => {},
      regName: "",
      onRegNameChange: () => {},
      regEmail: "owner@example.com",
      onRegEmailChange: () => {},
      regPassword: "",
      onRegPasswordChange: () => {},
      regBusy: false,
      copyMarket: { copyPack: "us" as const },
      onSubmit: (event) => event.preventDefault(),
      onSignInClick: () => {},
      onGoogleError: () => {},
    }),
  );
}

const tokenMarkup = panel(false);
assert(
  tokenMarkup.includes("Ben Accountants invited you to join Northwind"),
  "the firm name renders on the owner join page",
);
assert(tokenMarkup.includes('data-owner-invite-lead=""'), "the lead is marked for the join page");
assert(
  !tokenMarkup.includes("ownerInviteClientCode"),
  "a token invite hides the client code field",
);
assert(!tokenMarkup.includes("MLN-XXXXXX"), "a token invite does not hint at the code");

const codeMarkup = panel(true);
assert(codeMarkup.includes("ownerInviteClientCode"), "the code path still shows the field");
assert(codeMarkup.includes("MLN-XXXXXX"), "the code path still names the code format");

const accountantMarkup = renderToStaticMarkup(
  createElement(AccountantInviteIntro, { inviterName: "Ana Owner", clientName: "Northwind" }),
);
assert(
  accountantMarkup.includes("Ana Owner invited you to join Northwind"),
  "the inviting owner renders on the accountant join page",
);
assert(!accountantMarkup.includes("MLN-"), "the accountant join page has no client code");
assert(!accountantMarkup.includes("@"), "the accountant intro does not render an email");

const join = readFileSync(resolve("src/routes/join.$token.tsx"), "utf8");
assert(join.includes("<AccountantInviteIntro"), "the accountant page renders the intro");
assert(!join.includes("Client code"), "the accountant page does not ask for a client code");
assert(!join.includes("MLN-"), "the accountant page has no client-code hint");

const member = readFileSync(resolve("src/lib/invite-member.server.ts"), "utf8");
assert(member.includes("evaluateOwnerInviteClaim"), "signup and accept use the server claim gate");

const resolver = readFileSync(resolve("src/lib/invite-tokens.resolve.ts"), "utf8");
assert(resolver.includes("assertInviteTokenUsable"), "resolve rejects expired and revoked tokens");

const preview = readFileSync(resolve("src/lib/invite-tokens.functions.ts"), "utf8");
assert(
  preview.includes("ownerInvitePreviewPayload"),
  "owner preview is built by the public payload",
);
const firmLookup = preview.slice(
  preview.indexOf("async function loadInvitingFirmName"),
  preview.indexOf("export const previewOwnerInvite"),
);
assert(firmLookup.includes('.from("firms")'), "firm lookup reads firms");
assert(firmLookup.includes('.select("name")'), "firm lookup reads the display name only");
assert(!firmLookup.includes("email"), "firm lookup does not read an email");
assert(!firmLookup.includes("brand_"), "firm lookup does not read brand columns");

const accountant = readFileSync(resolve("src/lib/accountant-invite.functions.ts"), "utf8");
const previewFn = accountant.slice(
  accountant.indexOf("export const previewAccountantInvite"),
  accountant.indexOf("export const acceptAccountantInvite"),
);
assert(
  previewFn.includes("accountantInvitePreviewPayload"),
  "accountant preview uses the public payload",
);
assert(previewFn.includes('select("full_name")'), "accountant preview reads the owner name");
assert(!previewFn.includes("client_code"), "accountant preview does not load a client code");
assert(!previewFn.includes('select("email'), "accountant preview does not select an email column");

const redeem = readFileSync(resolve("src/lib/accountant-invite.server.ts"), "utf8");
assert(!redeem.includes("client_code"), "accountant redeem has no client-code gate");
assert(
  !redeem.includes("evaluateOwnerInviteClaim"),
  "accountant redeem is not the owner code path",
);

const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(landing.includes("preview.requiresClientCode"), "the join page trusts the server code flag");
assert(landing.includes("preview.firmName"), "the join page reads the firm from preview");
assert(
  !landing.includes("preview.clientCode"),
  "the join page no longer reads a client code from preview",
);

console.log("owner-invite-claim-test: ok");
