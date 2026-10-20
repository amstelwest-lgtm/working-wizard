/**
 * Existing-client owner invite: settings entry, link-only mint, US date copy.
 * Run: pnpm test:client-owner-invite
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionPlanAutomation } from "../src/components/action-plan-automation";
import { ClientFileSettings } from "../src/components/client-file-settings";
import { ClientOwnerInviteDialog } from "../src/components/client-owner-invite-dialog";
import {
  guardedOwnerInvite,
  ownerInviteRequest,
  practiceMemberMayInviteOwner,
} from "../src/lib/client-owner-invite";
import {
  accountantClientRouteSearch,
  canonicalizeAccountantSearch,
  clientNavSearch,
} from "../src/lib/client-route-search";
import { searchFeatures } from "../src/lib/feature-finder";
import { resolveMarket } from "../src/lib/market";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const CLIENT = "11111111-1111-4111-8111-111111111111";
const us = resolveMarket({ country: "US", regionCode: "CA" });

const markup = renderToStaticMarkup(
  createElement(
    Fragment,
    null,
    createElement(ClientFileSettings, {
      clientName: "Northwind",
      onInvite: () => {},
      onPracticeSettings: () => {},
    }),
    createElement(ClientOwnerInviteDialog, {
      open: true,
      clientName: "Northwind",
      market: us,
      email: "owner@example.com",
      onEmailChange: () => {},
      pending: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "owner@example.com",
          createdAt: "2026-10-20T12:00:00.000Z",
          expiresAt: "2026-11-03T18:00:00.000Z",
          url: "https://app.example/?invite=token&mode=signup",
        },
      ],
      pendingLoading: false,
      ownerOnFile: false,
      busy: false,
      error: null,
      linkUrl: null,
      onClose: () => {},
      onCopyLink: () => {},
      onEmailInvite: () => {},
      onCopyPending: () => {},
      onResend: () => {},
      onRevoke: () => {},
    }),
  ),
);

assert(markup.includes('data-client-settings=""'), "client Settings renders the owner section");
assert(markup.includes("Invite owner"), "Settings offers Invite owner");
assert(markup.includes('data-invite-owner-entry=""'), "the Settings button is the invite entry");
assert(markup.includes('data-owner-invite-dialog=""'), "the dialog opens from that entry");
assert(markup.includes("Copy invite link"), "the dialog can copy a link");
assert(markup.includes("Email invite"), "the dialog can email the invite");
assert(markup.includes('data-owner-invite="link"'), "copy is the link-only action");
assert(markup.includes('data-owner-invite="email"'), "email is a separate action");
assert(markup.includes("Nov 3, 2026"), "a US client dates the pending invite in US order");
assert(!/\bZAR\b/.test(markup) && !/\brand\b/i.test(markup), "US copy does not use ZAR");
assert(!markup.includes("3 Nov 2026"), "the US date is not the ZA order");

const closed = renderToStaticMarkup(
  createElement(ClientOwnerInviteDialog, {
    open: false,
    clientName: "Northwind",
    market: us,
    email: "",
    onEmailChange: () => {},
    pending: [],
    pendingLoading: false,
    ownerOnFile: false,
    busy: false,
    error: null,
    linkUrl: null,
    onClose: () => {},
    onCopyLink: () => {},
    onEmailInvite: () => {},
    onCopyPending: () => {},
    onResend: () => {},
    onRevoke: () => {},
  }),
);
assert(closed === "", "a closed dialog renders nothing");

const linkReq = ownerInviteRequest({ clientId: CLIENT, toEmail: "  ", mode: "link" });
assert(
  linkReq.sendEmail === false && linkReq.toEmail === null,
  "an empty link request does not email",
);
const emailReq = ownerInviteRequest({
  clientId: CLIENT,
  toEmail: " Owner@Example.com ",
  mode: "email",
});
assert(
  emailReq.sendEmail === true && emailReq.toEmail === "Owner@Example.com",
  "email mode keeps the address and asks to send",
);

let linkCalls = 0;
const copied = await guardedOwnerInvite(
  async () => {
    linkCalls += 1;
  },
  async (req) => {
    assert(req.sendEmail === false, "link-only mode passes sendEmail false");
    assert(req.clientId === CLIENT, "link-only mode stays on this client");
    return { emailed: false, url: "https://app.example/?invite=abc&mode=signup" };
  },
  { clientId: CLIENT, toEmail: "owner@example.com", mode: "link" },
);
assert(linkCalls === 1, "link-only mode checks access first");
assert(copied.emailed === false, "link-only mode sends no email");

let threw = false;
try {
  await guardedOwnerInvite(
    async () => {},
    async () => ({ emailed: true, url: "https://app.example/?invite=abc&mode=signup" }),
    { clientId: CLIENT, toEmail: "owner@example.com", mode: "link" },
  );
} catch (err) {
  threw = err instanceof Error && err.message === "Copy invite link sent an email";
}
assert(threw, "a link-only result that emailed is a failure");

const emailed = await guardedOwnerInvite(
  async () => {},
  async (req) => {
    assert(req.sendEmail === true, "email mode passes sendEmail true");
    return { emailed: true, url: "https://app.example/?invite=abc&mode=signup" };
  },
  { clientId: CLIENT, toEmail: "owner@example.com", mode: "email" },
);
assert(emailed.emailed === true, "email mode is allowed to send");

assert(
  practiceMemberMayInviteOwner({ clientVisible: true, practiceAssignment: true }) === true,
  "a firm member who can see the client and is assigned may invite",
);
assert(
  practiceMemberMayInviteOwner({ clientVisible: true, practiceAssignment: false }) === false,
  "seeing the client is not enough",
);
assert(
  practiceMemberMayInviteOwner({ clientVisible: false, practiceAssignment: true }) === false,
  "an assignment without a visible client row is refused",
);
assert(
  practiceMemberMayInviteOwner({ clientVisible: false, practiceAssignment: false }) === false,
  "a stranger is refused",
);

const studio = { audience: "accountant" as const, clientId: CLIENT };
const inviteHit = searchFeatures("invite owner", studio).results[0];
assert(inviteHit?.label === "Invite owner", "Cmd+K labels the jump Invite owner");
assert(
  inviteHit?.href.includes("tab=settings") && inviteHit.href.includes("invite=owner"),
  "Cmd+K opens client Settings with the invite flag",
);
assert(
  !searchFeatures("invite owner", { audience: "owner", clientId: CLIENT }).results.some(
    (row) => row.id === "invite-owner",
  ),
  "the owner palette does not offer Invite owner",
);

assert(
  canonicalizeAccountantSearch({ tab: "settings" }).tab === "settings",
  "client Settings stays on the settings tab",
);
const kept = accountantClientRouteSearch({ tab: "settings", invite: "owner" });
assert(kept.tab === "settings" && kept.invite === "owner", "the invite flag sticks on Settings");
const dropped = accountantClientRouteSearch({ tab: "plan", invite: "owner" });
assert(dropped.invite === undefined, "the invite flag does not stick on another tab");
const gear = clientNavSearch({ tab: "plan", invite: "owner" }, "settings");
assert(
  gear.tab === "settings" && !("invite" in gear),
  "the Settings gear does not auto-open the dialog",
);

const waitingRow = {
  id: "handed",
  title: "Confirm the payment",
  owner: null,
  ownerSuggested: false,
  dueDate: "2026-11-03",
  dueSuggested: false,
  followUp: "waiting" as const,
  overdue: false,
};
const openWork = renderToStaticMarkup(
  createElement(ActionPlanAutomation, {
    rows: [waitingRow],
    duplicates: [],
    contradictions: [],
    canEdit: true,
    onConfirm: () => {},
    onDrop: () => {},
    onInviteOwner: () => {},
  }),
);
assert(openWork.includes("Waiting on the owner"), "Open work still says waiting on the owner");
assert(openWork.includes('data-invite-the-owner=""'), "Open work offers Invite the owner");
assert(openWork.includes("Invite the owner"), "the Open work link is labelled Invite the owner");
const quiet = renderToStaticMarkup(
  createElement(ActionPlanAutomation, {
    rows: [waitingRow],
    duplicates: [],
    contradictions: [],
    canEdit: true,
    onConfirm: () => {},
    onDrop: () => {},
  }),
);
assert(quiet === "", "without the accountant callback a waiting row stays quiet");

const read = (path: string) => readFileSync(resolve(path), "utf8");
const clientPage = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(
  clientPage.includes("ClientOwnerInviteHost"),
  "the client file mounts the shared invite host",
);
assert(clientPage.includes("showEntry={onClientSettings}"), "Settings is where the entry shows");
assert(
  clientPage.includes("onInviteOwner={() => setOwnerInviteOpen(true)}"),
  "Open work opens the same dialog",
);
assert(
  read("src/components/action-plan-automation.tsx").includes("Invite the owner"),
  "Open work copy is Invite the owner",
);
assert(
  read("src/lib/client-invite.functions.ts").includes("sendEmail !== false"),
  "link-only mode is the existing inviteClientOwner flag",
);
const ownerHome = read("src/components/owner-door/owner-home.tsx");
assert(
  ownerHome.includes("OwnerInviteNudge") && ownerHome.includes("inviteClientId"),
  "the owner home invites their accountant for this client",
);
assert(
  read("src/routes/_authenticated/settings.index.tsx").includes("InviteAccountantCard"),
  "owner Settings still invites the accountant",
);

console.log("client-owner-invite ok");
