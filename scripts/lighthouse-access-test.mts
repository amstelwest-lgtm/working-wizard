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

assert(PORTAL_ROLES.includes("accountant") && PORTAL_ROLES.includes("client_owner"), "covers practice and business roles");

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert(panel.includes('"access"'), "Access is a Lighthouse tab");
assert(panel.includes("LighthouseAccessPanel"), "Access tab renders the directory");
assert(panel.includes('t === "access" ? "Access"'), "tab is labelled Access");
assert(panel.includes('tab !== "access"'), "sales Import/Lead stay off Access");

const ui = readFileSync(resolve("src/components/lighthouse-access.tsx"), "utf8");
assert(ui.includes("Every person who can sign in"), "copy covers everyone");
assert(ui.includes("Business owner"), "business owner role is togglable");
assert(ui.includes("Add to a practice firm"), "can grant firm membership");
assert(ui.includes("Add to a business file"), "can grant client membership");
assert(ui.includes("Milōn IT section"), "IT roster stays on the Milōn IT section");

const fns = readFileSync(resolve("src/lib/lighthouse-access.functions.ts"), "utf8");
assert(fns.includes("assertOpsConsoleAccess"), "Access board is ops-guarded");
assert(fns.includes("from(\"user_roles\")"), "toggles portal roles via service role");
assert(fns.includes("from(\"firm_memberships\")"), "reads/writes practice memberships");
assert(fns.includes("from(\"client_memberships\")"), "reads/writes business team memberships");
assert(fns.includes("milon_it_members"), "flags IT members from the existing roster");
assert(!fns.includes("client_practice_access"), "does not depend on unmerged practice-access SQL");

const ops = readFileSync(resolve("src/routes/_authenticated/ops.tsx"), "utf8");
assert(ops.includes("parseLighthouseTab"), "ops URL tab still drives Lighthouse");

console.log("lighthouse-access-test: ok");
