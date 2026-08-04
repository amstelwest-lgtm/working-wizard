/**
 * HealthScoreGauge — slim score bar with tier colouring and subtle
 * tier-threshold notches at 40 and 65.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, StyleSheet } from "@react-pdf/renderer";
import { C, scoreColor } from "./theme";

type Props = {
  score: number;
  height?: number;
};

const styles = StyleSheet.create({
  track: {
    borderRadius: 4,
    overflow: "hidden",
    position: "relative",
    backgroundColor: C.hairline,
  },
  fill: { borderRadius: 4 },
  notch: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 0.75,
    backgroundColor: C.white,
    opacity: 0.9,
  },
});

export function HealthScoreGauge({ score, height = 6 }: Props) {
  const pct = Math.max(0, Math.min(100, score || 0));

  return (
    <View style={[styles.track, { height }]}>
      <View
        style={[styles.fill, { width: `${pct}%`, height, backgroundColor: scoreColor(pct) }]}
      />
      {/* Tier threshold notches */}
      <View style={[styles.notch, { left: "40%" }]} />
      <View style={[styles.notch, { left: "65%" }]} />
    </View>
  );
}
