/**
 * RatioRow — one-line ratio display: name · value · score gauge · score ·
 * tier chip · movement arrow, with optional trend sparkline.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, TIER_META, type Tier } from "./theme";
import { HealthScoreGauge } from "./health-score-gauge";
import { Arrow, type ArrowDir } from "./glyphs";
import { Sparkline } from "./sparkline";

type Props = {
  ratioName: string;
  formattedValue: string;
  healthScore: number;
  healthTier: Tier;
  priorScore?: number;
  /** Optional historical values (oldest → newest) for a trend sparkline. */
  trend?: (number | null | undefined)[];
  isAlternate?: boolean;
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7.5,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: C.hairline,
  },
  name: { fontSize: 8.5, fontFamily: "Helvetica", color: C.body },
  value: {
    width: 58,
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    textAlign: "right",
  },
  gaugeWrap: { flex: 2, marginHorizontal: 10 },
  sparkWrap: { width: 48, alignItems: "flex-end", marginRight: 8 },
  scoreNum: { width: 24, fontSize: 8.5, textAlign: "center", fontFamily: "Helvetica-Bold" },
  tierChip: {
    width: 52,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2.5,
    alignItems: "center",
  },
  tierText: { fontSize: 5.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.4 },
  arrowCell: { width: 16, alignItems: "center" },
});

export function RatioRow({
  ratioName,
  formattedValue,
  healthScore,
  healthTier,
  priorScore,
  trend,
  isAlternate = false,
}: Props) {
  const tier = TIER_META[healthTier] ?? TIER_META.at_risk;
  const rounded = Math.round(healthScore || 0);

  let movement: { dir: ArrowDir; color: string } | null = null;
  if (priorScore !== undefined) {
    const delta = healthScore - priorScore;
    if (delta > 2) movement = { dir: "up", color: C.green };
    else if (delta < -2) movement = { dir: "down", color: C.red };
    else movement = { dir: "flat", color: C.faint };
  }

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: isAlternate ? C.soft : C.white },
      ]}
    >
      <Text style={[styles.name, { flex: 3 }]}>{ratioName}</Text>

      <Text style={styles.value}>{formattedValue}</Text>

      <View style={styles.gaugeWrap}>
        <HealthScoreGauge score={healthScore} height={5} />
      </View>

      {trend && trend.filter((t) => t != null).length >= 2 ? (
        <View style={styles.sparkWrap}>
          <Sparkline values={trend} width={44} height={10} />
        </View>
      ) : null}

      <Text style={[styles.scoreNum, { color: tier.color }]}>{rounded}</Text>

      <View style={[styles.tierChip, { backgroundColor: tier.soft }]}>
        <Text style={[styles.tierText, { color: tier.deep }]}>{tier.label}</Text>
      </View>

      {movement ? (
        <View style={styles.arrowCell}>
          <Arrow dir={movement.dir} color={movement.color} size={5} />
        </View>
      ) : (
        <View style={{ width: 16 }} />
      )}
    </View>
  );
}
