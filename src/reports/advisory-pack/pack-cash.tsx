import { Text, View } from "@react-pdf/renderer";
import { RunwayChart } from "@/components/pdf/cash-runway-chart";
import { WeekTable, type CashWeekRow } from "@/components/pdf/cash-week-table";
import { SectionHeader } from "@/components/pdf/section-header";
import { C, fmtRandCompact } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";
import { PACK_SHOWS } from "@/lib/advisory-pack-copy";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { PackExplainer, PageBand } from "./pack-explainer";

function rowsOf(content: AdvisoryPackContentV2): CashWeekRow[] {
  const forecast = content.forecast;
  if (!forecast || forecast.weeks.length === 0) return [];
  let opening = forecast.openingBalance;
  return forecast.weeks.map((week) => {
    const start = opening ?? week.closing - week.cashIn + week.cashOut;
    opening = week.closing;
    return {
      period_label: week.label.startsWith("Week") ? week.label : `Week ${week.week}`,
      opening_balance: start,
      total_receipts: week.cashIn,
      total_payments: week.cashOut,
      net_movement: week.cashIn - week.cashOut,
      closing_balance: week.closing,
    };
  });
}

export function PackCash({ content, accent }: { content: AdvisoryPackContentV2; accent: string }) {
  const market = usePdfMarket();
  const forecast = content.forecast;
  const section = content.sections.find((row) => row.key === "cash");
  const weeks = rowsOf(content);
  const floor = forecast?.floor ?? 0;
  const cycle = content.cashCycle;
  const tiles = [
    cycle?.debtorDays != null
      ? { label: "Debtor days", value: `${Math.round(cycle.debtorDays)}d` }
      : null,
    cycle?.creditorDays != null
      ? { label: "Creditor days", value: `${Math.round(cycle.creditorDays)}d` }
      : null,
    cycle?.stockDays != null
      ? { label: "Stock days", value: `${Math.round(cycle.stockDays)}d` }
      : null,
  ].filter((tile): tile is { label: string; value: string } => Boolean(tile));
  return (
    <View break>
      <PageBand
        title="Cash"
        tag={
          forecast?.lowestClosing == null
            ? null
            : `Low ${fmtRandCompact(forecast.lowestClosing, market)}`
        }
        tagColor={forecast?.breachesZero ? C.red : forecast?.breachesThreshold ? C.amber : C.green}
      />
      <Text
        style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: "#102A43", marginBottom: 4 }}
      >
        Cash in the bank, week by week
      </Text>
      {weeks.length === 0 ? (
        <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.body, marginBottom: 8 }}>
          No 13-week forecast was frozen with this report.
        </Text>
      ) : (
        <RunwayChart
          weeks={weeks}
          threshold={floor}
          accent={accent}
          markWeek={forecast?.lowestWeek}
        />
      )}
      {tiles.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          {tiles.map((tile) => (
            <View
              key={tile.label}
              style={{
                flex: 1,
                borderRadius: 8,
                borderWidth: 0.75,
                borderColor: C.line,
                paddingHorizontal: 8,
                paddingVertical: 6,
              }}
            >
              <Text style={{ fontSize: 7, fontFamily: "Helvetica", color: C.muted }}>
                {tile.label}
              </Text>
              <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: "#102A43" }}>
                {tile.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {weeks.length > 0 ? (
        <WeekTable
          weeks={weeks}
          threshold={floor}
          accent={accent}
          density="compact"
          heading={<SectionHeader title="Weekly cash movement" color={accent} />}
        />
      ) : null}
      <PackExplainer
        clientName={content.clientName}
        shows={PACK_SHOWS.cash}
        meaning={section?.meaning ?? ""}
        actions={section?.actions ?? []}
      />
    </View>
  );
}
