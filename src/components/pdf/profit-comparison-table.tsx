/**
 * Current-versus-prior profit table shared by the profitability waterfall.
 */
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, fmtRand, fmtPct } from "@/components/pdf/theme";
import { formatReportAmount, currencySymbol } from "@/lib/market";
import { usePdfMarket } from "@/components/pdf/pdf-market";

const tblStyles = StyleSheet.create({
  wrapper: {
    marginBottom: 8,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 0.75,
    borderColor: C.line,
  },
  headerRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 8 },
  headerCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  dataRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 7.5,
    borderTopWidth: 0.5,
    borderTopColor: C.hairline,
  },
  cell: { fontSize: 8, fontFamily: "Helvetica", color: C.body },
  boldCell: { fontFamily: "Helvetica-Bold", color: C.ink },
  changePos: { color: C.green, fontFamily: "Helvetica-Bold", fontSize: 8 },
  changeNeg: { color: C.red, fontFamily: "Helvetica-Bold", fontSize: 8 },
});

export type ProfitCompRow = {
  metric: string;
  curVal: number;
  curPct: number;
  priorVal?: number;
  priorPct?: number;
};

export function ComparisonTable({ rows, accent }: { rows: ProfitCompRow[]; accent: string }) {
  const market = usePdfMarket();
  const unit = currencySymbol(market);
  const headers = [
    { label: "Metric", flex: 2 },
    { label: `Current (${unit})`, flex: 1.5, align: "right" as const },
    { label: "%", flex: 0.7, align: "right" as const },
    { label: `Prior (${unit})`, flex: 1.5, align: "right" as const },
    { label: "%", flex: 0.7, align: "right" as const },
    { label: "Change", flex: 1, align: "right" as const },
  ];

  return (
    <View style={tblStyles.wrapper}>
      <View style={[tblStyles.headerRow, { backgroundColor: accent }]}>
        {headers.map((h, i) => (
          <Text
            key={i}
            style={[tblStyles.headerCell, { flex: h.flex, textAlign: h.align ?? "left" }]}
          >
            {h.label}
          </Text>
        ))}
      </View>

      {rows.map((row, ri) => {
        const changePct =
          row.priorVal !== undefined && row.priorVal !== 0
            ? ((row.curVal - row.priorVal) / row.priorVal) * 100
            : null;
        const isPos = changePct !== null && changePct >= 0;

        return (
          <View
            key={ri}
            style={[tblStyles.dataRow, { backgroundColor: ri % 2 === 1 ? C.soft : C.white }]}
          >
            <Text style={[tblStyles.cell, tblStyles.boldCell, { flex: 2 }]}>{row.metric}</Text>
            <Text style={[tblStyles.cell, { flex: 1.5, textAlign: "right" }]}>
              {fmtRand(row.curVal, market)}
            </Text>
            <Text style={[tblStyles.cell, { flex: 0.7, textAlign: "right" }]}>
              {fmtPct(row.curPct)}
            </Text>
            <Text style={[tblStyles.cell, { flex: 1.5, textAlign: "right" }]}>
              {row.priorVal !== undefined ? fmtRand(row.priorVal, market) : "—"}
            </Text>
            <Text style={[tblStyles.cell, { flex: 0.7, textAlign: "right" }]}>
              {row.priorPct !== undefined ? fmtPct(row.priorPct) : "—"}
            </Text>
            <Text
              style={[
                changePct !== null
                  ? isPos
                    ? tblStyles.changePos
                    : tblStyles.changeNeg
                  : tblStyles.cell,
                { flex: 1, textAlign: "right" },
              ]}
            >
              {changePct !== null
                ? formatReportAmount(changePct, market, {
                    style: "percent",
                    percentPoints: true,
                    sign: "always",
                  })
                : "—"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
