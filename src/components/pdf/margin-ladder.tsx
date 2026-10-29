/**
 * Gross / operating / net margin ladder shared by the profitability
 * waterfall and the advisory pack.
 */
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, fmtRand, fmtPct } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";

const ladderStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: C.hairline,
  },
  name: { flex: 2, fontSize: 8.5, fontFamily: "Helvetica", color: C.body },
  amount: {
    width: 90,
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    textAlign: "right",
  },
  track: {
    flex: 3,
    height: 6,
    backgroundColor: C.hairline,
    borderRadius: 3,
    marginHorizontal: 10,
    overflow: "hidden",
  },
  fill: { height: 6, borderRadius: 3 },
  pct: { width: 44, fontSize: 8, fontFamily: "Helvetica-Bold", color: C.body, textAlign: "right" },
});

export type MarginLadderInput = {
  revenue: number;
  gross_profit: number;
  gross_margin_pct: number;
  operating_profit: number;
  operating_margin_pct: number;
  net_profit: number;
  net_margin_pct: number;
};

export function MarginLadder({
  d,
  accent,
  fontFamily,
}: {
  d: MarginLadderInput;
  accent: string;
  /** Omitted on the profitability report, which stays on Helvetica. */
  fontFamily?: string;
}) {
  const market = usePdfMarket();
  const face = fontFamily ? { fontFamily } : {};
  const faceBold = fontFamily ? { fontFamily, fontWeight: 700 as const } : {};
  const rows = [
    { name: "Revenue", amount: d.revenue, pct: 1, color: accent },
    { name: "Gross Profit", amount: d.gross_profit, pct: d.gross_margin_pct, color: C.blue },
    {
      name: "Operating Profit",
      amount: d.operating_profit,
      pct: d.operating_margin_pct,
      color: C.blueLight,
    },
    {
      name: "Net Profit",
      amount: d.net_profit,
      pct: d.net_margin_pct,
      color: d.net_profit >= 0 ? C.green : C.red,
    },
  ];
  return (
    <View>
      {rows.map((r) => (
        <View key={r.name} style={ladderStyles.row}>
          <Text style={[ladderStyles.name, face]}>{r.name}</Text>
          <Text style={[ladderStyles.amount, faceBold]}>{fmtRand(r.amount, market)}</Text>
          <View style={ladderStyles.track}>
            <View
              style={[
                ladderStyles.fill,
                {
                  width: `${(Math.max(0, Math.min(1, r.pct)) * 100).toFixed(1)}%`,
                  backgroundColor: r.color,
                },
              ]}
            />
          </View>
          <Text style={[ladderStyles.pct, faceBold]}>{fmtPct(r.pct)}</Text>
        </View>
      ))}
    </View>
  );
}
