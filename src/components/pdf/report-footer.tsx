/**
 * ReportFooter — react-pdf/renderer component.
 *
 * IMPORTANT: This file uses @react-pdf/renderer primitives (View, Text).
 * It must NEVER be imported at the top level of any SSR-rendered route.
 * Always import it with React.lazy() or a dynamic import() inside a client-only
 * component guarded by typeof window !== "undefined".
 *
 * Usage inside a <Document><Page> tree (add fixed={true} for sticky footer):
 *   <ReportFooter profile={profile} fixed />
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";

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
    paddingBottom: 20,
    paddingTop: 12,
  },
  borderLine: {
    height: 1,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  poweredBy: {
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#9ca3af",
  },
  milonBold: {
    fontFamily: "Helvetica-Bold",
    color: "#9ca3af",
  },
  pageNumber: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#6b7280",
    textAlign: "center",
    flex: 1,
  },
  firmName: {
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#9ca3af",
    textAlign: "right",
  },
});

export function ReportFooter({ profile, fixed }: Props) {
  const accentHex = profile.accentColor || "#0f3460";
  const firmLabel = profile.firmName || "";

  return (
    <View style={styles.wrapper} fixed={fixed}>
      <View style={[styles.borderLine, { backgroundColor: accentHex }]} />
      <View style={styles.row}>
        <Text style={styles.poweredBy}>
          Powered by <Text style={styles.milonBold}>Milōn</Text>
        </Text>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
        />

        <Text style={styles.firmName}>{firmLabel}</Text>
      </View>
    </View>
  );
}
