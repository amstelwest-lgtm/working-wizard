import { Document, Page, View } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { ReportHeader } from "./report-header";
import { ReportFooter } from "./report-footer";
import { DemoWatermark } from "./watermark";

export type SmeData = {
  name: string;
  period: string;
};

/** A current (non-stale) accountant sign-off, stamped onto the report footer. */
export type ReportSignoffStamp = {
  signedOffByName: string;
  signedOffByTitle: string | null;
  firmName: string | null;
  signedOffAt: string;
};

type Props = {
  title: string;
  subject?: string;
  smeData: SmeData;
  accountantProfile: AccountantProfile;
  /** When true, every page carries an elegant "illustrative data" watermark. */
  isDemo?: boolean;
  /** Only pass a non-stale sign-off — the footer renders it unconditionally when present. */
  reviewSignoff?: ReportSignoffStamp | null;
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
  reviewSignoff,
  children,
}: Props) {
  return (
    <Document
      title={title}
      subject={subject}
      author={accountantProfile.firmName || "Milon"}
      creator="Milon"
      producer="Milon PDF Engine"
    >
      <Page
        size="A4"
        style={{
          paddingBottom: 56,
          backgroundColor: "#ffffff",
        }}
      >
        {isDemo ? <DemoWatermark /> : null}

        {/* Fixed header — renders at the top of every page */}
        <ReportHeader
          fixed
          profile={accountantProfile}
          smeName={smeData.name}
          period={smeData.period}
        />

        {/* Content area */}
        <View style={{ paddingHorizontal: 40, paddingTop: 16 }}>
          {children}
        </View>

        {/* Fixed footer — absolutely positioned at bottom of every page */}
        <ReportFooter fixed profile={accountantProfile} reviewSignoff={reviewSignoff} />
      </Page>
    </Document>
  );
}
