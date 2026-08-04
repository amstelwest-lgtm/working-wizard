/**
 * InsightBox — severity-coded action card for the intervention roadmap:
 * numbered step, severity strip + chip, title, description, meta chips.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, TIER_META, type Tier } from "./theme";

type Props = {
  stepNumber: number;
  ratioName: string;
  stepTitle: string;
  description: string;
  timeframe: string;
  effort: string;
  impact: string;
  healthTier: Tier;
  accentColor?: string;
};

const styles = StyleSheet.create({
  outer: {
    flexDirection: "row",
    backgroundColor: C.white,
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 6,
    marginBottom: 10,
    overflow: "hidden",
  },
  leftStrip: { width: 3.5 },
  content: { flex: 1, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 12 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    gap: 8,
  },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  circleText: { fontSize: 8.5, color: C.white, fontFamily: "Helvetica-Bold" },
  ratioLabel: {
    fontSize: 6.5,
    color: C.muted,
    fontFamily: "Helvetica",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    flex: 1,
  },
  severityChip: { borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2.5 },
  severityText: { fontSize: 5.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  title: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 5 },
  description: {
    fontSize: 8.5,
    color: C.body,
    lineHeight: 1.55,
    fontFamily: "Helvetica",
  },
  badgesRow: { flexDirection: "row", marginTop: 9, gap: 14 },
  meta: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  metaLabel: {
    fontSize: 6,
    fontFamily: "Helvetica",
    color: C.faint,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  metaValue: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.body },
});

export function InsightBox({
  stepNumber,
  ratioName,
  stepTitle,
  description,
  timeframe,
  effort,
  impact,
  healthTier,
  accentColor = C.blueDeep,
}: Props) {
  const tier = TIER_META[healthTier] ?? TIER_META.at_risk;

  return (
    <View style={styles.outer} wrap={false}>
      <View style={[styles.leftStrip, { backgroundColor: tier.color }]} />
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={[styles.circle, { backgroundColor: accentColor }]}>
            <Text style={styles.circleText}>{stepNumber}</Text>
          </View>
          <Text style={styles.ratioLabel}>{ratioName}</Text>
          <View style={[styles.severityChip, { backgroundColor: tier.soft }]}>
            <Text style={[styles.severityText, { color: tier.deep }]}>{tier.label}</Text>
          </View>
        </View>

        <Text style={styles.title}>{stepTitle}</Text>
        <Text style={styles.description}>{description}</Text>

        <View style={styles.badgesRow}>
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>Timeframe</Text>
            <Text style={styles.metaValue}>{timeframe}</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>Effort</Text>
            <Text style={styles.metaValue}>{effort}</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>Impact</Text>
            <Text style={styles.metaValue}>{impact}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
