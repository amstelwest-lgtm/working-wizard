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
  PRACTICE_OWNER_ACCESS_MIGRATION,
  accessTokenFromNext,
  canPractice,
  classAtMost,
  classesAtOrBelow,
  effectiveClassification,
  parseClassification,
} from "../src/lib/practice-access";
import { createHash } from "node:crypto";
import { accessApproveUrl, accessGrantedEmail, firmInviteEmail, publicEmailError } from "../src/lib/practice-access-email";
import {
  STAFF_INVITE_INVALID_MESSAGE,
  staffInvitePhase,
} from "../src/lib/staff-invite-landing";
import {
  STAFF_INVITE_TTL_MS,
  revokeFirmStaffInviteRecord,
  rotateFirmStaffInviteLink,
} from "../src/lib/firm-staff-invite.server";
import type { LooseAdmin } from "../src/lib/owner-ops.guard";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(PRACTICE_CLIENT_ACCESS_CAP === 12, "cap is 12 practice users per client");
assert(parseClassification("partner") === "partner", "parses partner classification");
assert(parseClassification("nope") === "staff", "unknown classification falls back to staff");
assert(accessTokenFromNext("/access/abc123") === "abc123", "parses access next path");
assert(accessApproveUrl("tok").endsWith("/access/tok"), "approve url points at /access/:token");

assert(canPractice("staff", "sign_off") === false, "1. Staff cannot sign off");
assert(canPractice("bookkeeper", "sign_off") === false, "Staff=books staff: no sign-off");
assert(canPractice("manager", "sign_off") === false, "2. Manager cannot sign off");
assert(canPractice("reviewer", "sign_off") === false, "Reviewer cannot sign off");
assert(canPractice("partner", "sign_off") === true, "Partner can sign off");
assert(canPractice("staff", "edit") === true, "Staff can edit");
assert(canPractice("bookkeeper", "edit") === true, "books staff can edit");
assert(canPractice("reviewer", "edit") === false, "Reviewer cannot edit");
assert(canPractice("read_only", "edit") === false, "Read only cannot edit");
assert(canPractice("staff", "submit") === true, "Staff can submit");
assert(canPractice("reviewer", "review") === true, "Reviewer can request changes");
assert(canPractice("staff", "review") === false, "Staff cannot review");

assert(classAtMost("staff", "manager") === "staff", "4. Team Staff cannot escalate to Manager");
assert(classAtMost("manager", "read_only") === "read_only", "per-client can go lower");
assert(classAtMost("staff", "bookkeeper") === "bookkeeper", "Staff=books staff same rank keeps wanted");
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

const staffMail = firmInviteEmail({
  recipientName: "Nia",
  firmName: "Ben Accountants",
  inviterName: "Bo",
  roleLabel: "Read only",
  url: "https://www.milonfinance.com/access/abc",
});
assert(staffMail.subject === "Join Ben Accountants on Milōn", "staff invite subject names the firm");
assert(
  staffMail.text.includes(
    "Ben Accountants invited you to join their Milōn workspace as Read only. Open the link to create your account with this email address; it takes a minute.",
  ),
  "staff invite tells a new hire to create an account with this email",
);
assert(!staffMail.text.includes("already approved"), "staff invite drops owner-portal approval copy");
assert(!staffMail.html.includes("business owner"), "staff invite html drops the owner sentence");
assert(staffMail.text.includes("https://www.milonfinance.com/access/abc"), "staff invite keeps the access link");
const existingStaffMail = firmInviteEmail({
  recipientName: "Nia",
  firmName: "Ben Accountants",
  inviterName: "Bo",
  roleLabel: "Read only",
  url: "https://www.milonfinance.com/auth",
  accountExists: true,
});
assert(
  existingStaffMail.text.includes("Sign in with this email address to accept"),
  "existing staff are asked to sign in",
);
assert(!existingStaffMail.text.includes("create your account"), "existing staff are not told to create an account");
assert(!existingStaffMail.html.includes("already approved"), "existing staff mail also drops owner copy");

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

const ownerAccess = readFileSync(
  resolve(`supabase/migrations/${PRACTICE_OWNER_ACCESS_MIGRATION}`),
  "utf8",
);
assert(ownerAccess.includes("grant_practice_principal_access"), "grants principal access");
assert(ownerAccess.includes("is_practice_principal"), "owner and partner predicate");
assert(ownerAccess.includes("fm.role = 'owner' OR fm.classification = 'partner'"), "role owner or partner class");
assert(
  ownerAccess.includes("AFTER INSERT OR UPDATE OF firm_id ON public.clients"),
  "client insert and firm connect grant access",
);
assert(
  ownerAccess.includes("AFTER INSERT OR UPDATE OF role, classification, firm_id ON public.firm_memberships"),
  "new owner or partner membership grants access",
);
assert(ownerAccess.includes("WHERE NOT EXISTS"), "backfill does not duplicate an existing row");
assert(ownerAccess.includes("a.status = 'pending'"), "pending principal rows can become active");
assert(ownerAccess.includes("a.status IN ('revoked', 'declined')"), "revoked rows stay revoked");
assert(!ownerAccess.includes("CREATE POLICY"), "does not add or weaken RLS policies");
assert(!ownerAccess.includes("DROP POLICY"), "does not drop RLS policies");
assert(ownerAccess.includes("accountant_approved_at"), "fills accountant approval");
assert(ownerAccess.includes("requested_by"), "records who requested the grant");
assert(ownerAccess.includes("practice_class_at_most"), "classification stays inside the team ceiling");
assert(
  ownerAccess.includes("CREATE OR REPLACE FUNCTION public.has_active_practice_assignment"),
  "principal fallback lives on the assignment check",
);
assert(
  !ownerAccess.includes("CREATE OR REPLACE FUNCTION public.trg_deliverable_state_caps"),
  "deliverable trigger is not loosened",
);
assert(ownerAccess.includes("SECURITY DEFINER"), "grant runs as definer");
assert(ownerAccess.includes("SET search_path = public"), "definer functions pin search_path");
assert(ownerAccess.includes("list_client_practice_team"), "action plan can list firm members on the client");
assert(
  settings.includes("${a.clientId}:${a.userId}"),
  "per-client access table keys rows by client and user",
);

assert(
  settings.includes("Invite saved, but the email didn't send. Copy the link and send it yourself."),
  "failed invite email stays on the page",
);
assert(settings.includes('"Copy link"'), "failed invite has a copy button");
assert(settings.includes("Copy invite link"), "pending invite can copy a fresh link");
assert(settings.includes("revokeFirmStaffInvite"), "pending invite can be revoked");
assert(settings.includes("Revoke invite for"), "revoke asks before it runs");
assert(
  settings.includes("Their link will stop working."),
  "revoke confirm says the link will stop working",
);
assert(settings.includes("sendEmail: true"), "resend emails the fresh link");
assert(settings.includes("if (r.emailed)"), "success toast runs only after a real send");
assert(settings.includes('toast.success('), "a successful invite still toasts");
assert(fns.includes("if (tokenError)"), "approval-token insert failure fails the invite");
assert(fns.includes('console.error("inviteFirmStaff email failed"'), "invite logs the send error");
assert(fns.includes("accessApproveUrl(token)"), "new invite returns a copyable link");
assert(fns.includes("error: sent.ok ? null : sent.error"), "existing-user invite returns the send error");
assert(fns.includes("rotateFirmStaffInviteLink"), "token rotation is a firm-scoped server action");

const emailSrc = readFileSync(resolve("src/lib/practice-access-email.ts"), "utf8");
assert(emailSrc.includes("AbortSignal.timeout(RESEND_SEND_TIMEOUT_MS)"), "access email aborts a hung send");
assert(emailSrc.includes('console.error("sendAccessEmail failed"'), "Resend failures are logged with status and message");
assert(emailSrc.includes("from: `Milōn <${fromAddr}>`"), "from-address construction is unchanged");
assert(
  publicEmailError(
    403,
    '{"message":"API key not authorized to send emails from trymilon.com","key":"re_live_secretkey123456"}',
  ) === "Resend 403: API key not authorized to send emails from trymilon.com",
  "email errors keep the Resend message and drop secrets",
);
assert(
  publicEmailError(null, "Bearer re_test_abcdefghijklmnopqrstuvwxyz timed out") ===
    "Bearer [redacted] timed out",
  "bearer tokens are not returned",
);

type Row = Record<string, unknown>;

function sha(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function memoryAdmin(tables: Record<string, Row[]>): LooseAdmin {
  const live = (table: string) => {
    if (!tables[table]) tables[table] = [];
    return tables[table];
  };
  const match = (table: string, filters: Array<[string, unknown]>) =>
    live(table).filter((row) => filters.every(([col, val]) => row[col] === val));
  return {
    from(table: string) {
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return builder;
            },
            maybeSingle() {
              return Promise.resolve({ data: match(table, filters)[0] ?? null, error: null });
            },
            then(
              onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve({ data: match(table, filters), error: null }).then(
                onFulfilled,
                onRejected,
              );
            },
          };
          return builder;
        },
        update(patch: Row) {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return builder;
            },
            then(
              onFulfilled?: (value: { error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve().then(() => {
                for (const row of match(table, filters)) Object.assign(row, patch);
                return { error: null };
              }).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
        insert(row: Row) {
          live(table).push({ ...row });
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return builder;
            },
            then(
              onFulfilled?: (value: { error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve().then(() => {
                const drop = new Set(match(table, filters));
                tables[table] = live(table).filter((row) => !drop.has(row));
                return { error: null };
              }).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: null } }),
        listUsers: async () => ({ data: { users: [] } }),
      },
    },
  } as LooseAdmin;
}

const FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MEMBER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";
const INVITE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OLD = "0123456789abcdef0123456789abcdef";
const NEW = "fedcba9876543210fedcba9876543210";
const NOW = new Date("2026-10-08T11:56:00.000Z");
const EXPIRES = new Date(NOW.getTime() + STAFF_INVITE_TTL_MS).toISOString();

function seed(): Record<string, Row[]> {
  return {
    firms: [
      { id: FIRM, name: "Ada & Co", owner_user_id: OWNER },
      { id: OTHER, name: "Other Practice", owner_user_id: OUTSIDER },
    ],
    firm_memberships: [
      { firm_id: FIRM, user_id: ADMIN, role: "admin", classification: "manager" },
      { firm_id: FIRM, user_id: MEMBER, role: "member", classification: "staff" },
      { firm_id: OTHER, user_id: OUTSIDER, role: "admin", classification: "partner" },
    ],
    profiles: [
      { id: OWNER, email: "ada@ada.co", full_name: "Ada" },
      { id: ADMIN, email: "bo@ada.co", full_name: "Bo" },
    ],
    firm_staff_invites: [
      {
        id: INVITE,
        firm_id: FIRM,
        email: "nia@practice.co.za",
        name: "Nia",
        membership_role: "member",
        classification: "staff",
        accepted_at: null,
        token_hash: sha(OLD),
        expires_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    access_approval_tokens: [
      {
        id: "token-old",
        purpose: "firm_invite",
        invite_id: INVITE,
        email: "nia@practice.co.za",
        token_hash: sha(OLD),
        used_at: "2026-10-02T00:00:00.000Z",
        expires_at: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "token-extra",
        purpose: "firm_invite",
        invite_id: INVITE,
        email: "nia@practice.co.za",
        token_hash: sha("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        used_at: null,
        expires_at: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "token-other",
        purpose: "owner_approve",
        invite_id: INVITE,
        email: "owner@client.co.za",
        token_hash: "leave-this-hash",
        used_at: null,
        expires_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    audit_log: [],
  };
}

function hashes(tables: Record<string, Row[]>): string[] {
  return [
    ...tables.firm_staff_invites.map((row) => String(row.token_hash)),
    ...tables.access_approval_tokens.map((row) => String(row.token_hash)),
  ];
}

async function expectThrow(run: () => Promise<unknown>, includes: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(includes), `expected throw containing ${includes}`);
    return;
  }
  throw new Error(`expected a throw containing ${includes}`);
}

{
  const denied = seed();
  const before = hashes(denied).join("|");
  await expectThrow(
    () =>
      rotateFirmStaffInviteLink(memoryAdmin(denied), {
        actorId: MEMBER,
        inviteId: INVITE,
        sendEmail: false,
        now: NOW,
        mintToken: () => NEW,
      }),
    "practice owner or a firm admin",
  );
  await expectThrow(
    () =>
      rotateFirmStaffInviteLink(memoryAdmin(denied), {
        actorId: OUTSIDER,
        inviteId: INVITE,
        sendEmail: true,
        now: NOW,
        mintToken: () => NEW,
      }),
    "practice owner or a firm admin",
  );
  assert(hashes(denied).join("|") === before, "unauthorized rotation does not replace hashes");
  assert(denied.access_approval_tokens.some((row) => row.token_hash === sha(OLD)), "old token still valid after a refused rotation");

  const accepted = seed();
  accepted.firm_staff_invites[0].accepted_at = "2026-10-03T00:00:00.000Z";
  await expectThrow(
    () =>
      rotateFirmStaffInviteLink(memoryAdmin(accepted), {
        actorId: OWNER,
        inviteId: INVITE,
        sendEmail: false,
        now: NOW,
        mintToken: () => NEW,
      }),
    "already accepted",
  );
  assert(accepted.firm_staff_invites[0].token_hash === sha(OLD), "accepted invite keeps its hash");

  const tables = seed();
  let sends = 0;
  const quiet = await rotateFirmStaffInviteLink(memoryAdmin(tables), {
    actorId: ADMIN,
    inviteId: INVITE,
    sendEmail: false,
    now: NOW,
    mintToken: () => NEW,
    send: async () => {
      sends += 1;
      return { ok: true };
    },
  });
  assert(sends === 0, "copy link does not email");
  assert(quiet.emailed === false && quiet.error === null, "copy link reports that nothing was emailed");
  assert(quiet.inviteUrl.endsWith(`/access/${NEW}`), "copy link returns the new invite url");
  assert(tables.firm_staff_invites[0].token_hash === sha(NEW), "invite hash is replaced");
  assert(tables.firm_staff_invites[0].expires_at === EXPIRES, "invite expiry extends 14 days");
  const firmTokens = tables.access_approval_tokens.filter((row) => row.purpose === "firm_invite");
  assert(firmTokens.length === 1, "extra firm-invite tokens are removed");
  assert(firmTokens[0].token_hash === sha(NEW), "approval token hash is replaced");
  assert(firmTokens[0].expires_at === EXPIRES, "approval token expiry extends 14 days");
  assert(firmTokens[0].used_at === null, "rotated token is unused");
  assert(
    !tables.access_approval_tokens.some((row) => row.token_hash === sha(OLD)),
    "old token no longer matches an approval row",
  );
  assert(
    !tables.firm_staff_invites.some((row) => row.token_hash === sha(OLD)),
    "old token no longer matches the invite",
  );
  assert(
    tables.access_approval_tokens.some((row) => row.token_hash === "leave-this-hash"),
    "unrelated approval tokens stay",
  );

  const mailed = seed();
  const captured: string[] = [];
  const failedSend = await rotateFirmStaffInviteLink(memoryAdmin(mailed), {
    actorId: OWNER,
    inviteId: INVITE,
    sendEmail: true,
    now: NOW,
    mintToken: () => NEW,
    send: async (opts) => {
      captured.push(opts.text);
      return { ok: false, error: "Resend 403: API key not authorized to send emails from trymilon.com" };
    },
  });
  assert(failedSend.emailed === false, "resend reports emailed false");
  assert(
    failedSend.error === "Resend 403: API key not authorized to send emails from trymilon.com",
    "resend returns the safe error",
  );
  assert(failedSend.inviteUrl.endsWith(`/access/${NEW}`), "resend still returns the new link");
  assert(captured.length === 1 && captured[0].includes(`/access/${NEW}`), "resent mail uses the new link");
  assert(!captured[0].includes(OLD), "resent mail does not include the old token");
  assert(mailed.firm_staff_invites[0].token_hash === sha(NEW), "owner rotation replaces the invite hash");

  const revoked = seed();
  await expectThrow(
    () => revokeFirmStaffInviteRecord(memoryAdmin(revoked), { actorId: MEMBER, inviteId: INVITE }),
    "practice owner or a firm admin",
  );
  assert(revoked.firm_staff_invites.length === 1, "a team member cannot revoke an invite");
  await revokeFirmStaffInviteRecord(memoryAdmin(revoked), { actorId: ADMIN, inviteId: INVITE });
  assert(revoked.firm_staff_invites.length === 0, "an admin revoke removes the invite");
  assert(
    !revoked.access_approval_tokens.some((row) => row.invite_id === INVITE),
    "revoke detaches every token for that invite",
  );
  const tombstone = revoked.access_approval_tokens.find((row) => row.token_hash === sha(OLD));
  assert(Boolean(tombstone), "a revoked token still resolves");
  assert(tombstone?.invite_id == null, "revoked token is no longer tied to the invite");
  assert(
    Date.parse(String(tombstone?.expires_at)) < Date.parse(NOW.toISOString()) ||
      Date.parse(String(tombstone?.expires_at)) < Date.now(),
    "revoked token is expired",
  );
  assert(
    staffInvitePhase({
      expired: true,
      used: Boolean(tombstone?.used_at),
      accountExists: false,
      signedInEmail: null,
      invitedEmail: "nia@practice.co.za",
    }) === "invalid",
    "a revoked token renders as no longer valid",
  );
  assert(
    STAFF_INVITE_INVALID_MESSAGE ===
      "This invite is no longer valid. Ask your firm admin to send a new one.",
    "revoked and expired staff invites use the firm-admin message",
  );
}

console.log("practice-access-test: ok");
