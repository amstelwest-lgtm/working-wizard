/**
 * Advisory pack PDF — the current pack sections on the shared report shell.
 * Import only via dynamic import().
 */
import { Text, View, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type ReportSignoffStamp, type SmeData } from "@/components/pdf/pdf-document";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { C } from "@/components/pdf/theme";
import type { ResolvedMarket } from "@/lib/market";
import {
  ADVISORY_PACK_DRAFT_DISCLOSURE,
  pdfSafeText,
  type AdvisoryPackPdfSection,
} from "@/lib/advisory-pack-pdf";

export type AdvisoryPackPDFProps = {
  smeData: SmeData;
  accountantProfile: AccountantProfile;
  sections: AdvisoryPackPdfSection[];
  /** Exact draft sentence, or null once the pack is signed off. */
  draftDisclosure?: string | null;
  reviewSignoff?: ReportSignoffStamp | null;
  sample?: boolean;
  market?: ResolvedMarket;
};

const S = StyleSheet.create({
  draft: {
    borderWidth: 0.75,
    borderColor: C.gold,
    backgroundColor: C.amberSoft,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 12,
  },
  draftText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.amberDeep,
  },
  body: {
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: C.body,
    lineHeight: 1.45,
    marginBottom: 3,
  },
  bullet: {
    fontSize: 9,
    fontFamily: "Helvetica",
    color: C.body,
    lineHeight: 1.4,
    marginBottom: 2,
    paddingLeft: 2,
  },
  empty: { fontSize: 9, fontFamily: "Helvetica", color: C.muted },
});

function lines(value: string): string[] {
  return pdfSafeText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function AdvisoryPackPDF({
  smeData,
  accountantProfile,
  sections,
  draftDisclosure,
  reviewSignoff,
  sample,
  market,
}: AdvisoryPackPDFProps) {
  const disclosure = reviewSignoff ? null : (draftDisclosure ?? ADVISORY_PACK_DRAFT_DISCLOSURE);
  return (
    <PDFDocument
      title={`${smeData.name} advisory pack`}
      subject="Advisory pack"
      smeData={smeData}
      accountantProfile={accountantProfile}
      draft={!reviewSignoff}
      reviewSignoff={reviewSignoff}
      sample={sample}
      market={market}
    >
      <ReportTitle kicker="Advisory" title="Advisory pack" subtitle={smeData.period} />
      {disclosure ? (
        <View style={S.draft}>
          <Text style={S.draftText}>{disclosure}</Text>
        </View>
      ) : null}
      {sections.length === 0 ? (
        <Text style={S.empty}>This pack has no sections yet.</Text>
      ) : (
        sections.map((section, i) => (
          <View key={`${section.title}-${i}`} minPresenceAhead={88}>
            <SectionHeader title={pdfSafeText(section.title)} />
            {lines(section.body).map((line, li) => (
              <Text key={li} style={S.body}>
                {line}
              </Text>
            ))}
            {section.bullets?.map((bullet, bi) => (
              <Text key={`b-${bi}`} style={S.bullet}>
                {"• "}
                {pdfSafeText(bullet)}
              </Text>
            ))}
          </View>
        ))
      )}
    </PDFDocument>
  );
}
