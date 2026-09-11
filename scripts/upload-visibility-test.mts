/**
 * Per-upload visibility (Share with accountant / Keep private).
 * No database: exercises the pure helpers, the browser archive flow with a
 * fake Storage, and asserts the migration + UI wiring in source.
 * Run: pnpm test:upload-visibility
 * Live RLS behaviour: scripts/test-upload-visibility-rls.mts (needs Supabase env).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLIENT_DOCUMENTS_BUCKET,
  DEFAULT_UPLOAD_VISIBILITY,
  UPLOAD_VISIBILITIES,
  UPLOAD_VISIBILITY_COPY,
  clientDocumentPath,
  coerceUploadVisibility,
  documentContentType,
  documentExtension,
  formatBytes,
  parseDocumentMeta,
  uploadSourceLabel,
  uploadVisibilityLabel,
} from "../src/lib/client-documents";
import { archiveUploads, describeArchiveFailures, type ArchiveDeps } from "../src/lib/client-documents-browser";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (p: string) => readFileSync(resolve(p), "utf8");

const USER = "11111111-2222-4333-8444-555555555555";
const CLIENT = "cccccccc-2222-4333-8444-555555555555";
const ART = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// ── pure helpers ─────────────────────────────────────────────────────────────
assert(DEFAULT_UPLOAD_VISIBILITY === "private", "safe default is private — nothing is shared silently");
assert(UPLOAD_VISIBILITIES.length === 2, "exactly two choices");
assert(coerceUploadVisibility("shared") === "shared" && coerceUploadVisibility("nope") === "private", "coerce falls back to private");
assert(UPLOAD_VISIBILITY_COPY.shared.label === "Share with accountant", "shared label");
assert(UPLOAD_VISIBILITY_COPY.private.label === "Keep private", "private label");
assert(/accountant/i.test(UPLOAD_VISIBILITY_COPY.shared.help) && /Client Brain/.test(UPLOAD_VISIBILITY_COPY.shared.help), "shared help explains accountant + brain");
assert(/stays with you/.test(UPLOAD_VISIBILITY_COPY.private.help) && /not see/.test(UPLOAD_VISIBILITY_COPY.private.help), "private help explains it stays with the owner");
assert(uploadVisibilityLabel("shared") === "Shared with accountant" && uploadVisibilityLabel(undefined) === "Private", "badge labels");
assert(uploadSourceLabel("bank_pack") === "Bank statements" && uploadSourceLabel("x") === "Upload", "source labels");

assert(documentExtension({ name: "fnb-march.PDF", type: "application/pdf" }) === "pdf", "extension from name, lower-cased");
assert(documentExtension({ name: "export", type: "text/csv" }) === "csv", "extension from MIME when the name has none");
assert(documentExtension({ name: "weird.exe", type: "" }) === "bin", "unknown extension → bin");
assert(documentContentType({ name: "book.xlsx", type: "" }) === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content type from extension");
assert(clientDocumentPath(CLIENT, ART, "pdf") === `${CLIENT}/${ART}.pdf`, "path is {client}/{artifact}.{ext}");
assert(parseDocumentMeta({ file_name: "a.pdf", bytes: 12, source: "bank_pack", junk: 1 }).source === "bank_pack", "meta parses known fields");
assert(parseDocumentMeta(null).file_name === undefined && parseDocumentMeta("x").bytes === undefined, "meta tolerates garbage");
assert(formatBytes(2048) === "2 KB" && formatBytes(3 * 1024 * 1024) === "3.0 MB" && formatBytes(undefined) === "", "formatBytes");

// ── archive flow (fake deps) ─────────────────────────────────────────────────
function fakeDeps(opts: { userId?: string | null; insertError?: string; copyError?: string; uploadError?: string } = {}) {
  const log: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const deps: ArchiveDeps = {
    userId: async () => (opts.userId === undefined ? USER : opts.userId),
    insertArtifact: async (row) => {
      log.push(`insert:${row.storage_path}:${row.visibility}`);
      rows.push(row as unknown as Record<string, unknown>);
      return { error: opts.insertError ? { message: opts.insertError } : null };
    },
    deleteArtifact: async (id) => {
      log.push(`delete:${id}`);
    },
    copyStaged: async (from, to) => {
      log.push(`copy:${from}->${to}`);
      return { error: opts.copyError ? { message: opts.copyError } : null };
    },
    uploadFile: async (path, _file, contentType) => {
      log.push(`upload:${path}:${contentType}`);
      return { error: opts.uploadError ? { message: opts.uploadError } : null };
    },
    newId: () => ART,
  };
  return { deps, log, rows };
}
const pdf = new File([new Uint8Array(10)], "statement.pdf", { type: "application/pdf" });
const csv = new File([new Uint8Array(5)], "export.csv", { type: "text/csv" });
const stagedPath = `${USER}/${ART}.pdf`;

{
  const f = fakeDeps();
  const r = await archiveUploads(
    { clientId: CLIENT, visibility: "private", source: "bank_pack", items: [{ file: pdf, storagePath: stagedPath, accountLabel: " Cheque " }] },
    f.deps,
  );
  assert(r.archived.length === 1 && r.failed.length === 0, "staged PDF archived");
  assert(f.log[0] === `insert:${CLIENT}/${ART}.pdf:private`, "row (with visibility) is written BEFORE the object");
  assert(f.log[1] === `copy:${stagedPath}->${CLIENT}/${ART}.pdf`, "staged PDF is copied, not re-uploaded");
  const meta = f.rows[0].meta as Record<string, unknown>;
  assert(meta.file_name === "statement.pdf" && meta.account_label === "Cheque" && meta.source === "bank_pack" && meta.mime === "application/pdf", "meta captured");
  assert(f.rows[0].created_by === USER && f.rows[0].kind === "upload", "row is the caller's upload artifact");
}
{
  const f = fakeDeps();
  const r = await archiveUploads({ clientId: CLIENT, visibility: "shared", source: "cash_pack", items: [{ file: csv }] }, f.deps);
  assert(r.archived.length === 1, "non-PDF archived");
  assert(f.log[0] === `insert:${CLIENT}/${ART}.csv:shared` && f.log[1] === `upload:${CLIENT}/${ART}.csv:text/csv`, "CSV uploaded directly with its content type");
}
{
  const f = fakeDeps({ copyError: "new row violates row-level security policy" });
  const r = await archiveUploads({ clientId: CLIENT, visibility: "private", source: "bank_pack", items: [{ file: pdf, storagePath: stagedPath }] }, f.deps);
  assert(r.failed.length === 1 && r.archived.length === 0, "object failure is reported, not thrown");
  assert(f.log.includes(`delete:${ART}`), "orphan row is removed when the object could not be written");
  const msg = describeArchiveFailures(r);
  assert(msg && /statement\.pdf/.test(msg) && /figures were still applied/.test(msg), "failure copy names the file and reassures about figures");
}
{
  const f = fakeDeps({ insertError: "permission denied" });
  const r = await archiveUploads({ clientId: CLIENT, visibility: "shared", source: "bank_pack", items: [{ file: pdf, storagePath: stagedPath }] }, f.deps);
  assert(r.failed.length === 1 && !f.log.some((l) => l.startsWith("copy:")), "no object is written when the row is refused");
}
{
  const f = fakeDeps({ userId: null });
  const r = await archiveUploads({ clientId: CLIENT, visibility: "shared", source: "bank_pack", items: [{ file: pdf }] }, f.deps);
  assert(r.failed.length === 1 && f.log.length === 0, "no session → nothing touched");
  assert(describeArchiveFailures({ archived: [], failed: [] }) === null, "no failures → no message");
}

// ── migration: enforcement lives in RLS, not the UI ──────────────────────────
const mig = read("supabase/migrations/20260911120000_upload_visibility.sql");
assert(/ADD COLUMN IF NOT EXISTS visibility text/.test(mig), "adds visibility column");
assert(/SET DEFAULT 'private'/.test(mig), "DB default is private");
assert(/CHECK \(visibility IN \('private', 'shared'\)\)/.test(mig), "visibility is constrained");
assert(/FUNCTION public\.is_client_owner_side/.test(mig), "owner-side helper (owner + client members)");
assert(!/has_active_practice_assignment|is_firm_manager/.test(mig.slice(mig.indexOf("is_client_owner_side"), mig.indexOf("can_view_client_artifact"))), "owner side excludes practice / firm access");
assert(/FUNCTION public\.can_view_client_artifact/.test(mig) && /_visibility = 'shared'\s+AND public\.has_client_access/.test(mig), "non-owners see shared only");
for (const op of ["SELECT", "UPDATE", "DELETE"]) {
  assert(new RegExp(`FOR ${op} TO authenticated\\s+USING \\(public\\.can_view_client_artifact\\(auth\\.uid\\(\\), client_id, visibility\\)\\)`).test(mig), `client_artifacts ${op} gated on visibility`);
}
assert(/FOR INSERT TO authenticated\s+WITH CHECK \(\s+\(created_by IS NULL OR created_by = auth\.uid\(\)\)\s+AND public\.can_view_client_artifact/.test(mig), "insert gated on visibility (accountant cannot create private rows)");
assert(new RegExp(`'${CLIENT_DOCUMENTS_BUCKET}',\\s*'${CLIENT_DOCUMENTS_BUCKET}',\\s*false`).test(mig), "client-documents bucket is private");
assert(/bucket_id = 'client-documents'\s+AND public\.can_read_client_document\(auth\.uid\(\), name\)/.test(mig), "object read goes through the artifact row");
assert(/bucket_id = 'client-documents'\s+AND public\.can_write_client_document\(auth\.uid\(\), name\)/.test(mig), "object insert requires the caller's own artifact row first");
assert(/a\.created_by = _user_id/.test(mig), "write helper checks created_by");
assert(/FOR DELETE\s+TO authenticated\s+USING \(\s+bucket_id = 'client-documents'\s+AND EXISTS \(\s+SELECT 1 FROM public\.client_artifacts a\s+WHERE a\.storage_path = storage\.objects\.name\s+AND public\.is_client_owner_side/.test(mig), "object delete is owner side only");
assert(/REVOKE ALL ON FUNCTION public\.can_read_client_document/.test(mig) && /REVOKE ALL ON FUNCTION public\.is_client_owner_side/.test(mig), "helpers are not callable by anon");
const types = read("src/integrations/supabase/types.ts");
assert(/client_artifacts: \{[\s\S]*?visibility: string[\s\S]*?visibility\?: string[\s\S]*?visibility\?: string/.test(types), "types carry visibility on Row/Insert/Update");

// ── UI: the choice is explicit on every owner upload path ───────────────────
const choice = read("src/components/upload-visibility-choice.tsx");
assert(/type="radio"/.test(choice) && /UPLOAD_VISIBILITIES\.map/.test(choice), "choice renders one radio per visibility");
assert(/data-upload-visibility=\{value\}/.test(choice), "choice exposes the current value for tests");

const bank = read("src/components/bank-statement-drafter.tsx");
assert(/<UploadVisibilityChoice/.test(bank) && /documents && \(/.test(bank), "bank drafter shows the choice (owner side)");
assert(bank.indexOf("<UploadVisibilityChoice") < bank.indexOf("onClick={runDraft}"), "bank drafter: choice sits before the Draft button");
assert(/archiveUploads\(\{\s*clientId: documents\.clientId,\s*visibility,\s*source: "bank_pack"/.test(bank), "bank drafter archives with the chosen visibility");
assert((bank.match(/retainStaged: true/g) ?? []).length === 2 && bank.indexOf("archiveUploads({") < bank.indexOf("await unstage(transportPaths(payloadFiles))"), "bank drafter archives while the staged pack is still retained");

const cash = read("src/components/cash-from-banks-drafter.tsx");
assert(/<UploadVisibilityChoice/.test(cash) && cash.indexOf("<UploadVisibilityChoice") < cash.indexOf("onClick={runDraft}"), "cash drafter shows the choice before drafting");
assert(/retainStaged: true/.test(cash) && /source: "cash_pack"/.test(cash), "cash drafter retains the pack and archives it");

const app = read("src/routes/app.tsx");
assert(/useState<UploadVisibility>\(DEFAULT_UPLOAD_VISIBILITY\)/.test(app), "owner app starts from the private default");
assert(/<UploadVisibilityChoice[\s\S]*?name="financial-data-visibility"/.test(app), "Financial Data dialog shows the choice");
assert(/<OwnerUploadsPanel clientId=\{effectiveClientId\}/.test(app), "owner sees which uploads are shared vs private");
assert((app.match(/defaultVisibility: uploadVisibility,\s*onVisibilityChange: setUploadVisibility/g) ?? []).length === 2, "both owner drafters get the documents target");
assert(/retainStaged: true,\s*\},\s*\}\)\) as MergedExtractionResult;\s*await archiveStatementUpload\(file, staged\.storagePath\)/.test(app), "statement PDF upload archives after extraction, before unstage");
assert(/source: "financial_statement"/.test(app), "statement uploads are labelled as such");

const extract = read("src/lib/extract-financials.functions.ts");
assert(/retainStaged: z\.boolean\(\)\.optional\(\)/.test(extract) && /retain: data\.retainStaged/.test(extract), "extractPDFsWithAI honours retainStaged");

const accountantRoute = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(!/documents=\{/.test(accountantRoute), "accountant drafter keeps its previous behaviour (no owner archive)");

const panel = read("src/components/owner-uploads-panel.tsx");
assert(/Make private/.test(panel) && /Share with accountant/.test(panel), "owner can flip visibility later");
assert(/setClientDocumentVisibility/.test(panel) && /clientDocumentDownloadUrl/.test(panel), "owner panel relabels and downloads through the browser lib");

const brain = read("src/components/client-brain-summary.tsx");
assert(/<SharedDocumentsList docs=\{sharedDocs\}/.test(brain) && /a\.kind === "upload" && a\.storage_path/.test(brain), "Client Brain lists shared uploads (RLS-filtered)");
const shared = read("src/components/shared-documents-list.tsx");
assert(/keep private do not/.test(shared), "accountant copy explains private files never appear");

// ── tests are registered ─────────────────────────────────────────────────────
const pkg = JSON.parse(read("package.json"));
assert(pkg.scripts["test:upload-visibility"], "unit test is registered");
assert(pkg.scripts["test:upload-visibility-rls"], "RLS test is registered");
const ci = read("scripts/run-ci-tests.mjs");
assert(/"test:upload-visibility-rls"/.test(ci), "RLS test is excluded from the no-DB CI runner");

console.log("upload-visibility-test: ok");
