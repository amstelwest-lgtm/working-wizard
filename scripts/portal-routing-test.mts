/**
 * Portal routing: accountant door vs SME founder board.
 * Run: pnpm test:portal-routing
 */
import {
  summarizeRoles,
  decidePostLoginPath,
  decideAccountantStay,
  decideOwnerAppBounce,
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
    ...partial,
  };
}

const dual = d({ hasPracticeRole: true, hasClientRole: true });
const practiceOnly = d({ hasPracticeRole: true });
const clientOnly = d({ hasClientRole: true });
const noRolesFirm = d({ hasFirm: true });

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
  decideAccountantStay({ ...clientOnly, force: "accountant" }) === true,
  "accountant-door login stays even without a practice role yet (provisioning / dual-role gap)",
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
  decidePostLoginPath({ ...clientOnly, force: "accountant" }) === "/dashboard",
  "client-only + accountant force → practice portal (door they chose)",
);
assert(
  decideOwnerAppBounce({ ...clientOnly, force: "accountant", actingAsClient: false }) === true,
  "accountant-door session on /app is sent to the practice portal",
);

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

// Impersonation must never bounce back to the firm dashboard
assert(
  decideOwnerAppBounce({ ...practiceOnly, force: "accountant", actingAsClient: true }) === false,
  "acting-as-client stays on /app",
);

console.log("portal-routing: all assertions passed");
