/**
 * Per-render sign-off, sample, and draft flags. Report title and footer read
 * these so a stamp passed into PDFDocument shows under the title without each
 * report threading the object a second time.
 */

import { createContext, useContext } from "react";
import type { ReportSignoffStamp } from "./pdf-document";

export const PdfSignoffContext = createContext<ReportSignoffStamp | null>(null);
export function usePdfSignoff(): ReportSignoffStamp | null {
  return useContext(PdfSignoffContext);
}

export const PdfSampleContext = createContext(false);
export function usePdfSample(): boolean {
  return useContext(PdfSampleContext);
}

export const PdfDraftContext = createContext(false);
export function usePdfDraft(): boolean {
  return useContext(PdfDraftContext);
}

/** Notice under the title when the deliverable is unsigned. Budget passes its tab status. */
export const PdfDraftLabelContext = createContext("Draft");
export function usePdfDraftLabel(): string {
  return useContext(PdfDraftLabelContext);
}
