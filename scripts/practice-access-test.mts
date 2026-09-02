/**
 * Practice team access: cap, dual-approval links, Lighthouse Access tab.
 * Run: pnpm test:practice-access
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PRACTICE_CLIENT_ACCESS_CAP,
  accessTokenFromNext,
  parseClassification,
} from "../src/lib/practice-access";
import { accessApproveUrl } from "../src/lib/practice-access-email";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(PRACTICE_CLIENT_ACCESS_CAP === 12, "cap is 12 practice users per client");
assert(parseClassification("partner") === "partner", "parses partner classification");
assert(parseClassification("nope") === "staff", "unknown classification falls back to staff");
assert(accessTokenFromNext("/access/abc123") === "abc123", "parses access next path");
assert(accessApproveUrl("tok").endsWith("/access/tok"), "approve url points at /access/:token");

const mig = readFileSync(resolve("supabase/migrations/20260901160000_practice_client_access.sql"), "utf8");
assert(mig.includes("client_practice_access"), "migration creates per-client assignments");
assert(mig.includes("access_approval_tokens"), "migration creates approval tokens");
assert(mig.includes("firm_staff_invites"), "migration creates staff invites");
assert(mig.includes("has_active_practice_assignment"), "assignment helper");
assert(mig.includes("is_firm_manager"), "firm admin helper");
assert(mig.includes("CREATE OR REPLACE FUNCTION public.has_client_access"), "tightens has_client_access");

const settings = readFileSync(resolve("src/routes/_authenticated/settings.team.tsx"), "utf8");
assert(settings.includes("Team & access"), "accountant settings page exists");
assert(settings.includes("Request access"), "per-client grant UI");
assert(settings.includes("Invite team member"), "firm invite UI");

const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dash.includes("/settings/team"), "dashboard Team button");

const index = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(index.includes("/settings/team"), "settings hub links to team page");

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert(panel.includes('"access"'), "Lighthouse has an Access tab");
assert(panel.includes("LighthouseAccessPanel"), "Access tab renders the admin panel");

const lh = readFileSync(resolve("src/components/lighthouse-access.tsx"), "utf8");
assert(lh.includes("client_owner"), "can toggle owner roles");
assert(lh.includes("Add to a practice firm") || lh.includes("Grant now"), "platform can grant practice access");

const page = readFileSync(resolve("src/routes/access.$token.tsx"), "utf8");
assert(page.includes("redeemAccessToken"), "public page redeems dual-approval links");

const fns = readFileSync(resolve("src/lib/practice-access.functions.ts"), "utf8");
assert(fns.includes("requestClientAccess"), "request assignment server fn");
assert(fns.includes("PRACTICE_CLIENT_ACCESS_CAP"), "enforces the cap");
assert(fns.includes("owner_approve"), "owner approval token");
assert(fns.includes("accountant_approve"), "accountant approval token");

console.log("practice-access-test: ok");
