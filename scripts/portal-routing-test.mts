/**
 * Portal routing: accountant door vs SME founder board.
 * Run: pnpm test:portal-routing
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  summarizeRoles,
  decidePostLoginPath,
  decideAccountantStay,
  decideOwnerAppBounce,
  isSmeOnly,
  canEnterAccountantPortal,
  isPracticeSignupMeta,
  type PortalRouteDecision,
} from "../src/lib/user-roles";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function d(partial: Partial<PortalRouteDecision>): PortalRouteDecision {
  return {
    hasPracticeRole: false,
    hasClientRole: false,
    hasFirm: false,
    intent: null,
    force: null,
    practiceSignup: false,
    ...partial,
  };
}

const dual = d({ hasPracticeRole: true, hasClientRole: true, practiceSignup: true });
const practiceOnly = d({ hasPracticeRole: true });
const clientOnly = d({ hasClientRole: true });
const noRolesFirm = d({ hasFirm: true });
const promotedClient = d({
  hasPracticeRole: true,
  hasClientRole: true,
  hasFirm: true,
  practiceSignup: false,
  force: "accountant",
});

// ── summarizeRoles ──────────────────────────────────────────────────────────
const dualRoles = summarizeRoles(["firm_admin", "client_owner"]);
assert(dualRoles.hasPracticeRole && dualRoles.hasClientRole, "dual-role flags");
assert(dualRoles.primaryRole === "firm_admin", "dual-role primary is practice");
assert(summarizeRoles(["client_owner"]).primaryRole === "client_owner", "owner primary");
assert(summarizeRoles(["accountant"]).hasPracticeRole, "accountant is practice");

// ── The reported glitch: accountant-door sign-in ────────────────────────────
assert(
  decidePostLoginPath({ ...dual, force: "accountant" }) === "/dashboard",
  "dual-role + accountant force → practice portal",
);
assert(
  decideAccountantStay({ ...dual, force: "accountant" }) === true,
  "dual-role + accountant force stays on /dashboard",
);
assert(
  decideOwnerAppBounce({ ...dual, force: "accountant", actingAsClient: false }) === true,
  "dual-role wrongly on /app after accountant login is sent to /dashboard",
);

assert(
  decidePostLoginPath({ ...dual, force: "owner" }) === "/app",
  "dual-role + owner force → founder board",
);
assert(
  decidePostLoginPath({ ...dual, intent: "accountant" }) === "/dashboard",
  "dual-role + accountant intent → practice portal",
);
assert(
  decidePostLoginPath({ ...dual, intent: "owner" }) === "/app",
  "dual-role + owner intent → founder board",
);
assert(decidePostLoginPath(dual) === "/app", "dual-role with no intent defaults to founder board");

// Visiting /dashboard after accountant login must not bounce anyone who chose that door
assert(decideAccountantStay(dual) === true, "dual-role stays on accountant portal (practice role)");
assert(
  decideAccountantStay({ ...clientOnly, force: "accountant" }) === false,
  "SME-only cannot stay on /dashboard just because they used the accountant door",
);
assert(
  decideAccountantStay({ ...clientOnly, intent: "accountant" }) === false,
  "stale accountant intent must not trap an SME-only invitee on /dashboard",
);
assert(
  decideAccountantStay({ ...clientOnly, force: null, intent: "accountant" }) === false,
  "dashboard must not treat leftover intent as a just-signed-in accountant door",
);
assert(
  decideOwnerAppBounce({ ...dual, actingAsClient: false }) === false,
  "dual-role later visit to /app (no force) is allowed",
);

// ── Pure practice / pure client ─────────────────────────────────────────────
assert(decidePostLoginPath(practiceOnly) === "/dashboard", "practice-only → portal");
assert(decideAccountantStay(practiceOnly) === true, "practice-only stays");
assert(
  decideOwnerAppBounce({ ...practiceOnly, actingAsClient: false }) === true,
  "practice-only is bounced off /app",
);

assert(decidePostLoginPath(clientOnly) === "/app", "client-only → founder board");
assert(decideAccountantStay(clientOnly) === false, "client-only does not stay on portal by role alone");
assert(
  decidePostLoginPath({ ...clientOnly, intent: "accountant" }) === "/app",
  "SME-only + leftover accountant intent → founder board (invitees)",
);
assert(
  decidePostLoginPath({ ...clientOnly, force: "owner" }) === "/app",
  "invite force owner → founder board",
);
assert(
  decidePostLoginPath({ ...clientOnly, force: "accountant" }) === "/app",
  "SME-only + accountant door → founder board, not practice portal",
);
assert(
  decideOwnerAppBounce({ ...clientOnly, force: "accountant", actingAsClient: false }) === false,
  "SME-only accountant-door session is not bounced into the practice portal",
);

assert(canEnterAccountantPortal(promotedClient) === false, "auto-promoted client cannot enter portal");
assert(
  decidePostLoginPath(promotedClient) === "/app",
  "Karoo-style client + leftover firm_admin + accountant door → founder board",
);
assert(
  decideAccountantStay(promotedClient) === false,
  "auto-promoted client cannot stay on /dashboard",
);
assert(
  decideOwnerAppBounce({ ...promotedClient, actingAsClient: false }) === false,
  "auto-promoted client is not yanked from /app into the practice portal",
);
assert(isPracticeSignupMeta({ signup_type: "customer" }) === false, "customer signup is not practice");
assert(isPracticeSignupMeta({ signup_type: "accountant" }) === true, "accountant signup is practice");
assert(isPracticeSignupMeta({ firm_name: "Acme & Partners" }) === true, "firm_name marks practice signup");

assert(decidePostLoginPath(noRolesFirm) === "/dashboard", "firm owner with no role rows → portal");
assert(decideAccountantStay(noRolesFirm) === true, "firm owner stays");
assert(
  decideAccountantStay(d({ intent: "accountant" })) === true,
  "accountant-door provisioning race stays on portal",
);

assert(
  decidePostLoginPath({ ...dual, intent: "accountant", force: "owner" }) === "/app",
  "explicit founder-door force wins over leftover accountant intent",
);
assert(
  decideAccountantStay({ ...clientOnly, hasFirm: false, intent: "accountant" }) === false,
  "SME invitee with leftover accountant intent leaves /dashboard",
);

assert(
  decideAccountantStay(d({ force: "accountant" })) === true,
  "no-role accountant-door provisioning race stays on portal",
);
assert(
  decidePostLoginPath(d({ force: "accountant" })) === "/dashboard",
  "no-role accountant-door lands on portal",
);

// Impersonation must never bounce back to the firm dashboard
assert(
  decideOwnerAppBounce({ ...practiceOnly, force: "accountant", actingAsClient: true }) === false,
  "acting-as-client stays on /app",
);

assert(isSmeOnly(clientOnly) === true, "client-only is SME-only");
assert(isSmeOnly(dual) === false, "dual-role is not SME-only");
assert(isSmeOnly(practiceOnly) === false, "practice-only is not SME-only");
assert(isSmeOnly(noRolesFirm) === false, "firm owner without roles is not SME-only");

const authSrc = readFileSync(resolve("src/routes/auth.tsx"), "utf8");
assert(authSrc.includes("resolvePostLoginPath"), "accountant /auth lands via role-aware path");
assert(
  authSrc.includes("This sign-in is for accounting firms"),
  "accountant /auth tells SME-only users they are on the wrong door",
);

const dashSrc = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(
  !dashSrc.includes("isAccountantDoor()"),
  "dashboard must not skip the role check for accountant-door sessions",
);
assert(
  dashSrc.includes("shouldStayOnAccountantPortal"),
  "dashboard still uses the stay helper",
);

const layoutSrc = readFileSync(resolve("src/routes/_authenticated.tsx"), "utf8");
assert(
  layoutSrc.includes("shouldStayOnAccountantPortal"),
  "practice routes under /_authenticated bounce business-client sessions",
);

const profileSrc = readFileSync(resolve("src/contexts/accountant-profile.tsx"), "utf8");
assert(profileSrc.includes("isPracticeSignupMeta"), "profile provider skips minting firms for SME logins");
assert(
  profileSrc.includes("ensure_practice_firm"),
  "profile provider still provisions firms for practice accounts",
);

console.log("portal-routing: all assertions passed");
