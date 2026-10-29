/**
 * Advisory pack PDF — the current pack sections on the shared report shell.
 * Import only via dynamic import().
 */
import { Text, View, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type ReportSignoffStamp, type SmeData } from "@/components/pdf/pdf-document";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ReportSection } from "@/lib/report-pdf-layout";
import { C, resolveTheme } from "@/components/pdf/theme";
import type { ResolvedMarket } from "@/lib/market";
import {
  ADVISORY_PACK_DRAFT_DISCLOSURE,
  pdfSafeText,
  type AdvisoryPackPdfSection,
} from "@/lib/advisory-pack-pdf";
import { isAdvisoryPackV2, PACK_SCHEMA1_LAYOUT_NOTE } from "@/lib/advisory-pack-schema";
import type { AdvisoryPackContent } from "@/lib/advisory-pack";
import "./advisory-pack-pages/pack-fonts";
import { PackCover } from "./advisory-pack-pages/pack-cover";
import { PackSummary } from "./advisory-pack-pages/pack-summary";
import { PackHealth } from "./advisory-pack-pages/pack-health";
import { PackDuPont } from "./advisory-pack-pages/pack-dupont";
import { PackCash } from "./advisory-pack-pages/pack-cash";
import { PackProfit } from "./advisory-pack-pages/pack-profit";
import { PackPriorities } from "./advisory-pack-pages/pack-priorities";
import { PackNotes } from "./advisory-pack-pages/pack-notes";

export type AdvisoryPackPDFProps = {
  smeData: SmeData;
  accountantProfile: AccountantProfile;
  sections?: AdvisoryPackPdfSection[];
  /** Frozen pack. Schema 2 draws the eight-page report. Schema 1 stays text. */
  content?: AdvisoryPackContent | null;
  /** Shown on a schema 1 pack so the reader knows charts need a new version. */
  legacyNote?: boolean;
  dateLabel?: string;
  /** Exact draft sentence, or null once the pack is signed off. */
  draftDisclosure?: string | null;
  /** Page-1 line for an approval whose figures have moved. Not a draft watermark. */
  staleNotice?: string | null;
  reviewSignoff?: ReportSignoffStamp | null;
  /** Title status when unsigned. Defaults to Draft. */
  draftLabel?: string | null;
  /** Page watermark when unsigned. */
  draftMark?: string | null;
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
  sections = [],
  content,
  legacyNote,
  dateLabel,
  draftDisclosure,
  staleNotice,
  reviewSignoff,
  draftLabel,
  draftMark,
  sample,
  market,
}: AdvisoryPackPDFProps) {
  const notice = staleNotice?.trim() ? pdfSafeText(staleNotice.trim()) : null;
  const disclosure =
    notice || reviewSignoff ? null : (draftDisclosure ?? ADVISORY_PACK_DRAFT_DISCLOSURE);
  const stamp = reviewSignoff
    ? { ...reviewSignoff, figuresChanged: reviewSignoff.figuresChanged || Boolean(notice) }
    : null;
  const modern = content && isAdvisoryPackV2(content) ? content : null;
  const showLegacyNote = !modern && (legacyNote || content?.schema === 1);
  const theme = resolveTheme(accountantProfile);
  return (
    <PDFDocument
      title={`${smeData.name} Advisory Management Report`}
      subject="Advisory Management Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      draft={!stamp}
      draftLabel={draftLabel ?? undefined}
      draftMark={draftMark ?? undefined}
      reviewSignoff={stamp}
      sample={sample}
      market={market}
    >
      {modern ? (
        <>
          <PackCover
            content={modern}
            preparedBy={accountantProfile.firmName}
            accountantName={accountantProfile.accountantName}
            dateLabel={dateLabel || smeData.period}
          />
          <PackSummary content={modern} />
          <PackHealth content={modern} />
          <PackDuPont content={modern} />
          <PackCash content={modern} accent={theme.accent} />
          <PackProfit content={modern} accent={theme.accent} />
          <PackPriorities content={modern} />
          <PackNotes content={modern} />
        </>
      ) : null}
      {modern ? null : (
        <>
          <ReportTitle kicker="Advisory" title="Advisory pack" subtitle={smeData.period} />
          {showLegacyNote ? (
            <View style={S.draft}>
              <Text style={S.draftText}>{PACK_SCHEMA1_LAYOUT_NOTE}</Text>
            </View>
          ) : null}
          {notice ? (
            <View style={S.draft}>
              <Text style={S.draftText}>{notice}</Text>
            </View>
          ) : disclosure ? (
            <View style={S.draft}>
              <Text style={S.draftText}>{disclosure}</Text>
            </View>
          ) : null}
          {sections.length === 0 ? (
            <Text style={S.empty}>This pack has no sections yet.</Text>
          ) : (
            sections.map((section, i) => {
              const body = [
                ...lines(section.body).map((line, li) => (
                  <Text key={li} style={S.body}>
                    {line}
                  </Text>
                )),
                ...(section.bullets ?? []).map((bullet, bi) => (
                  <Text key={`b-${bi}`} style={S.bullet}>
                    {"• "}
                    {pdfSafeText(bullet)}
                  </Text>
                )),
              ];
              return (
                <ReportSection
                  key={`${section.title}-${i}`}
                  heading={<SectionHeader title={pdfSafeText(section.title)} />}
                  lead={body.slice(0, 2)}
                >
                  {body.slice(2)}
                </ReportSection>
              );
            })
          )}
        </>
      )}
    </PDFDocument>
  );
}
