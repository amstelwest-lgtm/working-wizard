/**
 * SARS form gallery on the Tax Specialist page. ZA chunk only: import this
 * from the lazily loaded page, never from US-reachable code.
 * The list lives in the catalog (`registry.ts`). This module is the gallery
 * face of that catalog.
 */
import type { TaxFormEntry } from "./registry.ts";

export type { TaxFormCode, TaxFormEntry, TaxFormStatus } from "./registry.ts";
export { TAX_FORM_GALLERY, TAX_FORM_STATUS_LABEL } from "./registry.ts";

/**
 * Ready forms for the Practice Tax portfolio chips. The page gallery lists
 * company and individual IRP6 as two rows; the portfolio shows one chip per code.
 */
export function portfolioReadyForms(
  gallery: readonly TaxFormEntry[],
): readonly TaxFormEntry[] {
  const ready = gallery.filter((form) => form.status === "ready");
  const seen = new Set<string>();
  return ready.filter((form) => {
    if (seen.has(form.code)) return false;
    seen.add(form.code);
    return true;
  });
}
