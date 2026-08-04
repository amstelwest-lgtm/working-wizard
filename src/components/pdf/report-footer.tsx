/**
 * ReportFooter — professional footer with confidentiality note, page numbers
 * and dual branding (firm name + "Prepared with Milōn" mark).
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { C, resolveTheme } from "./theme";
import { MilonMark } from "./glyphs";

type Props = {
  profile: AccountantProfile;
  fixed?: boolean;
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

export function ReportFooter({ profile, fixed }: Props) {
  const theme = resolveTheme(profile);

  return (
    <View style={styles.wrapper} fixed={fixed}>
      <View style={styles.hairline} />
      <View style={styles.row}>
        <Text style={styles.confidential}>
          Confidential — prepared for the addressee only
        </Text>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />

        <View style={styles.brandBlock}>
          {theme.firmName ? (
            <Text style={styles.firmName}>{theme.firmName}</Text>
          ) : null}
          <View style={styles.milonRow}>
            <Text style={styles.milon}>Prepared with</Text>
            <MilonMark fontSize={6.5} />
          </View>
        </View>
      </View>
    </View>
  );
}
