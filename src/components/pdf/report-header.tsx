/**
 * ReportHeader — dual-branded masthead for every report page.
 * Client brand (logo / firm name) on the left, "Prepared for" block on the
 * right, finished with an accent rule and a thin gold hairline flourish.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { C, resolveTheme } from "./theme";

type Props = {
  profile: AccountantProfile;
  smeName: string;
  period: string;
  fixed?: boolean;
};

const styles = StyleSheet.create({
  outer: { backgroundColor: C.white },
  wrapper: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 26,
    paddingBottom: 14,
  },
  left: { flex: 1, justifyContent: "center" },
  logoImage: { maxHeight: 36, maxWidth: 130, objectFit: "contain" },
  firmNameText: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
    color: C.ink,
    textTransform: "uppercase",
  },
  tagline: { fontSize: 7, fontFamily: "Helvetica", marginTop: 3, color: C.muted },
  right: { alignItems: "flex-end" },
  preparedFor: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.faint,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  smeName: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  period: { fontSize: 7.5, fontFamily: "Helvetica", color: C.muted },
  accentRule: { height: 2, marginHorizontal: 40 },
  goldHairline: {
    height: 0.75,
    marginHorizontal: 40,
    marginTop: 2,
    backgroundColor: C.gold,
    opacity: 0.75,
  },
});

export function ReportHeader({ profile, smeName, period, fixed }: Props) {
  const theme = resolveTheme(profile);

  return (
    <View style={styles.outer} fixed={fixed}>
      <View style={styles.wrapper}>
        <View style={styles.left}>
          {theme.logoUrl ? (
            <Image src={theme.logoUrl} style={styles.logoImage} />
          ) : (
            <>
              <Text style={styles.firmNameText}>
                {theme.firmName || "MILON ADVISORY"}
              </Text>
              {theme.tagline ? (
                <Text style={styles.tagline}>{theme.tagline}</Text>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.right}>
          <Text style={styles.preparedFor}>Prepared for</Text>
          <Text style={styles.smeName}>{smeName}</Text>
          <Text style={styles.period}>{period}</Text>
        </View>
      </View>

      <View style={[styles.accentRule, { backgroundColor: theme.accent }]} />
      <View style={styles.goldHairline} />
    </View>
  );
}
