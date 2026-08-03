import { View, Text, StyleSheet } from "@react-pdf/renderer";

type Props = {
  label: string;
  value: string;
  change?: number;
  accentColor?: string;
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    padding: 12,
    flex: 1,
    backgroundColor: "#ffffff",
  },
  accentBar: {
    height: 3,
    borderRadius: 2,
    marginBottom: 8,
  },
  label: {
    fontSize: 7.5,
    color: "#6b7280",
    marginBottom: 5,
    fontFamily: "Helvetica",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  value: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 4,
  },
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  changeText: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
  },
});

export function MetricBox({ label, value, change, accentColor }: Props) {
  const changeColor =
    change !== undefined
      ? change >= 0
        ? "#10b981"
        : "#ef4444"
      : undefined;

  return (
    <View style={styles.box}>
      {accentColor && (
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />
      )}
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {change !== undefined && (
        <View style={styles.changeRow}>
          <Text style={[styles.changeText, { color: changeColor }]}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
          </Text>
        </View>
      )}
    </View>
  );
}
