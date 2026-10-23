/**
 * Tax pack rules: no figure without a cited file, no computed tax, draft
 * reviewed by the accountant. Fixtures only — no database, no model call.
 * Run: pnpm test:tax-deliverable
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TAX_PACK_HEADER_NOTE,
  TAX_PACK_KIND,
  TAX_PACK_WORKSHEET_NOTE,
  formatRandsFromCents,
  missingItemQuery,
  parseTaxPackPayload,
  renderTaxPackBody,
  taxPackAlreadyOpen,
  taxPackAssumptions,
  taxPackDedupeTag,
  taxPackFileIntro,
  taxPackIsEmpty,
  taxPackSystemPrompt,
  unreadableFileQuery,
  withExtraQueries,
} from "../src/lib/tax-deliverable.ts";
import {
  TAX_PACK_PDF_DOCUMENT_MAX_BYTES,
  extractSendFileContent,
  pdfLooksEncrypted,
} from "../src/lib/tax-deliverable-extract.server.ts";
import {
  SAMPLE_TAX_PACK_CLIENT_NAME,
  SAMPLE_TAX_PACK_FILES,
  SAMPLE_TAX_PACK_REPLY,
  SAMPLE_TAX_PACK_SEND_ID,
  sampleTaxPackBody,
  sampleTaxPackChecks,
  sampleTaxPackDraft,
} from "../src/lib/tax-deliverable-fixture.ts";
import { draftKindLabel } from "../src/lib/client-brain-deliverable.ts";
import {
  TAX_PACK_PANEL_BODY,
  TaxPackCard,
  draftTaxPackNotice,
  taxPackStatusLabel,
} from "../src/components/tax-pack-panel.tsx";

let failures = 0;
const checks: Array<[string, () => void | Promise<void>]> = [];
function check(name: string, fn: () => void | Promise<void>) {
  checks.push([name, fn]);
}

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

// --- money ---
check("rand formatting is SARS-style with cents", () => {
  assert.equal(formatRandsFromCents(48_230_000), "R 482 300.00");
  assert.equal(formatRandsFromCents(2_894_455), "R 28 944.55");
  assert.equal(formatRandsFromCents(-12_345), "-R 123.45");
  assert.equal(formatRandsFromCents(5), "R 0.05");
});

// --- prompt rules ---
check("the prompt forbids invented figures and any SARS filing", () => {
  const prompt = taxPackSystemPrompt();
  assert.ok(prompt.includes("Never invent, estimate, or extrapolate"));
  assert.ok(prompt.includes("Every figure MUST carry the file_id"));
  assert.ok(prompt.includes("Never compute tax payable"));
  assert.ok(prompt.includes("Never mention logging into SARS or submitting"));
  assert.ok(prompt.includes("The accountant files via eFiling"));
  assert.ok(!prompt.toLowerCase().includes("whatsapp"));
});

check("the file intro names every file by id", () => {
  const intro = taxPackFileIntro(SAMPLE_TAX_PACK_FILES);
  for (const file of SAMPLE_TAX_PACK_FILES) {
    assert.ok(intro.includes(`FILE ${file.fileId}`));
  }
});

// --- parsing: untraceable figures are dropped, never kept ---
check("the fixture reply parses with every figure cited", () => {
  const draft = parseTaxPackPayload(SAMPLE_TAX_PACK_REPLY, SAMPLE_TAX_PACK_FILES);
  assert.ok(draft);
  assert.equal(draft.income.length, 1);
  assert.equal(draft.income[0].fileId, "file-income");
  assert.equal(draft.worksheet[0].confidence, "uncertain");
  assert.equal(draft.queries.length, 1);
  assert.ok(!taxPackIsEmpty(draft));
});

check("a figure citing an unknown file is dropped and becomes a query", () => {
  const reply = JSON.stringify({
    income: [
      { label: "Guessed turnover", amount_cents: 100, file_id: "not-a-file", confidence: "stated" },
      { label: "Real line", amount_cents: 200, file_id: "file-income", confidence: "stated" },
    ],
    queries: [],
  });
  const draft = parseTaxPackPayload(reply, SAMPLE_TAX_PACK_FILES);
  assert.ok(draft);
  assert.equal(draft.income.length, 1);
  assert.equal(draft.income[0].label, "Real line");
  assert.equal(draft.queries.length, 1);
  assert.ok(draft.queries[0].includes("Guessed turnover"));
  assert.ok(draft.queries[0].includes("could not be traced"));
});

check("a figure without an integer amount is dropped", () => {
  const reply = JSON.stringify({
    income: [
      { label: "Rounded", amount_cents: 10.5, file_id: "file-income", confidence: "stated" },
      { label: "Worded", amount_cents: "ten", file_id: "file-income", confidence: "stated" },
    ],
  });
  const draft = parseTaxPackPayload(reply, SAMPLE_TAX_PACK_FILES);
  assert.ok(draft);
  assert.equal(draft.income.length, 0);
  assert.equal(draft.queries.length, 2);
});

check("a fenced reply still parses; junk returns null", () => {
  const fenced = "```json\n" + SAMPLE_TAX_PACK_REPLY + "\n```";
  assert.ok(parseTaxPackPayload(fenced, SAMPLE_TAX_PACK_FILES));
  assert.equal(parseTaxPackPayload("no json here", SAMPLE_TAX_PACK_FILES), null);
});

check("unknown confidence is treated as uncertain, never as stated", () => {
  const reply = JSON.stringify({
    income: [{ label: "Line", amount_cents: 100, file_id: "file-income", confidence: "sure!" }],
  });
  const draft = parseTaxPackPayload(reply, SAMPLE_TAX_PACK_FILES);
  assert.equal(draft?.income[0]?.confidence, "uncertain");
});

// --- rendered body ---
check("the body cites a source on every figure and carries the dedupe tag", () => {
  const body = sampleTaxPackBody();
  assert.ok(body.startsWith(`DRAFT tax pack — ${SAMPLE_TAX_PACK_CLIENT_NAME}`));
  assert.ok(body.includes(TAX_PACK_HEADER_NOTE));
  assert.ok(body.includes("1. Practice income and expenses"));
  assert.ok(body.includes("2. Medical aid and retirement annuity deductions"));
  assert.ok(body.includes("3. ITR12 preparation worksheet"));
  assert.ok(body.includes("4. Missing items and queries"));
  assert.ok(body.includes("R 482 300.00"));
  assert.ok(body.includes("— source: sample-practice-income-2026.pdf"));
  assert.ok(body.includes("— source: sample-medical-aid-certificate.pdf"));
  assert.ok(body.includes("(check)"));
  assert.ok(body.includes(TAX_PACK_WORKSHEET_NOTE));
  assert.ok(body.includes(taxPackDedupeTag(SAMPLE_TAX_PACK_SEND_ID)));
  const amountLines = body.split("\n").filter((line) => line.includes("R ") && line.startsWith("- "));
  for (const line of amountLines) assert.ok(line.includes("— source: "), line);
});

check("the body never promises filing and never mentions WhatsApp", () => {
  const body = sampleTaxPackBody().toLowerCase();
  assert.ok(!body.includes("whatsapp"));
  assert.ok(!body.includes("we will submit"));
  assert.ok(body.includes("does not log into sars"));
});

// --- checks the accountant must tick ---
check("uncertain figures and queries become the accountant's checklist", () => {
  const checks = sampleTaxPackChecks();
  assert.ok(checks.length >= 3);
  assert.ok(checks.every((item) => !item.checked));
  assert.ok(checks.some((item) => item.text.includes("IRP5 code 3601")));
  assert.ok(checks.some((item) => item.text.includes("travel logbook")));
  assert.ok(checks.some((item) => item.text.includes("password-protected")));
  assert.ok(checks.length <= 12);
});

// --- queries for unreadable and missing documents ---
check("unreadable and missing documents become queries, never figures", () => {
  const file = SAMPLE_TAX_PACK_FILES[0];
  assert.ok(unreadableFileQuery(file, "password").includes("password-protected"));
  assert.ok(unreadableFileQuery(file, "format").includes("format"));
  assert.ok(missingItemQuery("Travel logbook", "no car this year").includes("no car this year"));
  const draft = sampleTaxPackDraft();
  const extended = withExtraQueries(draft, [draft.queries[0], "A new query."]);
  assert.equal(extended.queries.length, draft.queries.length + 1);
});

// --- one open pack per send ---
check("a second pack for the same send is refused while one is open", () => {
  const body = sampleTaxPackBody();
  const open = [{ kind: TAX_PACK_KIND, body, status: "draft" }];
  assert.equal(taxPackAlreadyOpen(open, SAMPLE_TAX_PACK_SEND_ID), true);
  assert.equal(taxPackAlreadyOpen(open, "99999999-2222-4333-8444-555555555555"), false);
  const closed = [{ kind: TAX_PACK_KIND, body, status: "discarded" }];
  assert.equal(taxPackAlreadyOpen(closed, SAMPLE_TAX_PACK_SEND_ID), false);
});

// --- extraction ---
check("images pass through, HEIC and oversized files are refused", async () => {
  const jpeg = await extractSendFileContent({
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/jpeg",
    password: null,
  });
  assert.equal(jpeg.kind, "image");
  const heic = await extractSendFileContent({
    bytes: new Uint8Array([1]),
    mime: "image/heic",
    password: null,
  });
  assert.deepEqual(heic, { kind: "unreadable", reason: "format" });
  const big = await extractSendFileContent({
    bytes: new Uint8Array(5 * 1024 * 1024 + 1),
    mime: "image/png",
    password: null,
  });
  assert.deepEqual(big, { kind: "unreadable", reason: "oversized" });
});

check("a small scanned PDF goes whole; the /Encrypt marker is noticed", async () => {
  const open = new TextEncoder().encode("%PDF-1.7 plain sample body");
  assert.equal(pdfLooksEncrypted(open), false);
  const result = await extractSendFileContent({
    bytes: open,
    mime: "application/pdf",
    password: null,
  });
  assert.equal(result.kind, "pdf");
  const sealed = new TextEncoder().encode("%PDF-1.7 … /Encrypt 12 0 R …");
  assert.equal(pdfLooksEncrypted(sealed), true);
});

check("a sealed PDF without a password is a password query, never a crash", async () => {
  const sealed = new TextEncoder().encode("%PDF-1.7 … /Encrypt 12 0 R …");
  const noPassword = await extractSendFileContent({
    bytes: sealed,
    mime: "application/pdf",
    password: null,
  });
  assert.deepEqual(noPassword, { kind: "unreadable", reason: "password" });
  const wrongPassword = await extractSendFileContent({
    bytes: sealed,
    mime: "application/pdf",
    password: "sample-password",
  });
  assert.equal(wrongPassword.kind, "unreadable");
});

check("an oversized open PDF with no text layer is left out, never shipped", async () => {
  const big = new Uint8Array(TAX_PACK_PDF_DOCUMENT_MAX_BYTES + 1);
  const head = new TextEncoder().encode("%PDF-1.7 big scan");
  big.set(head, 0);
  const result = await extractSendFileContent({
    bytes: big,
    mime: "application/pdf",
    password: null,
  });
  assert.deepEqual(result, { kind: "unreadable", reason: "oversized" });
  assert.ok(
    unreadableFileQuery(SAMPLE_TAX_PACK_FILES[0], "oversized").includes("too large"),
    "the oversized query names the problem",
  );
});

// --- the review panel the accountant sees ---
check("the panel shows the draft, its sources, and Approve/Discard", () => {
  const html = renderToStaticMarkup(
    createElement(TaxPackCard, {
      drafts: [
        { id: "draft-1", body: sampleTaxPackBody(), status: "draft", checks: sampleTaxPackChecks() },
      ],
      canDraft: true,
      busy: false,
      notice: null,
      onDraft: () => undefined,
      onApprove: () => undefined,
      onDiscard: () => undefined,
    }),
  );
  assert.ok(html.includes("Draft tax pack"));
  assert.ok(html.includes("data-approve-tax-pack"));
  assert.ok(html.includes("data-discard-tax-pack"));
  assert.ok(html.includes("— source: sample-practice-income-2026.pdf"));
  assert.ok(html.includes(TAX_PACK_PANEL_BODY));
  assert.ok(!html.toLowerCase().includes("whatsapp"));
});

check("an approved pack keeps Discard but loses Approve", () => {
  const html = renderToStaticMarkup(
    createElement(TaxPackCard, {
      drafts: [{ id: "d", body: "Short body [send:x]", status: "ready", checks: [] }],
      canDraft: false,
      busy: false,
      notice: null,
      onDraft: () => undefined,
      onApprove: () => undefined,
      onDiscard: () => undefined,
    }),
  );
  assert.ok(!html.includes("data-approve-tax-pack"));
  assert.ok(html.includes("data-discard-tax-pack"));
  assert.ok(html.includes("Approved"));
});

check("status and notice copy stay calm and specific", () => {
  assert.equal(taxPackStatusLabel("draft"), "Draft");
  assert.equal(taxPackStatusLabel("ready"), "Approved");
  assert.equal(draftTaxPackNotice({ ok: true }), null);
  assert.ok(draftTaxPackNotice({ ok: false, reason: "not_ready" })?.includes("finished the link"));
  assert.ok(draftTaxPackNotice({ ok: false, reason: "already_open" })?.includes("already open"));
});

check("every failure reason has its own words, not one generic error", () => {
  const generic = "The pack could not be drafted.";
  for (const reason of ["model", "timeout", "unavailable", "no_files", "empty"] as const) {
    const notice = draftTaxPackNotice({ ok: false, reason });
    assert.ok(notice && notice !== generic, `reason ${reason} is specific`);
  }
  const withNames = draftTaxPackNotice({
    ok: false,
    reason: "passwords_needed",
    passwordNeeded: ["Bankstate.pdf", "Certificate(s).pdf"],
  });
  assert.ok(withNames?.includes("Bankstate.pdf"), "the notice names the locked files");
  assert.ok(withNames?.includes("Certificate(s).pdf"));
  assert.ok(withNames?.includes("Save each password"), "the notice says what to do");
});

check("tax packs are labelled, not mislabelled as advisory", () => {
  assert.equal(draftKindLabel("tax_pack"), "Tax pack");
  assert.equal(draftKindLabel("advisory"), "Advisory");
});

// --- server function guards, read from source ---
check("the server function audits before any password use and gates on consent", () => {
  const source = read("src/lib/tax-deliverable.functions.ts");
  const auditAt = source.indexOf("await auditPasswordUse(");
  const openAt = source.indexOf("await openFilePassword(");
  assert.ok(auditAt > 0 && openAt > 0 && auditAt < openAt, "audit row before password use");
  assert.ok(source.includes('"client_agent_file_password_used"'));
  assert.ok(source.includes("consent_at") && source.includes("completed_at"));
  assert.ok(source.includes("isFirmMember"));
  assert.ok(source.includes("sendAgentFirmAllowed"));
  assert.ok(source.includes('status: "draft"'), "the pack is stored as a draft");
  assert.ok(!source.includes("console.log"), "nothing is logged");
  assert.ok(!/sendMail|resend|mailer/i.test(source), "no mail goes out");
  assert.ok(!source.toLowerCase().includes("whatsapp"));
});

check("the extract module never logs and keeps passwords server-side", () => {
  const source = read("src/lib/tax-deliverable-extract.server.ts");
  assert.ok(!source.includes("console."));
  assert.ok(source.includes("PasswordException"));
});

check("the fixture is sample data only", () => {
  const source = read("src/lib/tax-deliverable-fixture.ts");
  assert.ok(/sample|fixture/i.test(source));
  for (const file of SAMPLE_TAX_PACK_FILES) {
    assert.ok(file.displayName?.startsWith("sample-"));
  }
});

for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("tax deliverable rules hold");
