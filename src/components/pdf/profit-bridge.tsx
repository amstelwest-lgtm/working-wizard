/**
 * Revenue-to-profit bridge shared by the profitability waterfall and the
 * advisory pack. Step maths stay here so both reports draw the same bars.
 */
import { Fragment } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { buildBridgeSteps, type BridgeStep, type ProfitBridgeInput } from "@/lib/profit-bridge-steps";
import { C, fmtRandCompact } from "@/components/pdf/theme";
import { formatReportAmount } from "@/lib/market";
import { usePdfMarket } from "@/components/pdf/pdf-market";

const BR_W = 515;
const BR_H = 170;
const BR_LABEL_H = 30;
const BR_VALUE_H = 14;

const brStyles = StyleSheet.create({
  container: {
    position: "relative",
    height: BR_H + BR_LABEL_H + BR_VALUE_H,
    marginBottom: 4,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0.5,
    backgroundColor: C.hairline,
  },
  baseline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: BR_LABEL_H,
    height: 0.75,
    backgroundColor: C.line,
  },
  bar: { position: "absolute", borderRadius: 2 },
  connector: { position: "absolute", height: 0.75, backgroundColor: C.faint },
  colLabel: {
    position: "absolute",
    bottom: 4,
    fontSize: 6,
    textAlign: "center",
    fontFamily: "Helvetica",
    color: C.muted,
    lineHeight: 1.2,
  },
  valueLabel: {
    position: "absolute",
    fontSize: 6,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
  },
  legend: { flexDirection: "row", gap: 14, marginTop: 2, marginBottom: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 6.5, color: C.muted, fontFamily: "Helvetica" },
});

export function BridgeChart({
  d,
  accent,
  steps: provided,
}: {
  d: ProfitBridgeInput;
  accent: string;
  /** Frozen steps. When omitted, the chart builds them from `d`. */
  steps?: BridgeStep[];
}) {
  const market = usePdfMarket();
  const steps = provided ?? buildBridgeSteps(d);

  // Scale: 0 .. revenue (floor at 0 for negative running values)
  const maxVal = Math.max(d.revenue, 1);
  const y = (v: number) => Math.max(0, Math.min(1, v / maxVal)) * BR_H;

  const n = steps.length;
  const slot = BR_W / n;
  const barW = slot - 14;

  return (
    <View>
      <View style={brStyles.container}>
        {[0.25, 0.5, 0.75, 1].map((p, i) => (
          <View key={i} style={[brStyles.gridLine, { bottom: BR_LABEL_H + p * BR_H }]} />
        ))}
        <View style={brStyles.baseline} />

        {steps.map((s, i) => {
          const left = i * slot + 7;
          const runningStart = s.kind === "decrease" ? s.runningEnd - s.delta : 0;
          const top = s.kind === "decrease" ? Math.max(runningStart, s.runningEnd) : s.runningEnd;
          const bottom = s.kind === "decrease" ? Math.min(runningStart, s.runningEnd) : 0;
          const barBottom = BR_LABEL_H + y(Math.max(0, bottom));
          const barH = Math.max(2, y(top) - y(Math.max(0, bottom)));
          const color =
            s.kind === "decrease"
              ? C.red
              : s.label.startsWith("Net")
                ? d.net_profit >= 0
                  ? C.green
                  : C.red
                : s.kind === "total"
                  ? accent
                  : C.blueLight;

          // Connector line from this bar's end level to the next bar
          const nextLeft = (i + 1) * slot + 7;
          const connBottom = BR_LABEL_H + y(Math.max(0, s.runningEnd));

          return (
            <Fragment key={i}>
              <View
                style={[
                  brStyles.bar,
                  { left, bottom: barBottom, width: barW, height: barH, backgroundColor: color },
                ]}
              />
              {i < n - 1 && (
                <View
                  style={[
                    brStyles.connector,
                    { left: left + barW, bottom: connBottom, width: nextLeft - left - barW },
                  ]}
                />
              )}
              <Text
                style={[
                  brStyles.valueLabel,
                  {
                    left: left - 7,
                    width: barW + 14,
                    bottom: barBottom + barH + 3,
                    color: s.kind === "decrease" ? C.redDeep : C.ink,
                  },
                ]}
              >
                {s.kind === "decrease"
                  ? formatReportAmount(s.delta, market, { style: "compact", sign: "parens" })
                  : fmtRandCompact(s.delta, market)}
              </Text>
              <Text style={[brStyles.colLabel, { left: i * slot, width: slot }]}>{s.label}</Text>
            </Fragment>
          );
        })}
      </View>

      <View style={brStyles.legend}>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: accent }]} />
          <Text style={brStyles.legendText}>Revenue</Text>
        </View>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: C.blueLight }]} />
          <Text style={brStyles.legendText}>Gross profit</Text>
        </View>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: C.red }]} />
          <Text style={brStyles.legendText}>Cost step</Text>
        </View>
        <View style={brStyles.legendItem}>
          <View style={[brStyles.legendDot, { backgroundColor: C.green }]} />
          <Text style={brStyles.legendText}>Net profit</Text>
        </View>
      </View>
    </View>
  );
}
