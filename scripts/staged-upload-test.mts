/**
 * Staged uploads: large PDFs go browser → Storage → server, never through the
 * app server's request body (Vercel caps that at 4.5 MB).
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/staged-upload-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  INLINE_BASE64_MAX,
  INLINE_MAX_BYTES,
  STAGED_UPLOAD_BUCKET,
  assertOwnStagedPath,
  inlineAllowed,
  stagedObjectPath,
} from "../src/lib/staged-upload";
import { pdfTransport, stagePdf, unstage } from "../src/lib/staged-upload-browser";
import { readStagedPdf, resolvePdfBase64 } from "../src/lib/staged-upload.server";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function rejects(p: Promise<unknown>, re: RegExp, msg: string) {
  try {
    await p;
  } catch (e) {
    assert(re.test((e as Error).message), `${msg} — got: ${(e as Error).message}`);
    return;
  }
  throw new Error(`${msg} — did not throw`);
}

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const OBJ = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// ── limits ────────────────────────────────────────────────────────────────────
assert(INLINE_MAX_BYTES === 3 * 1024 * 1024, "inline cap is 3 MB");
assert(
  Math.ceil((INLINE_MAX_BYTES / 3) * 4) < INLINE_BASE64_MAX && INLINE_BASE64_MAX < 4.5 * 1024 * 1024,
  "base64 cap sits between 3 MB encoded and Vercel's 4.5 MB body limit",
);
assert(inlineAllowed(INLINE_MAX_BYTES) && !inlineAllowed(INLINE_MAX_BYTES + 1), "inlineAllowed boundary");

// ── paths ─────────────────────────────────────────────────────────────────────
const ownPath = stagedObjectPath(USER, OBJ);
assert(ownPath === `${USER}/${OBJ}.pdf`, "path is {user}/{uuid}.pdf");
assertOwnStagedPath(USER, ownPath);
assertOwnStagedPath(USER.toUpperCase(), ownPath);
for (const bad of [
  stagedObjectPath(OTHER, OBJ),
  `${USER}/../${OTHER}/${OBJ}.pdf`,
  `${USER}/${OBJ}.exe`,
  `${USER}/${OBJ}`,
  `${USER}/${OBJ}.pdf/extra`,
  "",
]) {
  let threw = false;
  try {
    assertOwnStagedPath(USER, bad);
  } catch {
    threw = true;
  }
  assert(threw, `rejects staged path "${bad}"`);
}

// ── client: stage, fall back, or refuse ──────────────────────────────────────
function fakeDeps(opts: { uploadError?: string; userId?: string | null } = {}) {
  const uploads: string[] = [];
  const removed: string[] = [];
  return {
    uploads,
    removed,
    deps: {
      userId: async () => (opts.userId === undefined ? USER : opts.userId),
      upload: async (path: string) => {
        uploads.push(path);
        return { error: opts.uploadError ? { message: opts.uploadError } : null };
      },
      remove: async (paths: string[]) => {
        removed.push(...paths);
      },
      newId: () => OBJ,
    },
  };
}
const smallPdf = new File([new Uint8Array(2048)], "small.pdf", { type: "application/pdf" });
const bigPdf = new File([new Uint8Array(INLINE_MAX_BYTES + 1)], "annual-financials.pdf", {
  type: "application/pdf",
});

{
  const f = fakeDeps();
  const t = await pdfTransport(bigPdf, f.deps);
  assert(t.storagePath === ownPath && !t.base64, "big PDF is staged, not inlined");
  assert(f.uploads[0] === ownPath, "uploaded to the user's own folder");
}
{
  const f = fakeDeps();
  const t = await pdfTransport(smallPdf, f.deps);
  assert(t.storagePath === ownPath, "small PDF is staged too when Storage is available");
}
{
  const f = fakeDeps({ uploadError: "Bucket not found" });
  const t = await pdfTransport(smallPdf, f.deps);
  assert(!t.storagePath && typeof t.base64 === "string" && t.base64.length > 0, "small PDF falls back to inline base64");
  assert(Buffer.from(t.base64!, "base64").length === 2048, "inline base64 round-trips the bytes");
}
{
  const f = fakeDeps({ uploadError: "Bucket not found" });
  await rejects(
    pdfTransport(bigPdf, f.deps),
    /annual-financials\.pdf.*3\.0 MB.*Bucket not found.*statement-uploads/s,
    "big PDF with no Storage gets a precise error naming the file, size, reason and bucket",
  );
}
await rejects(stagePdf(smallPdf, fakeDeps({ userId: null }).deps), /Sign in/, "no session → sign-in error");
{
  const f = fakeDeps();
  await unstage([ownPath, undefined, ""], f.deps);
  assert(f.removed.length === 1 && f.removed[0] === ownPath, "unstage removes only real paths");
  await unstage([], f.deps);
  assert(f.removed.length === 1, "unstage with nothing to do makes no call");
}

// ── server: read as the user, delete after, retain when asked ───────────────
function fakeStorage(bytes: Uint8Array | null, downloadError?: string) {
  const calls: string[] = [];
  const removed: string[] = [];
  const storage = {
    from(bucket: string) {
      calls.push(bucket);
      return {
        download: async (path: string) => {
          calls.push(`download:${path}`);
          return downloadError || !bytes
            ? { data: null, error: { message: downloadError ?? "Object not found" } }
            : { data: new Blob([bytes]), error: null };
        },
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return {};
        },
      };
    },
  };
  return { storage, calls, removed };
}
const payload = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
{
  const s = fakeStorage(payload);
  const got = await readStagedPdf(s.storage, USER, ownPath);
  assert(s.calls[0] === STAGED_UPLOAD_BUCKET, "reads from the statement-uploads bucket");
  assert(Buffer.from(got.base64, "base64").equals(Buffer.from(payload)), "returns the object as base64");
  assert(got.bytes === payload.length, "reports byte length");
  assert(s.removed.length === 1 && s.removed[0] === ownPath, "deletes the object after reading");
}
{
  const s = fakeStorage(payload);
  await readStagedPdf(s.storage, USER, ownPath, { retain: true });
  assert(s.removed.length === 0, "retain leaves the object for the second reader");
}
{
  const s = fakeStorage(null, "Object not found");
  await rejects(readStagedPdf(s.storage, USER, ownPath), /upload it again/, "missing object → re-upload message");
  assert(s.removed.length === 1, "still cleans up after a failed read");
}
{
  const s = fakeStorage(payload);
  await rejects(
    readStagedPdf(s.storage, USER, stagedObjectPath(OTHER, OBJ)),
    /could not be found/,
    "another user's path is refused before any Storage call",
  );
  assert(s.calls.length === 0, "no Storage call for a foreign path");
}
{
  const s = fakeStorage(payload);
  assert((await resolvePdfBase64(s.storage, USER, { base64: "QUJD" })) === "QUJD", "inline base64 passes through");
  assert(s.calls.length === 0, "inline base64 never touches Storage");
  await rejects(resolvePdfBase64(s.storage, USER, {}), /No file content/, "neither field → clear error");
}

// ── wiring: every PDF path to the server goes through staging ───────────────
const read = (p: string) => readFileSync(resolve(p), "utf8");
for (const [file, fn] of [
  ["src/lib/extractFinancials.server.ts", "extractFinancialsFromPDF"],
  ["src/lib/extract-financials.functions.ts", "extractPDFsWithAI"],
  ["src/lib/bankStatements.server.ts", "draftFinancialsFromBankStatements"],
  ["src/lib/cash-from-banks.server.ts", "draftCashForecastFromBankStatements"],
]) {
  const src = read(file);
  assert(src.includes("storagePath: z.string()"), `${fn} accepts a staged storagePath`);
  assert(src.includes("resolvePdfBase64(context.supabase.storage, context.userId"), `${fn} reads staged files as the caller`);
  assert(!/max\(45_000_000\)|max\(14_000_000\)/.test(src), `${fn} no longer advertises inline bodies Vercel cannot accept`);
  assert(src.includes("INLINE_BASE64_MAX"), `${fn} caps inline base64 under the body limit`);
}
for (const file of [
  "src/components/upload-financials.tsx",
  "src/components/pdf-upload-zone.tsx",
  "src/components/budget/budget-variance-panel.tsx",
  "src/components/cash-from-banks-drafter.tsx",
  "src/routes/app.tsx",
  "src/lib/bank-files.ts",
]) {
  const src = read(file);
  assert(src.includes("pdfTransport("), `${file} stages PDFs via pdfTransport`);
  assert(!src.includes("readAsDataURL"), `${file} no longer hand-rolls base64 for server payloads`);
}
const drafter = read("src/components/bank-statement-drafter.tsx");
assert(
  (drafter.match(/retainStaged: true/g) ?? []).length === 2,
  "bank drafter tells both parallel readers to leave the pack in place",
);
assert(drafter.includes("unstage(transportPaths(payloadFiles))"), "bank drafter cleans the pack up itself");
const migration = read("supabase/migrations/20260906120000_statement_uploads_bucket.sql");
assert(/'statement-uploads',\s*'statement-uploads',\s*false/.test(migration), "bucket is private");
assert(/33554432/.test(migration), "bucket allows 32 MB, matching the UI promise");
assert((migration.match(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g) ?? []).length === 3, "insert/select/delete are all scoped to the caller's folder");

console.log("staged-upload-test: ok");
