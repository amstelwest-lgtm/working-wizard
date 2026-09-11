/**
 * Live RLS test for per-upload visibility (Share with accountant / Keep private).
 *
 * Sets up an owner, a linked accountant (firm owner of the client's firm) and
 * an unrelated user, then checks through the anon-key client (real JWTs):
 *   1. Owner archives a private and a shared upload (row first, then object).
 *   2. Owner lists, downloads and relabels every own upload.
 *   3. Accountant lists / downloads the shared upload only.
 *   4. Accountant cannot read, download, relabel or delete the private one,
 *      cannot create a private row, and cannot write an object without a row.
 *   5. Unrelated user sees nothing.
 *
 * Needs: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY with
 * supabase/migrations/20260911120000_upload_visibility.sql applied.
 * Run: pnpm test:upload-visibility-rls
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CLIENT_DOCUMENTS_BUCKET, clientDocumentPath } from "../src/lib/client-documents";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;
const pass = (l: string) => {
  console.log(`  ✅ ${l}`);
  passed++;
};
const fail = (l: string, d?: string) => {
  console.error(`  ❌ ${l}${d ? `\n     → ${d}` : ""}`);
  failed++;
};
const section = (t: string) => console.log(`\n── ${t} ──`);

const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], {
  type: "application/pdf",
});

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

async function createUser(label: string, meta: Record<string, string>) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = "Test1234!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: meta,
  });
  if (error || !data.user) throw new Error(`create ${label}: ${error?.message}`);
  return { id: data.user.id, email, password };
}

/** Archive exactly like client-documents-browser.ts: row first, then object. */
async function archiveAs(
  client: SupabaseClient,
  userId: string,
  clientId: string,
  visibility: "private" | "shared",
  fileName: string,
) {
  const id = crypto.randomUUID();
  const path = clientDocumentPath(clientId, id, "pdf");
  const { error: rowErr } = await client.from("client_artifacts").insert({
    id,
    client_id: clientId,
    kind: "upload",
    storage_path: path,
    visibility,
    meta: { file_name: fileName, bytes: PDF.size, mime: "application/pdf", source: "bank_pack" },
    created_by: userId,
  });
  if (rowErr) return { id, path, error: `row: ${rowErr.message}` };
  const { error: objErr } = await client.storage
    .from(CLIENT_DOCUMENTS_BUCKET)
    .upload(path, PDF, { contentType: "application/pdf" });
  return { id, path, error: objErr ? `object: ${objErr.message}` : null };
}

async function listUploads(client: SupabaseClient, clientId: string) {
  const { data, error } = await client
    .from("client_artifacts")
    .select("id, visibility, storage_path")
    .eq("client_id", clientId)
    .eq("kind", "upload");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function canDownload(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(CLIENT_DOCUMENTS_BUCKET).download(path);
  return !error && !!data && data.size > 0;
}

async function canSign(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage
    .from(CLIENT_DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60);
  return !error && !!data?.signedUrl;
}

async function main() {
  const owner = await createUser("uv-owner", { full_name: "Owner", signup_type: "customer" });
  const acct = await createUser("uv-acct", { full_name: "Accountant", signup_type: "accountant" });
  const other = await createUser("uv-other", { full_name: "Stranger", signup_type: "customer" });

  const { data: firm, error: firmErr } = await admin
    .from("firms")
    .insert({ name: `UV Firm ${Date.now()}`, owner_user_id: acct.id })
    .select("id")
    .single();
  if (firmErr || !firm) throw new Error(`firm: ${firmErr?.message}`);
  await admin.from("firm_memberships").insert({ firm_id: firm.id, user_id: acct.id, role: "owner" });
  await admin.from("user_roles").insert({ user_id: acct.id, role: "firm_admin" });
  await admin.from("user_roles").insert({ user_id: owner.id, role: "client_owner" });

  const { data: clientRow, error: clientErr } = await admin
    .from("clients")
    .insert({ name: "UV Biz", owner_user_id: owner.id, firm_id: firm.id })
    .select("id")
    .single();
  if (clientErr || !clientRow) throw new Error(`client: ${clientErr?.message}`);
  const clientId = clientRow.id as string;

  const ownerC = await signIn(owner.email, owner.password);
  const acctC = await signIn(acct.email, acct.password);
  const otherC = await signIn(other.email, other.password);

  const created: string[] = [];
  try {
    section("Pre-flight: accountant is linked (has_client_access)");
    const { data: acctSees } = await acctC.from("clients").select("id").eq("id", clientId);
    acctSees?.length === 1
      ? pass("accountant can read the client row → is a linked accountant")
      : fail("accountant cannot see the client — fixture is wrong, results below are meaningless");

    section("1 · Owner archives private + shared uploads");
    const priv = await archiveAs(ownerC, owner.id, clientId, "private", "private-bank.pdf");
    const shared = await archiveAs(ownerC, owner.id, clientId, "shared", "shared-bank.pdf");
    created.push(priv.path, shared.path);
    priv.error ? fail("owner archives a private upload", priv.error) : pass("owner archives a private upload");
    shared.error ? fail("owner archives a shared upload", shared.error) : pass("owner archives a shared upload");

    section("2 · Owner always has full access to own uploads");
    const ownerRows = await listUploads(ownerC, clientId);
    ownerRows.length === 2 ? pass("owner lists both uploads") : fail(`owner lists ${ownerRows.length} uploads, expected 2`);
    (await canDownload(ownerC, priv.path)) ? pass("owner downloads the private file") : fail("owner cannot download own private file");
    (await canDownload(ownerC, shared.path)) ? pass("owner downloads the shared file") : fail("owner cannot download own shared file");
    (await canSign(ownerC, priv.path)) ? pass("owner gets a signed URL for the private file") : fail("owner cannot sign own private file");

    section("3 · Accountant: shared only");
    const acctRows = await listUploads(acctC, clientId);
    acctRows.length === 1 && acctRows[0].id === shared.id
      ? pass("accountant lists exactly the shared upload")
      : fail(`accountant lists ${acctRows.length} uploads: ${JSON.stringify(acctRows)}`);
    (await canDownload(acctC, shared.path)) ? pass("accountant downloads the shared file") : fail("accountant cannot download the shared file");
    (await canSign(acctC, shared.path)) ? pass("accountant gets a signed URL for the shared file") : fail("accountant cannot sign the shared file");

    section("4 · Accountant fails closed on private");
    (await canDownload(acctC, priv.path)) ? fail("accountant DOWNLOADED the private file") : pass("accountant cannot download the private file");
    (await canSign(acctC, priv.path)) ? fail("accountant SIGNED the private file") : pass("accountant cannot sign a URL for the private file");
    {
      const { data } = await acctC.from("client_artifacts").select("id").eq("id", priv.id);
      data?.length ? fail("accountant READ the private row") : pass("accountant cannot read the private row");
    }
    {
      const { data: listed } = await acctC.storage.from(CLIENT_DOCUMENTS_BUCKET).list(clientId);
      const names = (listed ?? []).map((o) => o.name);
      names.includes(priv.path.split("/")[1])
        ? fail("accountant LISTED the private object", names.join(","))
        : pass("accountant's bucket listing omits the private object");
    }
    {
      const { data } = await acctC
        .from("client_artifacts")
        .update({ visibility: "shared" })
        .eq("id", priv.id)
        .select("id");
      const { data: check } = await admin.from("client_artifacts").select("visibility").eq("id", priv.id).single();
      !data?.length && check?.visibility === "private"
        ? pass("accountant cannot flip a private upload to shared")
        : fail("accountant FLIPPED the private upload", JSON.stringify({ data, check }));
    }
    {
      await acctC.from("client_artifacts").delete().eq("id", priv.id);
      const { data: still } = await admin.from("client_artifacts").select("id").eq("id", priv.id);
      still?.length ? pass("accountant cannot delete the private row") : fail("accountant DELETED the private row");
    }
    {
      const { error } = await acctC.storage.from(CLIENT_DOCUMENTS_BUCKET).remove([shared.path]);
      const { data: still } = await admin.storage.from(CLIENT_DOCUMENTS_BUCKET).download(shared.path);
      still && still.size > 0
        ? pass(`accountant cannot delete the shared object${error ? ` (${error.message})` : ""}`)
        : fail("accountant DELETED the shared object");
    }
    {
      const attempt = await archiveAs(acctC, acct.id, clientId, "private", "acct-private.pdf");
      created.push(attempt.path);
      attempt.error?.startsWith("row:")
        ? pass("accountant cannot create a private upload on the client")
        : fail("accountant CREATED a private upload", attempt.error ?? "ok");
    }
    {
      const attempt = await archiveAs(acctC, acct.id, clientId, "shared", "acct-shared.pdf");
      created.push(attempt.path);
      attempt.error ? fail("accountant can still archive a shared upload", attempt.error) : pass("accountant can still archive a shared upload");
      (await canDownload(ownerC, attempt.path)) ? pass("owner sees the accountant's shared upload") : fail("owner cannot see accountant's shared upload");
    }
    {
      const orphan = clientDocumentPath(clientId, crypto.randomUUID(), "pdf");
      created.push(orphan);
      const { error } = await acctC.storage.from(CLIENT_DOCUMENTS_BUCKET).upload(orphan, PDF, { contentType: "application/pdf" });
      error ? pass("no artifact row → object write refused") : fail("object written WITHOUT an artifact row");
      const { error: ownerErr } = await ownerC.storage.from(CLIENT_DOCUMENTS_BUCKET).upload(orphan, PDF, { contentType: "application/pdf" });
      ownerErr ? pass("owner too: no row, no object") : fail("owner wrote an object without a row");
    }

    section("5 · Unrelated user sees nothing");
    const otherRows = await listUploads(otherC, clientId);
    otherRows.length === 0 ? pass("stranger lists no uploads") : fail(`stranger lists ${otherRows.length} uploads`);
    (await canDownload(otherC, shared.path)) ? fail("stranger DOWNLOADED a shared file") : pass("stranger cannot download the shared file");

    section("6 · Owner relabels later");
    {
      const { error } = await ownerC.from("client_artifacts").update({ visibility: "shared" }).eq("id", priv.id);
      error ? fail("owner flips private → shared", error.message) : pass("owner flips private → shared");
      (await canDownload(acctC, priv.path)) ? pass("accountant can now download it") : fail("accountant still blocked after owner shared it");
      await ownerC.from("client_artifacts").update({ visibility: "private" }).eq("id", priv.id);
      (await canDownload(acctC, priv.path)) ? fail("accountant still sees it after owner made it private again") : pass("owner flips back → accountant blocked again");
    }
  } finally {
    await admin.storage.from(CLIENT_DOCUMENTS_BUCKET).remove(created).then(() => undefined, () => undefined);
    await admin.from("client_artifacts").delete().eq("client_id", clientId);
    await admin.from("clients").delete().eq("id", clientId);
    await admin.from("firm_memberships").delete().eq("firm_id", firm.id);
    await admin.from("firms").delete().eq("id", firm.id);
    for (const u of [owner, acct, other]) {
      await admin.from("user_roles").delete().eq("user_id", u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
