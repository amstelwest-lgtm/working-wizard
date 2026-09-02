/**
 * Lighthouse Access directory: every profile, portal roles, firm + file grants.
 * Run: pnpm test:lighthouse-access
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PORTAL_ROLES } from "../src/lib/lighthouse-access.functions";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  PORTAL_ROLES.includes("accountant") && PORTAL_ROLES.includes("client_owner"),
  "covers practice and business roles",
);

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert(!panel.includes("LighthouseAccessPanel"), "Access is not a sales Lighthouse tab");
assert(!panel.includes('"access"'), "sales tab list does not include access");

const ui = readFileSync(resolve("src/components/lighthouse-access.tsx"), "utf8");
assert(ui.includes("Every person who can sign in"), "copy covers everyone");
assert(ui.includes("Business owner"), "business owner role is togglable");
assert(ui.includes("Add to a practice firm"), "can grant firm membership");
assert(ui.includes("Add to a business file"), "can grant client membership");
assert(ui.includes("add or remove members on Queries"), "IT roster stays on the Queries pane");

const fns = readFileSync(resolve("src/lib/lighthouse-access.functions.ts"), "utf8");
assert(fns.includes("assertOpsConsoleAccess"), "Access board is ops-guarded");
assert(fns.includes('from("user_roles")'), "toggles portal roles via service role");
assert(fns.includes('from("firm_memberships")'), "reads/writes practice memberships");
assert(fns.includes('from("client_memberships")'), "reads/writes business team memberships");
assert(fns.includes("milon_it_members"), "flags IT members from the existing roster");
assert(!fns.includes("client_practice_access"), "does not depend on unmerged practice-access SQL");

const ops = readFileSync(resolve("src/routes/_authenticated/ops.tsx"), "utf8");
assert(ops.includes("LighthouseAccessPanel"), "Access lives in the Milōn IT section");
assert(ops.includes('["access", "Access"]'), "IT section has an Access pane");
assert(ops.includes("parseOpsSearchTab"), "ops URL tab still drives the console");

console.log("lighthouse-access-test: ok");
