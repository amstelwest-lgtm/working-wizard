/**
 * Phase 0: one catalog, IRP6 on it, versioned drafts, Work → Tax, tax pack.
 * Run: pnpm test:tax-form-pipeline
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaxPackCard } from "../src/components/tax-pack-panel";
import { TaxWorkSlot } from "../src/components/tax-specialist/tax-work-slot";
import { TaxWorkBoard } from "../src/components/tax-specialist/za-tax-work";
import {
  applySavedDraft,
  draftActivity,
  findIrp6Draft,
  isCurrentTaxDraft,
  nextTaxFormVersion,
  taxDraftHistory,
  type TaxFormDraft,
} from "../src/lib/tax-specialist/forms/drafts";
import { TAX_FORM_GALLERY } from "../src/lib/tax-specialist/forms/gallery";
import { IRP6_FIELDS } from "../src/lib/tax-specialist/forms/irp6";
import { isCatalogForm, taxFormSchema } from "../src/lib/tax-specialist/forms/pipeline";
import {
  ITR12_INTAKE_ITEMS,
  TAX_FORM_REGISTRY,
  requireTaxForm,
} from "../src/lib/tax-specialist/forms/registry";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected)
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
}

eq(
  TAX_FORM_GALLERY.map((form) => form.code).join(","),
  TAX_FORM_REGISTRY.map((form) => form.code).join(","),
  "the gallery is the catalog, in the same order",
);
eq(
  TAX_FORM_GALLERY.filter((form) => form.status === "ready")
    .map((form) => form.code)
    .join(","),
  "IRP6,ITR12",
  "company IRP6 and individual ITR12 are ready to prepare",
);

const irp6 = taxFormSchema("IRP6");
eq(irp6.fields.length, IRP6_FIELDS.length, "IRP6 schema is the live field list");
for (const field of IRP6_FIELDS) {
  const mapped = irp6.fields.find((row) => row.id === field.id);
  assert(mapped, `${field.id} is on the catalog schema`);
  assert(mapped?.intake.from, `${field.id} names an intake`);
  eq(mapped?.efiling ?? null, field.efiling, `${field.id} keeps its eFiling name`);
}
eq(irp6.form.rulesYear, 2023, "company IRP6 uses the 27% rules vintage");

const itr12 = taxFormSchema("ITR12");
assert(itr12.fields.length > 0, "ITR12 has a field schema");
eq(itr12.form.status, "ready", "ITR12 is ready to prepare");
eq(itr12.form.rulesYear, 2026, "ITR12 uses the cited-sum rules vintage");
eq(itr12.form.entity, "individual", "ITR12 is the individual return");
for (const item of ITR12_INTAKE_ITEMS) {
  assert(itr12.intakeItems.includes(item), `ITR12 intake includes ${item}`);
  assert(
    itr12.fields.some(
      (field) => field.intake.from === "checklist" && field.intake.itemKey === item,
    ),
    `ITR12 maps ${item} onto a field`,
  );
}
assert(isCatalogForm("VAT201"), "VAT201 is on the catalog");
assert(!isCatalogForm("IRS1040"), "no US form is on the catalog");
let unknown = false;
try {
  requireTaxForm("IRS1040");
} catch {
  unknown = true;
}
assert(unknown, "a form outside the catalog cannot draft");

const migration = readFileSync(
  "supabase/migrations/20261102170000_tax_form_drafts_catalog.sql",
  "utf8",
);
for (const form of TAX_FORM_REGISTRY) {
  assert(migration.includes(`'${form.code}'`), `${form.code} is in the catalog migration`);
}
assert(!/DELETE\s+FROM\s+public\.tax_form_drafts/i.test(migration), "versions are not deleted");
assert(migration.includes("supersedes_id"), "new version points at the previous one");
assert(migration.includes("superseded_by"), "the previous version points at the new one");
assert(migration.includes("tax_form_drafts_keep_history"), "old versions are read-only");
assert(!/SECURITY DEFINER/i.test(migration), "the save function is not security definer");

function draft(
  partial: Partial<TaxFormDraft> & Pick<TaxFormDraft, "id" | "version">,
): TaxFormDraft {
  return {
    client_id: "c1",
    form_code: "IRP6",
    tax_year: 2027,
    period: 2,
    subject: null,
    fields: { profitBeforeTax: { value: "1.00", source: "input" } },
    approvals: {},
    status: "draft",
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    downloaded_at: null,
    created_at: "2026-10-29T07:00:00.000Z",
    updated_at: "2026-10-29T07:00:00.000Z",
    supersedes_id: null,
    superseded_by: null,
    rules_year: 2023,
    field_sources: {},
    ...partial,
  };
}

const v1 = draft({ id: "v1", version: 1 });
const v1Fields = v1.fields;
const { saved, rest } = nextTaxFormVersion(
  [v1],
  {
    client_id: "c1",
    form_code: "IRP6",
    tax_year: 2027,
    period: 2,
    subject: null,
    fields: { profitBeforeTax: { value: "2.00", source: "input", fileId: "file-9" } },
    approvals: { taxpayer: true },
    status: "draft",
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    downloaded_at: null,
    rules_year: 2023,
  },
  "2026-10-30T08:00:00.000Z",
);
eq(saved.version, 2, "a save is the next version");
eq(saved.supersedes_id, "v1", "the new version names the one it replaced");
assert(saved.id !== "v1", "the new version is a new row");
eq(saved.field_sources.profitBeforeTax, "file-9", "a cited file is stored with the field");
eq(rest[0]?.superseded_by, saved.id, "the earlier version points at the new one");
eq(rest[0]?.fields.profitBeforeTax?.value, "1.00", "the earlier version keeps its figures");
eq(v1Fields.profitBeforeTax?.value, "1.00", "versioning does not rewrite the previous row");
assert(!isCurrentTaxDraft(rest[0]!), "the earlier version is not current");
eq(findIrp6Draft([saved, ...rest], 2027, 2)?.id, saved.id, "the sheet opens the current version");
eq(taxDraftHistory([saved, ...rest], saved)[0]?.id, "v1", "history lists the earlier version");

const listed = applySavedDraft([v1], saved);
eq(listed[0]?.id, saved.id, "the saved row is first");
eq(listed.find((row) => row.id === "v1")?.superseded_by, saved.id, "apply marks the old row");

const activity = draftActivity([
  draft({
    id: "old",
    version: 1,
    status: "downloaded",
    superseded_by: "new",
    approved_by_name: "Ada Mbeki",
    approved_at: "2026-10-29T08:00:00.000Z",
    downloaded_at: "2026-10-29T08:05:00.000Z",
    updated_at: "2026-10-29T08:05:00.000Z",
  }),
  draft({
    id: "new",
    version: 2,
    status: "draft",
    supersedes_id: "old",
    updated_at: "2026-10-30T08:00:00.000Z",
  }),
]);
eq(activity.length, 1, "activity shows the current version only");
assert(activity[0]?.text.includes("saved as a draft"), "the current draft is the activity line");
assert(!activity[0]?.text.includes("downloaded"), "a superseded download is not the current line");

const board = renderToStaticMarkup(
  createElement(TaxWorkBoard, {
    drafts: [saved, ...rest],
    packs: createElement("div", { "data-tax-pack-slot": "shown" }, "pack"),
    onPrepareIrp6: () => undefined,
    onOpenIrp6: () => undefined,
    onPrepareItr12: () => undefined,
    onOpenItr12: () => undefined,
  }),
);
assert(board.includes("IRP6 2027, period 2"), "Work → Tax names the current return");
assert(board.includes('data-tax-draft-current="true"'), "the current draft is marked current");
assert(board.includes('data-tax-draft-readonly="true"'), "the earlier version is read-only");
assert(board.includes('data-tax-work-open="IRP6"'), "the current IRP6 draft opens");
assert(board.includes('data-tax-work-prepare="IRP6"'), "the accountant can start an IRP6 draft");
assert(board.includes('data-tax-work-prepare="ITR12"'), "the accountant can start an ITR12 draft");
assert(board.includes('data-tax-pack-slot="shown"'), "the tax pack sits on the tax page");
assert(board.includes("not sent to the client"), "a finished form is not sent to the client");
eq((board.match(/data-tax-work-open="IRP6"/g) ?? []).length, 1, "history has no second Open");

const emptyPack = renderToStaticMarkup(
  createElement(TaxPackCard, {
    drafts: [],
    canDraft: false,
    busy: false,
    notice: null,
    showWhenEmpty: true,
    onDraft: () => undefined,
    onApprove: () => undefined,
    onDiscard: () => undefined,
  }),
);
assert(emptyPack.includes("data-tax-pack-panel"), "an empty tax pack still shows");
assert(emptyPack.includes("No tax pack yet."), "the empty pack says so");
assert(!emptyPack.includes("data-draft-tax-pack"), "drafting waits for a finished send");

const us = renderToStaticMarkup(
  createElement(TaxWorkSlot, {
    country: "US",
    client: {
      id: "c1",
      name: "Harbour",
      fyStartMonth: 3,
      financials: null,
      financialsAsOf: null,
    },
  }),
);
assert(!us.includes("IRP6"), "a US client does not see the IRP6 draft");
assert(!us.includes("SARS"), "a US client does not see SARS copy");
assert(us.includes("No tax deliverables yet"), "the US tax tab keeps the empty place");

const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(route.includes("<TaxWorkSlot"), "the accountant tax tab mounts the work slot");
assert(!route.includes("<TaxWorkPlaceholder"), "the empty placeholder is not the tax tab");
const slot = readFileSync("src/components/tax-specialist/tax-work-slot.tsx", "utf8");
assert(!/IRP6|SARS|ITR14|South Africa/.test(slot), "the US-reachable slot has no form copy");
assert(slot.includes('import("./za-tax-work")'), "the ZA page is a dynamic import");
const work = readFileSync("src/components/tax-specialist/za-tax-work.tsx", "utf8");
assert(work.includes("TaxPackPanel"), "the tax pack panel is on the ZA tax page");
const sheet = readFileSync("src/components/tax-specialist/za-irp6-sheet.tsx", "utf8");
assert(sheet.includes("saveCatalogDraft"), "IRP6 saves through the shared pipeline");
assert(!sheet.includes("saveTaxFormDraft"), "IRP6 no longer calls the one-off save");

console.log("tax-form-pipeline ok");
