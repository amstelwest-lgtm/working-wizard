/**
 * Paper size and page-frame layout for every report PDF.
 * Figures, periods, and sign-off wording stay where they are.
 *
 * Section headings go through ReportSection. The heading, its intro, and the
 * first rows (or the first card) are one unbreakable block, so a title cannot
 * sit alone at the bottom of a page.
 */

import { createElement, type ReactNode } from "react";
import { View } from "@react-pdf/renderer";
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

/** The section title block: tick, label, rule, and its margins. */
export const SECTION_HEADING_HEIGHT = 52;

/**
 * One body row kept with that title. Ratio and table rows are taller than the
 * type size, and a wrapped label needs a second line.
 */
export const SECTION_ROW_HEIGHT = 56;

/**
 * Room a section must have before it starts: the heading plus two rows.
 * Applied to the unbreakable lead, not to the heading on its own.
 */
export function sectionMinPresenceAhead(rows = 2): number {
  return SECTION_HEADING_HEIGHT + SECTION_ROW_HEIGHT * rows;
}

/** Heading plus two rows. Same value ReportSection asks the page to keep. */
export const SECTION_KEEP_WITH_NEXT = sectionMinPresenceAhead(2);

type ReportSectionProps = {
  /** The section title. Usually a SectionHeader. */
  heading: ReactNode;
  /** Sentence under the title, before the first row or card. */
  intro?: ReactNode;
  /** First one or two rows, or the first card. Stays on the heading's page. */
  lead?: ReactNode;
  /** Rows that may continue on the next page. */
  children?: ReactNode;
  style?: object;
};

/**
 * One section. The heading, intro, and lead cannot split across pages, and
 * the block does not start unless the heading plus two rows would fit.
 */
export function ReportSection({ heading, intro, lead, children, style }: ReportSectionProps) {
  return createElement(
    View,
    style ? { style } : null,
    createElement(
      View,
      { wrap: false, minPresenceAhead: sectionMinPresenceAhead(2) },
      heading,
      intro ?? null,
      lead ?? null,
    ),
    children ?? null,
  );
}

/**
 * Top and bottom of one bordered table. The lead (header and first row) and
 * the rest share a single outline when they land on the same page.
 */
export function reportTablePartStyle(part: "only" | "lead" | "rest", borderColor: string) {
  const box = {
    borderRadius: 5,
    overflow: "hidden" as const,
    borderWidth: 0.75,
    borderColor,
    marginBottom: 4,
  };
  if (part === "lead") {
    return {
      ...box,
      marginBottom: 0,
      borderBottomWidth: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    };
  }
  if (part === "rest") {
    return {
      ...box,
      marginTop: 0,
      borderTopWidth: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    };
  }
  return box;
}

/**
 * A card (header plus its body) must not start unless this much room remains,
 * and must not split. Tables keep their own header-with-first-row rule.
 */
export const PDF_CARD_MIN_PRESENCE = 88;

/** Draft mark sits in the page body, clear of the footer page number. */
export const DRAFT_WATERMARK_TOP = 300;
