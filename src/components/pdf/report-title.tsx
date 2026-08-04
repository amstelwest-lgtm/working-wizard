/**
 * ReportTitle — shared title block: gold-flanked kicker, headline, subtitle,
 * optional demo notice chip.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, T } from "./theme";
import { DemoNotice } from "./watermark";

type Props = {
  kicker: string;
  title: string;
  subtitle?: string;
  isDemo?: boolean;
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  goldTick: { width: 18, height: 1, backgroundColor: C.gold },
  kicker: { ...T.kicker },
  title: { ...T.h1, marginBottom: 4 },
  subtitle: { fontSize: 9, fontFamily: "Helvetica", color: C.muted },
});

export function ReportTitle({ kicker, title, subtitle, isDemo }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.kickerRow}>
        <View style={styles.goldTick} />
        <Text style={styles.kicker}>{kicker}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {isDemo ? (
        <View style={{ marginTop: 8 }}>
          <DemoNotice />
        </View>
      ) : null}
    </View>
  );
}
