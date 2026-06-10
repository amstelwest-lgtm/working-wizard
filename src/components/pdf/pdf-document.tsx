import { Document, Page, View } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { ReportHeader } from "./report-header";
import { ReportFooter } from "./report-footer";

export type SmeData = {
  name: string;
  period: string;
};

type Props = {
  title: string;
  subject?: string;
  smeData: SmeData;
  accountantProfile: AccountantProfile;
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
  children,
}: Props) {
  return (
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
          paddingBottom: 56,
          backgroundColor: "#ffffff",
        }}
      >
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
        <ReportFooter fixed profile={accountantProfile} />
      </Page>
    </Document>
  );
}
