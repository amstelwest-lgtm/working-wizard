import { View, Text, StyleSheet } from "@react-pdf/renderer";

type HealthTier = "critical" | "at_risk" | "healthy";

type Props = {
  stepNumber: number;
  ratioName: string;
  stepTitle: string;
  description: string;
  timeframe: string;
  effort: string;
  impact: string;
  healthTier: HealthTier;
  accentColor?: string;
};

const TIER_COLOR: Record<HealthTier, string> = {
  critical: "#ef4444",
  at_risk: "#f59e0b",
  healthy: "#10b981",
};

const styles = StyleSheet.create({
  outer: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderRadius: 6,
    marginBottom: 12,
    overflow: "hidden",
  },
  leftStrip: {
    width: 4,
    borderRadius: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 13,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 7,
    gap: 8,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  circleText: {
    fontSize: 9,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
  },
  ratioLabel: {
    fontSize: 7.5,
    color: "#6b7280",
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 6,
  },
  description: {
    fontSize: 8.5,
    color: "#4b5563",
    lineHeight: 1.5,
    fontFamily: "Helvetica",
  },
  badgesRow: {
    flexDirection: "row",
    marginTop: 10,
    gap: 8,
  },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica",
    marginBottom: 1,
    textTransform: "uppercase",
    letterSpacing: 0.2,
  },
  badgeValue: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
});

function Badge({
  label,
  value,
  bg,
  fg,
}: {
  label: string;
  value: string;
  bg: string;
  fg: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.badgeValue, { color: fg }]}>{value}</Text>
    </View>
  );
}

export function InsightBox({
  stepNumber,
  ratioName,
  stepTitle,
  description,
  timeframe,
  effort,
  impact,
  healthTier,
  accentColor = "#0f3460",
}: Props) {
  const tierColor = TIER_COLOR[healthTier] ?? "#6b7280";

  return (
    <View style={styles.outer}>
      <View style={[styles.leftStrip, { backgroundColor: tierColor }]} />
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={[styles.circle, { backgroundColor: accentColor }]}>
            <Text style={styles.circleText}>{stepNumber}</Text>
          </View>
          <Text style={styles.ratioLabel}>{ratioName}</Text>
        </View>

        <Text style={styles.title}>{stepTitle}</Text>
        <Text style={styles.description}>{description}</Text>

        <View style={styles.badgesRow}>
          <Badge label="Timeframe" value={timeframe} bg="#dbeafe" fg="#1d4ed8" />
          <Badge label="Effort" value={effort} bg="#fef3c7" fg="#92400e" />
          <Badge label="Impact" value={impact} bg="#d1fae5" fg="#065f46" />
        </View>
      </View>
    </View>
  );
}
