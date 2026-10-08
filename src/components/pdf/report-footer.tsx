/**
 * ReportFooter — professional footer with confidentiality note, page numbers
 * and dual branding (firm name + "Prepared with Milōn" mark).
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { formatReviewDateTime } from "@/lib/market";
import { SAMPLE_STAMP_LINE, SAMPLE_STAMP_WORD } from "@/lib/pdf-sample";
import { pdfSignoffBadgeLine, signoffFooterSegments } from "@/lib/review-signoff-stamp";
import { C, resolveTheme } from "./theme";
import { MilonMark } from "./glyphs";
import type { ReportSignoffStamp } from "./pdf-document";
import { usePdfMarket } from "./pdf-market";
import { usePdfSample } from "./pdf-frame";

type Props = {
  profile: AccountantProfile;
  fixed?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
};

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 40,
    paddingBottom: 18,
    paddingTop: 10,
  },
  hairline: { height: 0.75, backgroundColor: C.line, marginBottom: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  confidential: { fontSize: 6.5, fontFamily: "Helvetica", color: C.faint, flex: 2 },
  signoff: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: C.muted, marginTop: 2 },
  signoffRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  sampleLine: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: C.amberDeep, marginTop: 2 },
  pageNumber: {
    fontSize: 7,
    fontFamily: "Helvetica",
    color: C.muted,
    textAlign: "center",
    flex: 1,
  },
  brandBlock: { flex: 2, alignItems: "flex-end" },
  firmName: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: C.muted },
  milonRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 1, gap: 3 },
  milon: { fontSize: 6.5, fontFamily: "Helvetica", color: C.faint },
});

export function ReportFooter({ profile, fixed, reviewSignoff }: Props) {
  const theme = resolveTheme(profile);
  const market = usePdfMarket();
  const sample = usePdfSample();
  // Zone is the client's market (the PDF context), never the viewer's profile zone.
  const signoffDate = reviewSignoff
    ? formatReviewDateTime(reviewSignoff.signedOffAt, market)
    : null;
  const preparedAt = reviewSignoff ? null : formatReviewDateTime(new Date(), market);

  return (
    <View style={styles.wrapper} fixed={fixed}>
      <View style={styles.hairline} />
      <View style={styles.row}>
        <View style={{ flex: 2 }}>
          <Text style={styles.confidential}>Confidential — prepared for the addressee only</Text>
          {reviewSignoff ? (
            <View>
              {reviewSignoff.signatureData ? (
                <Image
                  src={reviewSignoff.signatureData}
                  style={{ height: 16, width: 64, objectFit: "contain", marginBottom: 2 }}
                />
              ) : null}
              <View>
                {(reviewSignoff.figuresChanged
                  ? [pdfSignoffBadgeLine(reviewSignoff, market)]
                  : signoffFooterSegments(reviewSignoff, signoffDate ?? "")
                ).map((line, index) => (
                  <Text key={`${index}-${line}`} style={styles.signoff}>
                    {line}
                  </Text>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.signoff}>Prepared {preparedAt}</Text>
          )}
          {sample ? (
            <Text style={styles.sampleLine}>
              {SAMPLE_STAMP_WORD} — {SAMPLE_STAMP_LINE}
            </Text>
          ) : null}
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />

        <View style={styles.brandBlock}>
          {theme.firmName ? <Text style={styles.firmName}>{theme.firmName}</Text> : null}
          <View style={styles.milonRow}>
            <Text style={styles.milon}>Prepared with</Text>
            <MilonMark fontSize={6.5} />
          </View>
        </View>
      </View>
    </View>
  );
}
