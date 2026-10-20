/**
 * Paper size and page-frame layout for every report PDF.
 * Figures, periods, and sign-off wording stay where they are.
 */

import { isUsCopy } from "@/lib/market";

export type ReportPaperSize = "A4" | "LETTER";

/**
 * US Letter when the client market is the US (country or the US copy pack).
 * Every other region stays on A4.
 */
export function reportPaperSize(
  market: { country?: string | null; copyPack?: "za" | "us" | null } | null | undefined,
): ReportPaperSize {
  if (!market) return "A4";
  if (market.country === "US") return "LETTER";
  if (market.copyPack && isUsCopy({ copyPack: market.copyPack })) return "LETTER";
  return "A4";
}

/**
 * Points kept clear under flowing content. The fixed footer paints in this
 * band, so a section header cannot land underneath it.
 */
export function pdfFooterReserve(input: { sample?: boolean; signed?: boolean } = {}): number {
  let reserve = 84;
  if (input.signed) reserve += 36;
  if (input.sample) reserve += 14;
  return reserve;
}

/**
 * Space a section header must leave after itself, so the title stays with
 * the first rows of the block that follows (keep-with-next).
 */
export const SECTION_KEEP_WITH_NEXT = 96;

/** Draft mark sits in the page body, clear of the footer page number. */
export const DRAFT_WATERMARK_TOP = 300;
