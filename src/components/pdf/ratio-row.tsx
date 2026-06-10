import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { HealthScoreGauge } from "./health-score-gauge";

type HealthTier = "critical" | "at_risk" | "healthy";

type Props = {
  ratioName: string;
  formattedValue: string;
  healthScore: number;
  healthTier: HealthTier;
  priorScore?: number;
  isAlternate?: boolean;
};

const TIER: Record<HealthTier, { label: string; color: string; bg: string; fg: string }> = {
  critical: { label: "CRITICAL", color: "#ef4444", bg: "#fee2e2", fg: "#991b1b" },
  at_risk:  { label: "AT RISK",  color: "#f59e0b", bg: "#fef3c7", fg: "#92400e" },
  healthy:  { label: "HEALTHY",  color: "#10b981", bg: "#d1fae5", fg: "#065f46" },
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f3f4f6",
  },
  name: {
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: "#1f2937",
  },
  value: {
    width: 58,
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    textAlign: "right",
  },
  gaugeWrap: {
    flex: 2,
    marginHorizontal: 10,
  },
  scoreNum: {
    width: 26,
    fontSize: 8.5,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
  },
  tierBadge: {
    width: 54,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2.5,
    alignItems: "center",
  },
  tierText: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
  },
  arrow: {
    width: 18,
    fontSize: 10,
    textAlign: "center",
  },
});

export function RatioRow({
  ratioName,
  formattedValue,
  healthScore,
  healthTier,
  priorScore,
  isAlternate = false,
}: Props) {
  const tier = TIER[healthTier] ?? TIER.at_risk;
  const rounded = Math.round(healthScore || 0);

  let movement: { symbol: string; color: string } | null = null;
  if (priorScore !== undefined) {
    const delta = healthScore - priorScore;
    if (delta > 2) movement = { symbol: "▲", color: "#10b981" };
    else if (delta < -2) movement = { symbol: "▼", color: "#ef4444" };
    else movement = { symbol: "→", color: "#9ca3af" };
  }

  return (
    <View
      style={[
        styles.row,
        isAlternate ? { backgroundColor: "#f9fafb" } : { backgroundColor: "#ffffff" },
      ]}
    >
      <Text style={[styles.name, { flex: 3 }]}>{ratioName}</Text>

      <Text style={styles.value}>{formattedValue}</Text>

      <View style={styles.gaugeWrap}>
        <HealthScoreGauge score={healthScore} height={5} />
      </View>

      <Text style={[styles.scoreNum, { color: tier.color }]}>{rounded}</Text>

      <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
        <Text style={[styles.tierText, { color: tier.fg }]}>{tier.label}</Text>
      </View>

      {movement ? (
        <Text style={[styles.arrow, { color: movement.color }]}>
          {movement.symbol}
        </Text>
      ) : (
        <View style={{ width: 18 }} />
      )}
    </View>
  );
}
