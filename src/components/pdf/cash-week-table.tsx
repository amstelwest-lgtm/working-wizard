/**
 * Weekly cash movement table shared by the cash forecast report and the
 * advisory pack.
 */
import type { ReactNode } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, fmtRand } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";
import { ReportSection, reportTablePartStyle } from "@/lib/report-pdf-layout";
import { cashForecastWeekRowLabel } from "@/lib/cash-forecast-parity";
import { formatReportAmount, type ResolvedMarket } from "@/lib/market";

const tbl = StyleSheet.create({
  headerRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 8 },
  headerCell: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 0.5,
    borderTopColor: C.hairline,
  },
  cell: { fontSize: 7.5, fontFamily: "Helvetica", color: C.body },
});

export type CashWeekRow = {
  period_label: string;
  opening_balance: number | null;
  total_receipts: number | null;
  total_payments: number | null;
  net_movement: number | null;
  closing_balance: number | null;
};

function finiteCash(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pdfAmount(value: number | null | undefined, market: ResolvedMarket): string {
  if (!finiteCash(value)) return "—";
  return fmtRand(value, market);
}

export function WeekTable({
  weeks,
  threshold,
  accent,
  heading,
}: {
  weeks: CashWeekRow[];
  threshold: number;
  accent: string;
  heading: ReactNode;
}) {
  const market = usePdfMarket();
  const cols = [
    { label: "Week", flex: 1.1 },
    { label: "Opening", flex: 1.4, right: true },
    { label: "Receipts", flex: 1.4, right: true },
    { label: "Payments", flex: 1.4, right: true },
    { label: "Net", flex: 1.3, right: true },
    { label: "Closing", flex: 1.4, right: true },
  ];
  const header = (
    <View style={[tbl.headerRow, { backgroundColor: accent }]}>
      {cols.map((c, i) => (
        <Text
          key={i}
          style={[tbl.headerCell, { flex: c.flex, textAlign: c.right ? "right" : "left" }]}
        >
          {c.label}
        </Text>
      ))}
    </View>
  );
  const rowNodes = weeks.map((w, i) => {
    const danger = finiteCash(w.closing_balance) && w.closing_balance < threshold;
    const netUp = finiteCash(w.net_movement) && w.net_movement >= 0;
    return (
      <View
        key={i}
        style={[tbl.row, { backgroundColor: danger ? C.redSoft : i % 2 === 1 ? C.soft : C.white }]}
      >
        <Text style={[tbl.cell, { flex: 1.1, fontFamily: "Helvetica-Bold", color: C.ink }]}>
          {
            cashForecastWeekRowLabel(w.period_label) // date-ok: week row label, not a calendar span
          }
        </Text>
        <Text style={[tbl.cell, { flex: 1.4, textAlign: "right" }]}>
          {pdfAmount(w.opening_balance, market)}
        </Text>
        <Text style={[tbl.cell, { flex: 1.4, textAlign: "right", color: C.greenDeep }]}>
          {pdfAmount(w.total_receipts, market)}
        </Text>
        <Text style={[tbl.cell, { flex: 1.4, textAlign: "right", color: C.redDeep }]}>
          {finiteCash(w.total_payments)
            ? formatReportAmount(w.total_payments, market, { sign: "parens" })
            : "—"}
        </Text>
        <Text
          style={[
            tbl.cell,
            {
              flex: 1.3,
              textAlign: "right",
              color: netUp ? C.greenDeep : C.redDeep,
            },
          ]}
        >
          {pdfAmount(w.net_movement, market)}
        </Text>
        <Text
          style={[
            tbl.cell,
            {
              flex: 1.4,
              textAlign: "right",
              fontFamily: "Helvetica-Bold",
              color: danger ? C.redDeep : C.ink,
            },
          ]}
        >
          {pdfAmount(w.closing_balance, market)}
        </Text>
      </View>
    );
  });
  const rest = rowNodes.slice(1);
  return (
    <ReportSection
      heading={heading}
      lead={
        <View style={reportTablePartStyle(rest.length ? "lead" : "only", C.line)}>
          {header}
          {rowNodes[0] ?? null}
        </View>
      }
    >
      {rest.length ? <View style={reportTablePartStyle("rest", C.line)}>{rest}</View> : null}
    </ReportSection>
  );
}
