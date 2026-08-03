import { View, Text, StyleSheet } from "@react-pdf/renderer";

type Props = {
  title: string;
  score?: number;
  color?: string;
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 0,
  },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: "#ffffff",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  scoreWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#ffffff",
    opacity: 0.75,
  },
  scoreValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
});

export function SectionHeader({ title, score, color = "#1a1a2e" }: Props) {
  return (
    <View style={[styles.wrapper, { backgroundColor: color }]}>
      <Text style={styles.title}>{title}</Text>
      {score !== undefined && (
        <View style={styles.scoreWrap}>
          <Text style={styles.scoreLabel}>Score</Text>
          <Text style={styles.scoreValue}>{Math.round(score)}</Text>
        </View>
      )}
    </View>
  );
}
