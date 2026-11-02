/**
 * SARS form gallery on the Tax Specialist page. ZA chunk only: import this
 * from the lazily loaded page, never from US-reachable code.
 * The list lives in the catalog (`registry.ts`). This module is the gallery
 * face of that catalog.
 */
export type { TaxFormCode, TaxFormEntry, TaxFormStatus } from "./registry.ts";
export { TAX_FORM_GALLERY, TAX_FORM_STATUS_LABEL } from "./registry.ts";
