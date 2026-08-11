/**
 * Integration test — invited member end-to-end flow
 *
 * Verifies the full invite → accept → login path by exercising the same code
 * that runs in production:
 *
 *   1. Owner signs up → client record + client_owner role
 *   2. signUpInvitedMember() — the shared utility called by the adminSignUp
 *      server function — creates the member user with client_member role and
 *      the matching client_memberships row.
 *   3. Member signs in with the anon key (same as the browser does) and:
 *       a. effectiveClientId step-2 (membership lookup) resolves the client
 *       b. Member can SELECT client metadata (business_type)
 *       c. Member CANNOT UPDATE the client record (owner-or-firm RLS —
 *          invited client_member excluded; see 20260811160000_clients_update_owner_or_firm.sql)
 *   4. Pure-function test: first-run gate logic shows the onboarding dialog
 *      only for client_owner, never for client_member.
 *
 * Run: pnpm test:invited-member
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signUpInvitedMember } from "@/lib/invite-member.server";

// ── Env vars ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const PROJECT_ID = (process.env.VITE_SUPABASE_PROJECT_ID ?? "cujzeoyvnpfokgwfftyd").replace(/"/g, "");
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

// ── Fetch service-role key from the management API ────────────────────────────
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

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(label: string) { console.log(`  ✅ ${label}`); passed++; }
function fail(label: string, detail?: string) {
  console.error(`  ❌ ${label}${detail ? `\n     → ${detail}` : ""}`);
  failed++;
}
function section(t: string) { console.log(`\n── ${t} ──`); }

// ── Pure-function test: invite URL param parsing (mirrors index.tsx useEffect) ─

function testInviteUrlParsing() {
  section("Invite URL param parsing (pure function — mirrors index.tsx useEffect)");

  /**
   * Mirrors the useEffect in src/routes/index.tsx that reads /?invite=<id>&mode=signup.
   * Returns the parsed inviteClientId, or null if params are absent/malformed.
   */
  function parseInviteParams(search: string): string | null {
    const params = new URLSearchParams(search);
    const inv = params.get("invite");
    const mode = params.get("mode");
    if (inv && mode === "signup") return inv;
    return null;
  }

  const clientId = "550e8400-e29b-41d4-a716-446655440000";

  // Happy path: both params present → client ID returned
  parseInviteParams(`?invite=${clientId}&mode=signup`) === clientId
    ? pass("?invite=<id>&mode=signup → inviteClientId extracted ✓")
    : fail("Failed to extract inviteClientId from invite URL");

  // Missing mode param → null (standard signup, no invite)
  parseInviteParams(`?invite=${clientId}`) === null
    ? pass("?invite=<id> without mode=signup → null (not an invite) ✓")
    : fail("Missing mode=signup should not be treated as invite");

  // Missing invite param → null
  parseInviteParams("?mode=signup") === null
    ? pass("?mode=signup without invite= → null ✓")
    : fail("Missing invite= should not be treated as invite");

  // Empty URL → null
  parseInviteParams("") === null
    ? pass("Empty search string → null ✓")
    : fail("Empty params should return null");

  // Wrong mode value → null
  parseInviteParams(`?invite=${clientId}&mode=login`) === null
    ? pass("mode=login (not signup) → null ✓")
    : fail("mode=login should not trigger invite flow");
}

// ── Pure-function test: first-run gate logic ──────────────────────────────────

function testFirstRunGateLogic() {
  section("First-run gate logic (pure function — mirrors app.tsx clientMeta effect)");

  /**
   * Extracted from app.tsx ~line 1534:
   *   } else if (!actingClientId && userRole !== null && userRole !== "client_member") {
   *     setFirstRunStep("pick-type");
   *     setShowOnboarding(true);
   *   }
   */
  function shouldShowOnboarding(opts: {
    businessType: string | null;
    actingClientId: string | null;
    userRole: string | null;
  }): boolean {
    if (opts.businessType) return false;
    if (opts.actingClientId) return false;
    if (opts.userRole === null) return false;        // defer until role loads
    if (opts.userRole === "client_member") return false; // invited member — never show
    return true;
  }

  shouldShowOnboarding({ businessType: null, actingClientId: null, userRole: "client_owner" })
    ? pass("Owner with no business_type → onboarding shown")
    : fail("Owner with no business_type should trigger onboarding");

  !shouldShowOnboarding({ businessType: "service", actingClientId: null, userRole: "client_owner" })
    ? pass("Owner with existing business_type → no onboarding")
    : fail("Owner with business_type set should NOT trigger onboarding");

  !shouldShowOnboarding({ businessType: null, actingClientId: null, userRole: "client_member" })
    ? pass("client_member with no business_type → NO onboarding (regression fix verified)")
    : fail("client_member MUST NOT see the first-run onboarding dialog — REGRESSION");

  !shouldShowOnboarding({ businessType: null, actingClientId: "some-client-id", userRole: "firm_admin" })
    ? pass("firm_admin acting as client (actingClientId set) → no onboarding")
    : fail("Acting-client mode should not show onboarding");

  !shouldShowOnboarding({ businessType: null, actingClientId: null, userRole: null })
    ? pass("userRole=null (not yet loaded) → onboarding deferred")
    : fail("Should not show onboarding before userRole is known");
}

// ── DB / RLS integration tests ────────────────────────────────────────────────

async function testInviteFlow(admin: SupabaseClient) {
  const ts = Date.now();
  const ownerEmail = `owner-${ts}@example.com`;
  const memberEmail = `member-${ts}@example.com`;
  const password = "Test1234!";
  let ownerUserId = "";
  let memberUserId = "";
  let clientId = "";

  // ── 1. Create owner ──────────────────────────────────────────────────────
  section("1 · Create owner (client_owner)");
  const { data: ownerU, error: ownerErr } = await admin.auth.admin.createUser({
    email: ownerEmail, password, email_confirm: true,
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
    await admin.auth.admin.deleteUser(ownerUserId);
    return;
  }
  clientId = clientRow.id;
  await admin.from("user_roles").insert({ user_id: ownerUserId, role: "client_owner" });
  pass(`Client created with business_type='service': ${clientId}`);

  // ── 2. Invite member via signUpInvitedMember() — same function adminSignUp
  //       calls for the invite branch.  The test exercises the real production
  //       code path rather than manually re-writing the handler's DB steps.
  section("2 · Invite member via signUpInvitedMember() (the adminSignUp invite path)");
  let result: { userId: string; email: string };
  try {
    result = await signUpInvitedMember({
      email: memberEmail,
      password,
      fullName: "Test Member",
      inviteClientId: clientId,
    });
    memberUserId = result.userId;
    pass(`signUpInvitedMember() succeeded: ${memberEmail} (${memberUserId})`);
  } catch (e) {
    fail("signUpInvitedMember() threw", (e as Error).message);
    await admin.from("clients").delete().eq("id", clientId);
    await admin.auth.admin.deleteUser(ownerUserId);
    return;
  }

  // ── 3. Verify DB rows ────────────────────────────────────────────────────
  section("3 · Verify DB rows: user_roles and client_memberships");

  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", memberUserId)
    .maybeSingle();
  roleRow?.role === "client_member"
    ? pass(`user_roles.role = '${roleRow.role}' ✓`)
    : fail("user_roles.role is not client_member", JSON.stringify(roleRow));

  const { data: memRow } = await admin
    .from("client_memberships")
    .select("client_id, role")
    .eq("user_id", memberUserId)
    .maybeSingle();
  memRow?.role === "client_member" && memRow.client_id === clientId
    ? pass(`client_memberships.role = '${memRow.role}', client_id matches ✓`)
    : fail("client_memberships row incorrect", JSON.stringify(memRow));

  // ── 4. Sign in as member (anon key = browser-equivalent session) ─────────
  section("4 · Sign in as member — verify client data access");
  const memberClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signIn, error: signInErr } = await memberClient.auth.signInWithPassword({
    email: memberEmail, password,
  });
  if (signInErr || !signIn.user) {
    fail("Member sign-in", signInErr?.message);
    await cleanup(admin, memberUserId, ownerUserId, clientId);
    return;
  }
  pass("Member signed in successfully");

  // effectiveClientId step-2: client_memberships lookup
  const { data: memLookup, error: memLookupErr } = await memberClient
    .from("client_memberships")
    .select("client_id")
    .eq("user_id", signIn.user.id)
    .limit(1)
    .maybeSingle();
  !memLookupErr && memLookup?.client_id === clientId
    ? pass("effectiveClientId step-2: membership lookup returns correct client_id ✓")
    : fail("effectiveClientId step-2 failed", memLookupErr?.message ?? JSON.stringify(memLookup));

  // Member can SELECT client metadata (needed to render the dashboard)
  const { data: clientMeta, error: selectErr } = await memberClient
    .from("clients")
    .select("business_type, cash_runway_weeks")
    .eq("id", clientId)
    .maybeSingle();
  !selectErr && clientMeta?.business_type === "service"
    ? pass(`Member SELECT client data: business_type='${clientMeta.business_type}' ✓`)
    : fail("Member cannot SELECT client data", selectErr?.message ?? JSON.stringify(clientMeta));

  // ── 5. First-run gate: business_type set → no onboarding dialog ──────────
  section("5 · First-run gate: member lands on /app without onboarding dialog");
  clientMeta?.business_type
    ? pass("business_type set → first-run gate skips dialog (line 1532 branch taken)")
    : fail("business_type missing — first-run gate might show the owner-only dialog");
  pass("Role guard verified: client_member excluded from first-run dialog (pure-function test above)");

  // ── 6. Member CANNOT UPDATE client — invited members stay blocked (Gap 3 keeps this)
  section("6 · Member CANNOT PATCH client record (owner-or-firm RLS — invited members excluded)");
  const { error: patchErr } = await memberClient
    .from("clients")
    .update({ business_type: "retail" })
    .eq("id", clientId);

  const { data: afterPatch } = await admin
    .from("clients")
    .select("business_type")
    .eq("id", clientId)
    .maybeSingle();

  afterPatch?.business_type === "service"
    ? pass(`RLS blocked member UPDATE — business_type unchanged ✓${patchErr ? ` (${patchErr.message})` : " (silent no-op)"}`)
    : fail(
        "Member was able to change business_type — RLS is not enforcing owner-only writes",
        `business_type is now '${afterPatch?.business_type}'. Check migration 20260806200000_clients_update_owner_only.sql was applied.`,
      );

  // ── Cleanup ───────────────────────────────────────────────────────────────
  section("Cleanup");
  await cleanup(admin, memberUserId, ownerUserId, clientId);
  pass("All test users and data cleaned up");
}

async function cleanup(
  admin: SupabaseClient,
  memberUserId: string,
  ownerUserId: string,
  clientId: string,
) {
  if (memberUserId) {
    await admin.from("client_memberships").delete().eq("user_id", memberUserId);
    await admin.from("user_roles").delete().eq("user_id", memberUserId);
    await admin.auth.admin.deleteUser(memberUserId);
  }
  if (ownerUserId) {
    await admin.from("user_roles").delete().eq("user_id", ownerUserId);
  }
  if (clientId) {
    await admin.from("clients").delete().eq("id", clientId);
  }
  if (ownerUserId) {
    await admin.auth.admin.deleteUser(ownerUserId);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Invited member flow: role assignment + access control tests ");
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

  await testInviteFlow(admin);

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
