/**
 * /join/:token brand v1.1. White canvas, navy text, pale borders, cobalt
 * primary. Gold stays on the wordmark. Eng1's revoked/used, greeting, and
 * first-run profile behaviour stay; only the paint changes.
 *
 *   pnpm test:join-invite-brand
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OwnerInviteCard,
  OwnerInvitePrimaryButton,
  OwnerInviteShell,
} from "../src/components/owner-invite-shell";
import { ownerInviteGreeting, INVITE_REVOKED_MESSAGE, INVITE_USED_MESSAGE } from "../src/lib/invite-claim";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const shell = renderToStaticMarkup(
  createElement(OwnerInviteShell, { businessName: "Northwind" }, createElement(OwnerInviteCard, null, "Card")),
);
assert(shell.includes("bg-white") && shell.includes("text-[#102A43]"), "shell canvas is white with navy text");
assert(shell.includes("border-[#DBEAFE]"), "shell borders are pale");
assert(shell.includes("logo-word") && shell.includes("text-[#7D5F0F]") && shell.includes("MILŌN"), "wordmark stays gold");
assert(!shell.includes("#ac8400") && !shell.includes("#d4af37") && !shell.includes("#0a0c0b"), "shell has no gold button or dark canvas");

const button = renderToStaticMarkup(createElement(OwnerInvitePrimaryButton, null, "Accept invitation"));
assert(button.includes("bg-[#0B5FFF]") && button.includes("text-white"), "primary button is solid cobalt");
assert(button.includes("Accept invitation"), "primary label is unchanged by the shell");
assert(!button.includes("from-[#ac8400]") && !button.includes("#d4af37"), "primary button is not gold");

const join = readFileSync(resolve("src/routes/join.$token.tsx"), "utf8");
assert(join.includes("Accept invitation"), "join primary copy is Accept invitation");
assert(join.includes("inviteJoinHidesSignup"), "revoked and used still hide signup");
assert(join.includes('data-invite-sign-in=""'), "revoked and used still offer Sign in");
assert(!join.includes("joinPreview"), "no preview stub ships");
assert(!join.includes('classList.add("dark")'), "join does not force dark");
assert(join.includes(INVITE_REVOKED_MESSAGE) === false, "revoked copy stays in invite-claim");

const panel = readFileSync(resolve("src/components/owner-invite-signup-panel.tsx"), "utf8");
assert(panel.includes("ownerInviteGreeting"), "owner name greeting stays");
assert(panel.includes("Accept invitation"), "owner primary copy stays Accept invitation");
assert(panel.includes('data-invite-sign-in=""'), "owner revoked and used still offer Sign in");
assert(!panel.includes("#d4a550") && !panel.includes("#e8ede9"), "owner panel dropped the dark gold paint");

const greeting = ownerInviteGreeting({
  firmName: "Ben Accountants",
  clientName: "Northwind",
  inviteeName: "Ada",
});
assert(greeting === "Hi Ada. Ben Accountants invited you to join Northwind", "greeting copy is unchanged");
assert(INVITE_USED_MESSAGE === "This invite was already used, sign in", "used copy is unchanged");
assert(
  INVITE_REVOKED_MESSAGE === "This invite was revoked, ask your accountant for a new link",
  "revoked copy is unchanged",
);

const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const funnelAt = app.indexOf('data-profile-funnel=""');
const funnelSlice = app.slice(funnelAt, funnelAt + 400);
assert(funnelSlice.includes("bg-white") && funnelSlice.includes("text-[#102A43]"), "first-run profile modal is the light shell");
assert(funnelSlice.includes("border-[#DBEAFE]"), "first-run profile modal uses pale borders");
assert(!funnelSlice.includes("bg-slate-950"), "first-run profile modal dropped the dark sheet");
assert(app.includes("shouldShowOwnerProfileFunnel"), "first-run gate is unchanged");

const funnel = readFileSync(resolve("src/components/profile/profile-funnel.tsx"), "utf8");
assert(funnel.includes('data-profile-later=""'), "Later stays on the profile footer");
assert(funnel.includes("Save profile &amp; continue") || funnel.includes("Save profile & continue"), "first-run save copy stays");
assert(!funnel.includes("#c49a45") && !funnel.includes("bg-slate-950"), "profile answers are not gold or slate-950");

console.log("join-invite-brand: ok");
