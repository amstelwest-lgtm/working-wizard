/**
 * The one draft path for every catalog form:
 * catalog entry → field schema → intake mapping → tax_form_drafts version →
 * Work → Tax review → the form's own export.
 *
 * The model does not compute tax. IRP6 totals stay in irp6.ts. Saving a
 * draft does not email the client and does not call SARS.
 */
import {
  fieldSourcesFromFields,
  saveTaxFormDraft,
  type TaxFormDraft,
  type TaxFormDraftSave,
} from "./drafts.ts";
import {
  requireTaxForm,
  taxFormByCode,
  type TaxFormCode,
  type TaxFormDefinition,
  type TaxFormField,
} from "./registry.ts";

export type TaxFormSchema = {
  form: TaxFormDefinition;
  fields: readonly TaxFormField[];
  intakeItems: readonly string[];
};

/** Catalog entry plus the field list and the intake map. Unknown codes throw. */
export function taxFormSchema(code: string): TaxFormSchema {
  const form = requireTaxForm(code);
  return { form, fields: form.fields, intakeItems: form.intakeItems };
}

export function isCatalogForm(code: string): code is TaxFormCode {
  return taxFormByCode(code) != null;
}

/**
 * Save a new version of a catalog form. The previous version stays.
 * rules_year comes from the catalog when the caller does not pass one.
 */
export async function saveCatalogDraft(draft: TaxFormDraftSave): Promise<TaxFormDraft> {
  const form = requireTaxForm(draft.form_code);
  return saveTaxFormDraft({
    ...draft,
    rules_year: draft.rules_year ?? form.rulesYear,
    field_sources: draft.field_sources ?? fieldSourcesFromFields(draft.fields),
  });
}
