/**
 * Practice team access: cap, professional levels, firm-connection approval.
 * Run: pnpm test:practice-access
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASSIFICATION_HELP,
  FIRM_PERMISSION_HELP,
  PARTNER_ASSIGN_TOOLTIP,
  PRACTICE_ACCESS_AMENDMENT_MIGRATION,
  PRACTICE_CLIENT_ACCESS_CAP,
  accessTokenFromNext,
  canPractice,
  classAtMost,
  classesAtOrBelow,
  effectiveClassification,
  parseClassification,
} from "../src/lib/practice-access";
import { accessApproveUrl, accessGrantedEmail } from "../src/lib/practice-access-email";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(PRACTICE_CLIENT_ACCESS_CAP === 12, "cap is 12 practice users per client");
assert(parseClassification("partner") === "partner", "parses partner classification");
assert(parseClassification("nope") === "staff", "unknown classification falls back to staff");
assert(accessTokenFromNext("/access/abc123") === "abc123", "parses access next path");
assert(accessApproveUrl("tok").endsWith("/access/tok"), "approve url points at /access/:token");

assert(canPractice("staff", "sign_off") === false, "1. Staff cannot sign off");
assert(canPractice("bookkeeper", "sign_off") === false, "Staff=Bookkeeper: no sign-off");
assert(canPractice("manager", "sign_off") === false, "2. Manager cannot sign off");
assert(canPractice("reviewer", "sign_off") === false, "Reviewer cannot sign off");
assert(canPractice("partner", "sign_off") === true, "Partner can sign off");
assert(canPractice("staff", "edit") === true, "Staff can edit");
assert(canPractice("bookkeeper", "edit") === true, "Bookkeeper can edit");
assert(canPractice("reviewer", "edit") === false, "Reviewer cannot edit");
assert(canPractice("read_only", "edit") === false, "Read only cannot edit");
assert(canPractice("staff", "submit") === true, "Staff can submit");
assert(canPractice("reviewer", "review") === true, "Reviewer can request changes");
assert(canPractice("staff", "review") === false, "Staff cannot review");

assert(classAtMost("staff", "manager") === "staff", "4. Team Staff cannot escalate to Manager");
assert(classAtMost("manager", "read_only") === "read_only", "per-client can go lower");
assert(classAtMost("staff", "bookkeeper") === "bookkeeper", "Staff=Bookkeeper same rank keeps wanted");
assert(effectiveClassification("manager", "partner") === "manager", "effective is the lower of the two");
assert(effectiveClassification("partner", "staff") === "staff", "partner ceiling still clamps to staff");
assert(classesAtOrBelow("reviewer").includes("manager") === false, "Manager is above Reviewer");
assert(classesAtOrBelow("reviewer").includes("staff") === true, "Staff is at or below Reviewer");

assert(CLASSIFICATION_HELP.includes("Only partners can sign off"), "professional-level helper");
assert(FIRM_PERMISSION_HELP.member.includes("assigned clients"), "team member helper");
assert(FIRM_PERMISSION_HELP.admin.includes("invite"), "firm admin helper");
assert(PARTNER_ASSIGN_TOOLTIP === "Only a partner can assign partner status.", "partner tooltip copy");

const notify = accessGrantedEmail({
  recipientName: "Owner",
  actorName: "Ada",
  memberName: "Thandi",
  memberEmail: "thandi@practice.co.za",
  clientName: "Acme",
  firmName: "Ada & Co",
  classification: "staff",
});
assert(notify.subject.includes("Thandi"), "owner notify names the person");
assert(notify.text.includes("notice"), "owner mail is a notice, not an approval ask");
assert(!notify.html.includes("Approve or decline"), "owner notify has no approve link");

const mig = readFileSync(
  resolve("supabase/migrations/20260901160000_practice_client_access.sql"),
  "utf8",
);
assert(mig.includes("client_practice_access"), "migration creates per-client assignments");
assert(mig.includes("access_approval_tokens"), "migration creates approval tokens");
assert(mig.includes("firm_staff_invites"), "migration creates staff invites");
assert(mig.includes("has_active_practice_assignment"), "assignment helper");
assert(mig.includes("is_firm_manager"), "firm admin helper");
assert(
  mig.includes("CREATE OR REPLACE FUNCTION public.has_client_access"),
  "tightens has_client_access",
);

const amend = readFileSync(resolve(`supabase/migrations/${PRACTICE_ACCESS_AMENDMENT_MIGRATION}`), "utf8");
assert(amend.includes("effective_practice_classification"), "effective class is one DB function");
assert(amend.includes("can_sign_off_deliverable"), "partner-only sign-off helper");
assert(amend.includes("practice_can"), "capability matrix in SQL");
assert(amend.includes("Only a partner can assign partner status"), "partner escalation blocked in SQL");
assert(amend.includes("trg_practice_access_ceiling"), "per-client class cannot exceed team ceiling");
assert(amend.includes("partners insert review signoffs"), "sign-off RLS is partner-only");
assert(amend.includes("client_deliverable_states"), "draft / ready / signed-off table");
assert(amend.includes("status = 'signed_off'"), "6. owners only select signed-off deliverable rows");
assert(amend.includes("audit_log"), "append-only audit_log");
assert(amend.includes("audit_log no update"), "audit_log has no UPDATE");
assert(amend.includes("audit_log no delete"), "audit_log has no DELETE");
assert(
  !/is_firm_manager\(_user_id,\s*c\.firm_id\)/.test(
    amend.split("CREATE OR REPLACE FUNCTION public.has_client_access")[1] ?? "",
  ),
  "5. firm admin no longer has blanket read on every client",
);

const settings = readFileSync(resolve("src/routes/_authenticated/settings.team.tsx"), "utf8");
assert(settings.includes("Team & access"), "accountant settings page exists");
assert(settings.includes("Invite team member"), "firm invite UI");
assert(settings.includes("Firm permissions"), "Practice role renamed");
assert(settings.includes("Professional level"), "Classification renamed");
assert(settings.includes("Save assignments"), "checkbox list commits in one save");
assert(settings.includes("Select all"), "select-all on the client list");
assert(settings.includes("PARTNER_ASSIGN_TOOLTIP"), "partner option tooltip");
assert(!settings.includes("Request access"), "row-at-a-time request builder is gone");
assert(settings.includes("approves this practice once"), "header: approval is the firm connection");

const ownerUi = readFileSync(resolve("src/components/owner-practice-access.tsx"), "utf8");
assert(ownerUi.includes("ownerRevokePracticeAccess"), "owner can revoke a person");
assert(ownerUi.includes("ownerDisconnectFirm"), "owner can disconnect the firm");

const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dash.includes("/settings/team"), "dashboard Team button");

const index = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(index.includes("/settings/team"), "settings hub links to team page");
assert(index.includes("OwnerPracticeAccessCard"), "owner settings lists firm people");

const ops = readFileSync(resolve("src/routes/_authenticated/ops.tsx"), "utf8");
assert(ops.includes("LighthouseAccessPanel"), "Lighthouse Access lives in Milōn IT");

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert(!panel.includes("LighthouseAccessPanel"), "Access is not a sales pipeline tab");

const lh = readFileSync(resolve("src/components/lighthouse-access.tsx"), "utf8");
assert(lh.includes("client_owner"), "can toggle owner roles");
assert(
  lh.includes("Add to a practice firm") || lh.includes("Grant now"),
  "platform can grant practice access",
);

const page = readFileSync(resolve("src/routes/access.$token.tsx"), "utf8");
assert(page.includes("redeemAccessToken"), "public page redeems dual-approval links");

const fns = readFileSync(resolve("src/lib/practice-access.functions.ts"), "utf8");
assert(fns.includes("requestClientAccess"), "request assignment server fn");
assert(fns.includes("saveClientAssignments"), "bulk assignment server fn");
assert(fns.includes("PRACTICE_CLIENT_ACCESS_CAP"), "enforces the cap");
assert(fns.includes("Only a partner can assign partner status"), "3. server rejects non-partner escalation");
assert(fns.includes("ownerRevokePracticeAccess"), "5. owner revoke server fn");
assert(fns.includes("access_granted"), "audit on grant");
assert(fns.includes("professional_level_changed"), "audit on level change");

const signoff = readFileSync(resolve("src/lib/review-signoffs.functions.ts"), "utf8");
assert(signoff.includes("can_sign_off_deliverable"), "sign-off calls the DB partner check");
assert(signoff.includes("submitDeliverable"), "draft → ready");
assert(signoff.includes("requestDeliverableChanges"), "ready → draft");

console.log("practice-access-test: ok");
