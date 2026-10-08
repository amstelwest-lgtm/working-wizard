import { Document, Font, Page, View } from "@react-pdf/renderer";

// Helvetica has no soft hyphen. Default hyphenation clips "period" to "peri-od".
Font.registerHyphenationCallback((word) => [word]);
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { ReportHeader } from "./report-header";
import { ReportFooter } from "./report-footer";
import { DemoWatermark, DraftWatermark, SampleWatermark } from "./watermark";
import { PdfMarketContext } from "./pdf-market";
import { PdfDraftContext, PdfDraftLabelContext, PdfSampleContext, PdfSignoffContext } from "./pdf-frame";

export type SmeData = {
  name: string;
  period: string;
};

/** A current (non-stale) accountant sign-off, stamped onto the report footer. */
export type ReportSignoffStamp = {
  signedOffByName: string;
  signedOffByInitials: string | null;
  signedOffByTitle: string | null;
  firmName: string | null;
  signedOffAt: string;
  signatureData?: string | null;
  /** Stored approval whose figures no longer match the screen. */
  figuresChanged?: boolean;
};

type Props = {
  title: string;
  subject?: string;
  smeData: SmeData;
  accountantProfile: AccountantProfile;
  /** When true, every page carries an elegant "illustrative data" watermark. */
  isDemo?: boolean;
  /**
   * Fictional client (`clients.is_demo`). Stamps SAMPLE on every page and
   * keeps live figures plus the sign-off. Wins over the demo and draft marks.
   */
  sample?: boolean;
  /** Unsigned live deliverable. Ignored when isDemo or sample is set. */
  draft?: boolean;
  /** Title chip when unsigned. Defaults to the shared draft notice. */
  draftLabel?: string;
  /** Footer mark when unsigned. Defaults to the shared draft mark. */
  draftMark?: string;
  /** Only pass a non-stale sign-off — the footer renders it unconditionally when present. */
  reviewSignoff?: ReportSignoffStamp | null;
  /** Client (or firm) market — currency, locale, copy. Defaults to ZA. */
  market?: ResolvedMarket;
  children: React.ReactNode;
};

/**
 * Base A4 PDF wrapper. Adds a fixed ReportHeader at the top of every page
 * and a fixed ReportFooter at the bottom. The header is in the normal document
 * flow (repeats via fixed prop), so content naturally starts below it on every
 * page. The footer is absolutely positioned so it never pushes content.
 *
 * IMPORTANT: Only import this via dynamic import() — never at top level in an
 * SSR-rendered module.
 */
export function PDFDocument({
  title,
  subject,
  smeData,
  accountantProfile,
  isDemo,
  sample,
  draft,
  draftLabel,
  draftMark,
  reviewSignoff,
  market,
  children,
}: Props) {
  const resolved = market ?? ZA_MARKET;
  const stamp = reviewSignoff ?? null;
  const sampleOn = Boolean(sample);
  const draftOn = Boolean(draft) && !sampleOn && !stamp && !isDemo;
  return (
    <PdfMarketContext.Provider value={resolved}>
      <PdfSignoffContext.Provider value={stamp}>
        <PdfSampleContext.Provider value={sampleOn}>
          <PdfDraftContext.Provider value={draftOn}>
            <PdfDraftLabelContext.Provider value={draftLabel || "Draft"}>
              <Document
                title={title}
                subject={subject}
                author={accountantProfile.firmName || "Milōn"}
                creator="Milōn"
                producer="Milōn PDF Engine"
              >
                <Page
                  size="A4"
                  style={{
                    paddingBottom: sampleOn ? 68 : 56,
                    backgroundColor: "#ffffff",
                  }}
                >
                  {sampleOn ? (
                    <SampleWatermark />
                  ) : isDemo ? (
                    <DemoWatermark />
                  ) : draft ? (
                    <DraftWatermark text={draftMark} />
                  ) : null}

                  {/* Fixed header — renders at the top of every page */}
                  <ReportHeader
                    fixed
                    profile={accountantProfile}
                    smeName={smeData.name}
                    period={smeData.period}
                  />

                  {/* Content area */}
                  <View style={{ paddingHorizontal: 40, paddingTop: 16 }}>{children}</View>

                  {/* Fixed footer — absolutely positioned at bottom of every page */}
                  <ReportFooter fixed profile={accountantProfile} reviewSignoff={stamp} />
                </Page>
              </Document>
            </PdfDraftLabelContext.Provider>
          </PdfDraftContext.Provider>
        </PdfSampleContext.Provider>
      </PdfSignoffContext.Provider>
    </PdfMarketContext.Provider>
  );
}
