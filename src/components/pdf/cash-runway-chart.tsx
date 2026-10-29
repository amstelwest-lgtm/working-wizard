/**
 * 13-week closing-balance chart shared by the cash forecast report and the
 * advisory pack. The cash report re-imports this so its bars stay identical.
 */
import { Fragment } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, fmtRandCompact } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";

const CHART_W = 515;
const CHART_H = 130;
const LABEL_H = 20;

const ch = StyleSheet.create({
  container: { position: "relative", height: CHART_H + LABEL_H, marginBottom: 6 },
  gridLine: { position: "absolute", left: 0, right: 0, height: 0.5, backgroundColor: C.hairline },
  dangerZone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: LABEL_H,
    backgroundColor: C.redSoft,
    opacity: 0.7,
  },
  thresholdLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0.9,
    backgroundColor: C.red,
  },
  thresholdTag: {
    position: "absolute",
    right: 0,
    fontSize: 5.5,
    fontFamily: "Helvetica-Bold",
    color: C.redDeep,
  },
  bar: { position: "absolute", borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 },
  weekLabel: {
    position: "absolute",
    bottom: 3,
    fontSize: 5.5,
    textAlign: "center",
    fontFamily: "Helvetica",
    color: C.muted,
  },
  legend: { flexDirection: "row", gap: 14, marginTop: 2, marginBottom: 12 },
  legendCenter: { justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 6.5, color: C.muted, fontFamily: "Helvetica" },
});

export type CashRunwayWeek = {
  period_label: string;
  closing_balance: number | null;
};

function finiteCash(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function RunwayChart({
  weeks,
  threshold,
  accent,
  markWeek,
  chartHeight = CHART_H,
  fontFamily,
  centerLegend = false,
  showThresholdTag = true,
}: {
  weeks: CashRunwayWeek[];
  threshold: number;
  accent: string;
  /** 1-based week to tag. The cash report leaves this unset. */
  markWeek?: number | null;
  /** Defaults to the cash-report height. */
  chartHeight?: number;
  /** Omitted on the cash report, which stays on Helvetica. */
  fontFamily?: string;
  /** Pack pages centre the key. The cash report leaves it on the left. */
  centerLegend?: boolean;
  /** Pack pages move the minimum into a tile so the tag does not sit on the bars. */
  showThresholdTag?: boolean;
}) {
  const market = usePdfMarket();
  const face = fontFamily ? { fontFamily } : {};
  const faceBold = fontFamily ? { fontFamily, fontWeight: 700 as const } : {};
  const values = weeks.map((w) => w.closing_balance);
  if (values.some((value) => !finiteCash(value))) {
    return (
      <Text style={{ fontSize: 9, fontFamily: "Helvetica", color: C.body }}>
        Opening cash unknown
      </Text>
    );
  }
  const closings = values as number[];
  const maxVal = Math.max(...closings, threshold, 1);
  const minVal = Math.min(...closings, 0);
  const range = maxVal - minVal || 1;
  const y = (v: number) => ((v - minVal) / range) * chartHeight;

  const n = weeks.length;
  const slot = CHART_W / n;
  const barW = Math.max(6, slot - 8);
  const thresholdY = LABEL_H + y(threshold);

  return (
    <View>
      <View style={[ch.container, { height: chartHeight + LABEL_H }]}>
        {/* danger zone: below threshold */}
        <View style={[ch.dangerZone, { height: Math.max(0, y(threshold)) }]} />

        {[0.25, 0.5, 0.75, 1].map((p, i) => (
          <View key={i} style={[ch.gridLine, { bottom: LABEL_H + p * chartHeight }]} />
        ))}

        {/* bars */}
        {weeks.map((w, i) => {
          const v = w.closing_balance as number;
          const below = v < threshold;
          const zero = y(Math.max(0, minVal < 0 ? 0 : minVal));
          const top = y(Math.max(v, minVal < 0 ? 0 : minVal));
          const bottom = Math.min(zero, y(v));
          const h = Math.max(2, Math.abs(top - bottom));
          return (
            <Fragment key={i}>
              <View
                style={[
                  ch.bar,
                  {
                    left: i * slot + (slot - barW) / 2,
                    bottom: LABEL_H + bottom,
                    width: barW,
                    height: h,
                    backgroundColor: v < 0 ? C.red : below ? C.amber : accent,
                  },
                ]}
              />
              {markWeek === i + 1 ? (
                <Text
                  style={{
                    position: "absolute",
                    left: i * slot,
                    width: slot,
                    bottom: LABEL_H + bottom + h + 2,
                    fontSize: 5.5,
                    textAlign: "center",
                    ...(fontFamily ? faceBold : { fontFamily: "Helvetica-Bold" }),
                    color: C.redDeep,
                  }}
                >
                  LOW
                </Text>
              ) : null}
              <Text style={[ch.weekLabel, face, { left: i * slot, width: slot }]}>
                {
                  w.period_label.replace(/^Week /i, "W") // date-ok: week axis label, not a calendar span
                }
              </Text>
            </Fragment>
          );
        })}

        {/* threshold line on top */}
        <View style={[ch.thresholdLine, { bottom: thresholdY }]} />
        {showThresholdTag ? (
          <Text style={[ch.thresholdTag, faceBold, { bottom: thresholdY + 2 }]}>
            MINIMUM {fmtRandCompact(threshold, market)}
          </Text>
        ) : null}
      </View>

      <View style={centerLegend ? [ch.legend, ch.legendCenter] : ch.legend}>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: accent }]} />
          <Text style={[ch.legendText, face]}>Closing balance</Text>
        </View>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: C.amber }]} />
          <Text style={[ch.legendText, face]}>Below minimum</Text>
        </View>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: C.red }]} />
          <Text style={[ch.legendText, face]}>Negative balance</Text>
        </View>
        <View style={ch.legendItem}>
          <View style={[ch.legendDot, { backgroundColor: C.redSoft }]} />
          <Text style={[ch.legendText, face]}>Danger zone</Text>
        </View>
      </View>
    </View>
  );
}
