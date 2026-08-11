/**
 * Integration test — invite accept flows (G25 ownership handoff)
 *
 *   A) Firm-created client: accountant is placeholder owner → invitee becomes
 *      clients.owner_user_id (client_owner), firm_id kept, invitee can UPDATE,
 *      accountant (firm) can still UPDATE via is_client_writer.
 *   B) True owner inviting staff: ownership stays; invitee is client_member and
 *      cannot UPDATE (Gap 3).
 *
 * Run: pnpm test:invited-member
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signUpInvitedMember } from "@/lib/invite-member.server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const PROJECT_ID = (process.env.VITE_SUPABASE_PROJECT_ID ?? "cujzeoyvnpfokgwfftyd").replace(/"/g, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

async function getServiceRoleKey(): Promise<string> {
  if (!ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/api-keys`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Management API responded ${res.status}: ${await res.text()}`);
  const keys = (await res.json()) as Array<{ name: string; api_key: string }>;
  const svcKey = keys.find((k) => k.name === "service_role")?.api_key;
  if (!svcKey) throw new Error("service_role key not found");
  return svcKey;
}

let passed = 0;
let failed = 0;

function pass(label: string) {
  console.log(`  ✅ ${label}`);
  passed++;
}
function fail(label: string, detail?: string) {
  console.error(`  ❌ ${label}${detail ? `\n     → ${detail}` : ""}`);
  failed++;
}
function section(t: string) {
  console.log(`\n── ${t} ──`);
}

function testInviteUrlParsing() {
  section("Invite URL param parsing (pure function — mirrors index.tsx useEffect)");

  function parseInviteParams(search: string): string | null {
    const params = new URLSearchParams(search);
    const inv = params.get("invite");
    const mode = params.get("mode");
    if (inv && mode === "signup") return inv;
    return null;
  }

  const clientId = "550e8400-e29b-41d4-a716-446655440000";

  parseInviteParams(`?invite=${clientId}&mode=signup`) === clientId
    ? pass("?invite=<id>&mode=signup → inviteClientId extracted ✓")
    : fail("Failed to extract inviteClientId from invite URL");

  parseInviteParams(`?invite=${clientId}`) === null
    ? pass("?invite=<id> without mode=signup → null ✓")
    : fail("Missing mode=signup should not be treated as invite");

  parseInviteParams("?mode=signup") === null
    ? pass("?mode=signup without invite= → null ✓")
    : fail("Missing invite= should not be treated as invite");

  parseInviteParams("") === null
    ? pass("Empty search string → null ✓")
    : fail("Empty params should return null");

  parseInviteParams(`?invite=${clientId}&mode=login`) === null
    ? pass("mode=login (not signup) → null ✓")
    : fail("mode=login should not trigger invite flow");
}

function testFirstRunGateLogic() {
  section("First-run gate logic (pure function — mirrors app.tsx clientMeta effect)");

  function shouldShowOnboarding(opts: {
    businessType: string | null;
    actingClientId: string | null;
    userRole: string | null;
  }): boolean {
    if (opts.businessType) return false;
    if (opts.actingClientId) return false;
    if (opts.userRole === null) return false;
    if (opts.userRole === "client_member") return false;
    return true;
  }

  shouldShowOnboarding({ businessType: null, actingClientId: null, userRole: "client_owner" })
    ? pass("Owner with no business_type → onboarding shown")
    : fail("Owner with no business_type should trigger onboarding");

  !shouldShowOnboarding({ businessType: "service", actingClientId: null, userRole: "client_owner" })
    ? pass("Owner with existing business_type → no onboarding")
    : fail("Owner with business_type set should NOT trigger onboarding");

  !shouldShowOnboarding({ businessType: null, actingClientId: null, userRole: "client_member" })
    ? pass("client_member with no business_type → NO onboarding ✓")
    : fail("client_member MUST NOT see the first-run onboarding dialog");

  !shouldShowOnboarding({ businessType: null, actingClientId: "some-client-id", userRole: "firm_admin" })
    ? pass("firm_admin acting as client → no onboarding")
    : fail("Acting-client mode should not show onboarding");

  !shouldShowOnboarding({ businessType: null, actingClientId: null, userRole: null })
    ? pass("userRole=null → onboarding deferred")
    : fail("Should not show onboarding before userRole is known");
}

async function cleanupUsers(admin: SupabaseClient, userIds: string[], clientIds: string[], firmIds: string[]) {
  for (const uid of userIds) {
    if (!uid) continue;
    await admin.from("client_memberships").delete().eq("user_id", uid);
    await admin.from("firm_memberships").delete().eq("user_id", uid);
    await admin.from("user_roles").delete().eq("user_id", uid);
  }
  for (const cid of clientIds) {
    if (cid) await admin.from("clients").delete().eq("id", cid);
  }
  for (const fid of firmIds) {
    if (fid) await admin.from("firms").delete().eq("id", fid);
  }
  for (const uid of userIds) {
    if (uid) await admin.auth.admin.deleteUser(uid);
  }
}

/** A) Firm placeholder → invitee becomes owner; firm retains write access. */
async function testFirmOwnershipHandoff(admin: SupabaseClient) {
  const ts = Date.now();
  const accountantEmail = `acct-${ts}@example.com`;
  const ownerEmail = `bizowner-${ts}@example.com`;
  const password = "Test1234!";
  let accountantId = "";
  let inviteeId = "";
  let clientId = "";
  let firmId = "";

  section("A1 · Firm accountant creates client (placeholder owner)");
  const { data: acctU, error: acctErr } = await admin.auth.admin.createUser({
    email: accountantEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Test Accountant", signup_type: "accountant" },
  });
  if (acctErr || !acctU.user) {
    fail("Create accountant", acctErr?.message);
    return;
  }
  accountantId = acctU.user.id;
  pass(`Accountant created: ${accountantEmail}`);

  const { data: firmRow, error: firmErr } = await admin
    .from("firms")
    .insert({ name: `Firm ${ts}`, owner_user_id: accountantId })
    .select("id")
    .single();
  if (firmErr || !firmRow) {
    fail("Insert firm", firmErr?.message);
    await cleanupUsers(admin, [accountantId], [], []);
    return;
  }
  firmId = firmRow.id;
  await admin.from("firm_memberships").insert({ firm_id: firmId, user_id: accountantId, role: "owner" });
  await admin.from("user_roles").insert({ user_id: accountantId, role: "firm_admin" });
  pass(`Firm created: ${firmId}`);

  const { data: clientRow, error: clientErr } = await admin
    .from("clients")
    .insert({
      name: "Biz Co",
      owner_user_id: accountantId,
      firm_id: firmId,
      business_type: "service",
    })
    .select("id")
    .single();
  if (clientErr || !clientRow) {
    fail("Insert firm client", clientErr?.message);
    await cleanupUsers(admin, [accountantId], [], [firmId]);
    return;
  }
  clientId = clientRow.id;
  pass(`Client created with accountant as placeholder owner: ${clientId}`);

  section("A2 · Invite business owner via signUpInvitedMember()");
  try {
    const result = await signUpInvitedMember({
      email: ownerEmail,
      password,
      fullName: "Biz Owner",
      inviteClientId: clientId,
    });
    inviteeId = result.userId;
    result.transferredOwnership
      ? pass(`Ownership transferred to invitee ✓ (${inviteeId})`)
      : fail("Expected transferredOwnership=true for firm-created client");
  } catch (e) {
    fail("signUpInvitedMember() threw", (e as Error).message);
    await cleanupUsers(admin, [accountantId], [clientId], [firmId]);
    return;
  }

  section("A3 · Verify ownership + roles");
  const { data: after } = await admin
    .from("clients")
    .select("owner_user_id, firm_id")
    .eq("id", clientId)
    .maybeSingle();
  after?.owner_user_id === inviteeId
    ? pass("clients.owner_user_id = invitee ✓")
    : fail("owner_user_id not transferred", JSON.stringify(after));
  after?.firm_id === firmId
    ? pass("clients.firm_id preserved ✓")
    : fail("firm_id was cleared", JSON.stringify(after));

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", inviteeId)
    .maybeSingle();
  roleRow?.role === "client_owner"
    ? pass(`user_roles.role = client_owner ✓`)
    : fail("invitee role is not client_owner", JSON.stringify(roleRow));

  const { data: memRow } = await admin
    .from("client_memberships")
    .select("role")
    .eq("user_id", inviteeId)
    .eq("client_id", clientId)
    .maybeSingle();
  memRow?.role === "client_owner"
    ? pass(`client_memberships.role = client_owner ✓`)
    : fail("membership role is not client_owner", JSON.stringify(memRow));

  section("A4 · Invitee can UPDATE; accountant (firm) can still UPDATE");
  const inviteeClient = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInErr } = await inviteeClient.auth.signInWithPassword({
    email: ownerEmail,
    password,
  });
  if (signInErr) {
    fail("Invitee sign-in", signInErr.message);
    await cleanupUsers(admin, [inviteeId, accountantId], [clientId], [firmId]);
    return;
  }
  pass("Invitee signed in");

  const { error: ownerPatchErr } = await inviteeClient
    .from("clients")
    .update({ business_type: "retail" })
    .eq("id", clientId);
  const { data: afterOwnerPatch } = await admin
    .from("clients")
    .select("business_type")
    .eq("id", clientId)
    .maybeSingle();
  afterOwnerPatch?.business_type === "retail"
    ? pass(`Invitee UPDATE succeeded (business_type=retail)${ownerPatchErr ? ` warn: ${ownerPatchErr.message}` : ""} ✓`)
    : fail("Invitee could not UPDATE as new owner", JSON.stringify(afterOwnerPatch));

  const acctClient = createClient(SUPABASE_URL, ANON_KEY);
  const { error: acctSignErr } = await acctClient.auth.signInWithPassword({
    email: accountantEmail,
    password,
  });
  if (acctSignErr) {
    fail("Accountant sign-in", acctSignErr.message);
  } else {
    const { error: firmPatchErr } = await acctClient
      .from("clients")
      .update({ cash_runway_weeks: 9 })
      .eq("id", clientId);
    const { data: afterFirmPatch } = await admin
      .from("clients")
      .select("cash_runway_weeks")
      .eq("id", clientId)
      .maybeSingle();
    afterFirmPatch?.cash_runway_weeks === 9
      ? pass(`Firm accountant still UPDATE via is_client_writer ✓${firmPatchErr ? ` warn: ${firmPatchErr.message}` : ""}`)
      : fail("Firm lost write access after handoff", JSON.stringify(afterFirmPatch));
  }

  section("A · Cleanup");
  await cleanupUsers(admin, [inviteeId, accountantId], [clientId], [firmId]);
  pass("Firm handoff fixtures cleaned up");
}

/** B) True owner inviting staff — no ownership transfer. */
async function testStaffInviteNoHandoff(admin: SupabaseClient) {
  const ts = Date.now() + 1;
  const ownerEmail = `owner-${ts}@example.com`;
  const memberEmail = `member-${ts}@example.com`;
  const password = "Test1234!";
  let ownerUserId = "";
  let memberUserId = "";
  let clientId = "";

  section("B1 · True client_owner creates client (no firm)");
  const { data: ownerU, error: ownerErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Test Owner", business_name: "Test Co", signup_type: "customer" },
  });
  if (ownerErr || !ownerU.user) {
    fail("Create owner user", ownerErr?.message);
    return;
  }
  ownerUserId = ownerU.user.id;
  pass(`Owner created: ${ownerEmail}`);

  const { data: clientRow, error: clientErr } = await admin
    .from("clients")
    .insert({ name: "Test Co", owner_user_id: ownerUserId, business_type: "service" })
    .select("id")
    .single();
  if (clientErr || !clientRow) {
    fail("Insert client row", clientErr?.message);
    await cleanupUsers(admin, [ownerUserId], [], []);
    return;
  }
  clientId = clientRow.id;
  await admin.from("user_roles").insert({ user_id: ownerUserId, role: "client_owner" });
  pass(`Client created (no firm): ${clientId}`);

  section("B2 · Invite staff via signUpInvitedMember()");
  try {
    const result = await signUpInvitedMember({
      email: memberEmail,
      password,
      fullName: "Test Member",
      inviteClientId: clientId,
    });
    memberUserId = result.userId;
    !result.transferredOwnership
      ? pass(`No ownership transfer for staff invite ✓ (${memberUserId})`)
      : fail("Staff invite incorrectly transferred ownership");
  } catch (e) {
    fail("signUpInvitedMember() threw", (e as Error).message);
    await cleanupUsers(admin, [ownerUserId], [clientId], []);
    return;
  }

  section("B3 · Verify staff roles + ownership unchanged");
  const { data: after } = await admin
    .from("clients")
    .select("owner_user_id")
    .eq("id", clientId)
    .maybeSingle();
  after?.owner_user_id === ownerUserId
    ? pass("clients.owner_user_id still original owner ✓")
    : fail("Ownership was stolen from true owner", JSON.stringify(after));

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", memberUserId)
    .maybeSingle();
  roleRow?.role === "client_member"
    ? pass(`user_roles.role = client_member ✓`)
    : fail("staff role is not client_member", JSON.stringify(roleRow));

  section("B4 · Staff can SELECT, cannot UPDATE");
  const memberClient = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInErr } = await memberClient.auth.signInWithPassword({
    email: memberEmail,
    password,
  });
  if (signInErr) {
    fail("Member sign-in", signInErr.message);
    await cleanupUsers(admin, [memberUserId, ownerUserId], [clientId], []);
    return;
  }
  pass("Member signed in");

  const { data: clientMeta, error: selectErr } = await memberClient
    .from("clients")
    .select("business_type")
    .eq("id", clientId)
    .maybeSingle();
  !selectErr && clientMeta?.business_type === "service"
    ? pass(`Member SELECT ok ✓`)
    : fail("Member cannot SELECT", selectErr?.message ?? JSON.stringify(clientMeta));

  await memberClient.from("clients").update({ business_type: "retail" }).eq("id", clientId);
  const { data: afterPatch } = await admin
    .from("clients")
    .select("business_type")
    .eq("id", clientId)
    .maybeSingle();
  afterPatch?.business_type === "service"
    ? pass("RLS blocked staff UPDATE ✓")
    : fail("Staff was able to UPDATE", JSON.stringify(afterPatch));

  section("B · Cleanup");
  await cleanupUsers(admin, [memberUserId, ownerUserId], [clientId], []);
  pass("Staff invite fixtures cleaned up");
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Invite flows: ownership handoff (G25) + staff member        ");
  console.log("══════════════════════════════════════════════════════════════");

  testInviteUrlParsing();
  testFirstRunGateLogic();

  let serviceRoleKey: string;
  try {
    serviceRoleKey = await getServiceRoleKey();
  } catch (e) {
    fail("Fetch service-role key", (e as Error).message);
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await testFirmOwnershipHandoff(admin);
  await testStaffInviteNoHandoff(admin);

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
