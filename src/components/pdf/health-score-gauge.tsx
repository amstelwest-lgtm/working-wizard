import { View, StyleSheet } from "@react-pdf/renderer";

type Props = {
  score: number;
  height?: number;
  showMarker?: boolean;
};

const styles = StyleSheet.create({
  track: {
    borderRadius: 4,
    overflow: "hidden",
    position: "relative",
  },
  fill: {
    borderRadius: 4,
  },
});

function scoreColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

export function HealthScoreGauge({ score, height = 7 }: Props) {
  const pct = Math.max(0, Math.min(100, score || 0));
  const color = scoreColor(pct);

  return (
    <View style={[styles.track, { height, backgroundColor: "#e5e7eb" }]}>
      <View
        style={[
          styles.fill,
          { width: `${pct}%`, height, backgroundColor: color },
        ]}
      />
    </View>
  );
}
