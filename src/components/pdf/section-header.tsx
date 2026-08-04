/**
 * SectionHeader — refined typographic section divider: accent tick, small-caps
 * title, hairline rule, optional score chip. Replaces the old full-fill bar.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, scoreColor } from "./theme";

type Props = {
  title: string;
  score?: number;
  color?: string;
};

const styles = StyleSheet.create({
  wrapper: { marginTop: 14, marginBottom: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 7 },
  tick: { width: 3, height: 11, borderRadius: 1.5 },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: C.ink,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  scoreWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  scoreLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica",
    color: C.faint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  scoreChip: {
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  scoreValue: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.white },
  rule: { height: 0.75, backgroundColor: C.line },
});

export function SectionHeader({ title, score, color = C.blueDeep }: Props) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <View style={styles.left}>
          <View style={[styles.tick, { backgroundColor: color }]} />
          <Text style={styles.title}>{title}</Text>
        </View>
        {score !== undefined && (
          <View style={styles.scoreWrap}>
            <Text style={styles.scoreLabel}>Score</Text>
            <View style={[styles.scoreChip, { backgroundColor: scoreColor(score) }]}>
              <Text style={styles.scoreValue}>{Math.round(score)}</Text>
            </View>
          </View>
        )}
      </View>
      <View style={styles.rule} />
    </View>
  );
}
