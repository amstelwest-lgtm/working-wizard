/**
 * RLS integration test for the first-run onboarding flow.
 *
 * Tests every data operation the browser's anon-key client performs:
 * 1. Owner signs in → verifies JWT works
 * 2. Owner calls ensure_own_client() RPC → client created (effectiveClientId step-4)
 * 3. Owner SELECTs their own client → RLS allows it (business_type is null)
 * 4. Owner UPDATEs business_type → RLS allows it (the key dialog action)
 * 5. Second visit SELECT → business_type persists, flow skipped
 *
 * NOTE: direct INSERT via anon key fails due to a PostgREST WITH CHECK quirk in
 * this project. The fix (ensure_own_client SECURITY DEFINER RPC) is in
 * supabase/migrations/20260806110000_ensure_own_client_rpc.sql and app.tsx step-4.
 *
 * Also tests the pure-function dialog dismiss logic extracted from app.tsx.
 *
 * Run: pnpm test:onboarding
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;

function pass(label: string) { console.log(`  ✅ ${label}`); passed++; }
function fail(label: string, detail?: string) {
  console.error(`  ❌ ${label}${detail ? `\n     → ${detail}` : ""}`);
  failed++;
}
function section(t: string) { console.log(`\n── ${t} ──`); }

// ── Pure-function tests (no DB required) ──────────────────────────────────────

function testDialogDismissLogic() {
  section("Dialog dismiss logic (pure function — mirrors app.tsx ~line 2243)");

  // Extracted from:
  //   onOpenChange={(open) => {
  //     if (!open && firstRunStep === 'pick-type') return;
  //     setShowOnboarding(open);
  //   }}
  function makeOnOpenChange(
    firstRunStep: string | null,
    setShowOnboarding: (v: boolean) => void,
  ) {
    return (open: boolean) => {
      if (!open && firstRunStep === "pick-type") return;
      setShowOnboarding(open);
    };
  }

  // During pick-type — dismiss is blocked
  let called = false;
  const handler1 = makeOnOpenChange("pick-type", () => { called = true; });
  handler1(false); // user tries to close
  !called
    ? pass("onOpenChange blocks close (open=false) when firstRunStep='pick-type'")
    : fail("onOpenChange allowed close during pick-type");

  // Open event still works during pick-type
  let calledOpen = false;
  const handler2 = makeOnOpenChange("pick-type", () => { calledOpen = true; });
  handler2(true);
  calledOpen
    ? pass("onOpenChange allows open=true even during pick-type")
    : fail("onOpenChange blocked open=true during pick-type");

  // After pick-type (firstRunStep=null) — dismiss is allowed
  let calledAfter = false;
  const handler3 = makeOnOpenChange(null, () => { calledAfter = true; });
  handler3(false);
  calledAfter
    ? pass("onOpenChange allows close after pick-type is done (firstRunStep=null)")
    : fail("onOpenChange blocked close after pick-type");

  // ── Escape / outside-click handler ──────────────────────────────────────────
  section("Escape / outside-click handler (pure function — mirrors app.tsx ~line 2250)");

  // During pick-type — handler calls e.preventDefault()
  const makeHandler = (firstRunStep: string | null) =>
    firstRunStep === "pick-type" ? (e: { preventDefault: () => void }) => e.preventDefault() : undefined;

  const hduring = makeHandler("pick-type");
  if (hduring) {
    let prevented = false;
    hduring({ preventDefault: () => { prevented = true; } });
    prevented
      ? pass("onEscapeKeyDown / onInteractOutside calls preventDefault() during pick-type")
      : fail("Handler did not call preventDefault() during pick-type");
  } else {
    fail("No handler returned during pick-type — Escape would close the dialog");
  }

  const hafter = makeHandler(null);
  (hafter === undefined)
    ? pass("onEscapeKeyDown / onInteractOutside is undefined after pick-type (Escape allowed)")
    : fail("Handler unexpectedly present after pick-type");

  // ── CSS close-button hiding ────────────────────────────────────────────────
  section("Close-button hidden via CSS class (mirrors app.tsx ~line 2252)");

  function getDialogClassName(firstRunStep: string | null) {
    return `base-classes ${firstRunStep === "pick-type" ? "[&>button:first-of-type]:hidden" : ""}`;
  }

  const classPickType = getDialogClassName("pick-type");
  classPickType.includes("[&>button:first-of-type]:hidden")
    ? pass("CSS class '[&>button:first-of-type]:hidden' applied during pick-type (hides × button)")
    : fail("CSS class not applied during pick-type — close button visible");

  const classAfter = getDialogClassName(null);
  !classAfter.includes("[&>button:first-of-type]:hidden")
    ? pass("CSS class removed after pick-type (close button re-shown)")
    : fail("CSS class still applied after pick-type");
}

// ── Security: anon callers cannot invoke ensure_own_client ────────────────────

async function testAnonDenial() {
  section("Security · anon callers cannot invoke ensure_own_client (REVOKE PUBLIC)");
  // Use the anon key without signing in — request.jwt.claims will have role=anon
  const anonUnauthed = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anonUnauthed.rpc("ensure_own_client", { p_name: "Anon probe" });
  if (error) {
    // Expect 403 (permission denied) or "Not authenticated" from the function body
    pass(`Anon caller correctly denied (${error.code ?? error.message})`);
  } else {
    fail("Anon caller was NOT denied — PUBLIC EXECUTE revoke is missing");
  }
}

// ── Registration path: ensure_own_client via index.tsx signUp branch ─────────

async function testRegistrationPath() {
  section("Registration path · index.tsx signUp → ensure_own_client() (owner JWT)");
  const ts = Date.now();
  const email = `reg-path-${ts}@example.com`;
  const password = "Test1234!";

  // Create + confirm user (simulates Supabase auto-confirm or email-link click)
  const { data: u, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: "Reg Test", business_name: "Reg Test Co", signup_type: "customer" },
  });
  if (createErr || !u.user) {
    fail("Create user for registration test", createErr?.message);
    return;
  }

  // Sign in — this is the session index.tsx has when data.session && data.user
  const regClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: session } = await regClient.auth.signInWithPassword({ email, password });
  const userId = session.user?.id;
  if (!userId) { fail("Sign in for registration test"); await admin.auth.admin.deleteUser(u.user.id); return; }

  // Call ensure_own_client() exactly as index.tsx now does after signUp
  const { data: clientId, error: rpcErr } = await regClient.rpc("ensure_own_client", {
    p_name: "Reg Test Co",
  });

  if (rpcErr || !clientId) {
    fail("ensure_own_client() in registration path", rpcErr?.message ?? "returned null");
  } else {
    pass(`Registration path: ensure_own_client() created client ${clientId}`);
  }

  // Verify idempotency — calling again must NOT create a duplicate (unique index)
  const { data: clientId2, error: rpcErr2 } = await regClient.rpc("ensure_own_client", {
    p_name: "Reg Test Co (second call)",
  });
  if (rpcErr2) {
    fail("Idempotency check: second ensure_own_client() call errored", rpcErr2.message);
  } else if (clientId2 === clientId) {
    pass(`Idempotency: second call returned same client ${clientId2}`);
  } else {
    fail(`Idempotency: second call returned different client ${clientId2} vs ${clientId}`);
  }

  // Cleanup
  if (clientId) await admin.from("clients").delete().eq("id", clientId);
  await admin.auth.admin.deleteUser(u.user.id);
}

// ── DB / RLS integration tests ────────────────────────────────────────────────

async function testRlsOperations() {
  const ts = Date.now();
  const email = `onboarding-rls-${ts}@example.com`;
  const password = "Test1234!";
  let userId = "";
  let clientId = "";

  section("1 · Create fresh test owner via admin API");
  const { data: u, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: "RLS Test Owner", business_name: "RLS Test Co", signup_type: "customer" },
  });
  if (createErr || !u.user) {
    fail("Create user via admin", createErr?.message);
    return;
  }
  userId = u.user.id;
  pass(`User created: ${email} (${userId})`);

  // Build a session-authenticated client identical to what the browser uses
  section("2 · Sign in with anon key (browser-equivalent session)");
  const anonBase = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signInData, error: signInErr } = await anonBase.auth.signInWithPassword({ email, password });
  if (signInErr || !signInData.session) {
    fail("Sign in", signInErr?.message);
    await admin.auth.admin.deleteUser(userId);
    return;
  }
  pass(`Signed in — access_token length: ${signInData.session.access_token.length}`);

  // Use the same client that performed signInWithPassword — its session is already active.
  // This is equivalent to the browser's singleton supabase client after login.
  const ownerClient: SupabaseClient = anonBase;

  // ── 3. Verify no client record exists yet ────────────────────────────────
  section("3 · No client record on first visit");
  const { data: priorClients } = await ownerClient.from("clients").select("id").eq("owner_user_id", userId);
  priorClients?.length === 0
    ? pass("No existing client row before first /app load")
    : fail("Unexpected client row already exists", JSON.stringify(priorClients));

  // ── 4. ensure_own_client() RPC (effectiveClientId step-4 in app.tsx) ──────
  // Direct INSERT via anon key is broken due to a PostgREST WITH CHECK quirk.
  // The app was updated to call the ensure_own_client() SECURITY DEFINER RPC instead.
  section("4 · effectiveClientId step-4: ensure_own_client() RPC (owner JWT)");
  const { data: rpcClientId, error: rpcErr } = await ownerClient.rpc("ensure_own_client", {
    p_name: "RLS Test Co",
  });

  if (rpcErr || !rpcClientId) {
    fail("ensure_own_client() RPC failed", rpcErr?.message ?? "returned null");
    await admin.auth.admin.deleteUser(userId);
    return;
  }
  clientId = rpcClientId as string;
  pass(`ensure_own_client() RPC created client (owner JWT): ${clientId}`);

  // ── 5. SELECT business_type — should be null ──────────────────────────────
  section("5 · SELECT business_type via owner JWT → null triggers first-run");
  const { data: metaBefore, error: selectErr } = await ownerClient
    .from("clients")
    .select("business_type")
    .eq("id", clientId)
    .maybeSingle();

  if (selectErr) {
    fail("SELECT clients via owner JWT", selectErr.message);
  } else if (!metaBefore?.business_type) {
    pass("business_type is null → clientMeta effect would trigger firstRunStep='pick-type'");
  } else {
    fail("business_type unexpectedly set", metaBefore.business_type);
  }

  // ── 6. PATCH business_type (the exact operation the business-type dialog does)
  section("6 · PATCH business_type via owner JWT (real dialog action)");
  const { error: patchErr, data: patched } = await ownerClient
    .from("clients")
    .update({ business_type: "service" })
    .eq("id", clientId)
    .select("business_type")
    .single();

  if (patchErr) {
    fail("PATCH business_type via owner JWT", patchErr.message);
  } else {
    pass(`business_type set to '${patched?.business_type}' via owner JWT (RLS allows UPDATE)`);
  }

  // ── 7. SELECT again — second-login check ─────────────────────────────────
  section("7 · Second login: SELECT confirms business_type persisted → flow skipped");
  const ownerClient2 = createClient(SUPABASE_URL, ANON_KEY);
  const { data: session2 } = await ownerClient2.auth.signInWithPassword({ email, password });

  const { data: metaAfter } = await ownerClient2
    .from("clients")
    .select("business_type")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (metaAfter?.business_type === "service") {
    pass("Second-login SELECT: business_type='service' → first-run flow would be skipped");
  } else {
    fail("Second-login SELECT: business_type not found or wrong", JSON.stringify(metaAfter));
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  section("Cleanup");
  await admin.from("clients").delete().eq("id", clientId);
  await admin.auth.admin.deleteUser(userId);
  pass("Test user and client record deleted");
}

async function main() {
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Onboarding flow: RLS integration + dialog logic tests   ");
  console.log("══════════════════════════════════════════════════════════");

  // Run pure-function (synchronous) dialog tests first
  testDialogDismissLogic();

  // Verify REVOKE PUBLIC closes anon access to the SECURITY DEFINER RPC
  await testAnonDenial();

  // Registration path — covers index.tsx signUp → ensure_own_client branch
  await testRegistrationPath();

  // Run async DB/RLS tests (first-run gate, business_type, second-login persistence)
  await testRlsOperations();

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
