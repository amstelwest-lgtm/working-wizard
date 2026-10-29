import { Text, View } from "@react-pdf/renderer";
import { RunwayChart } from "@/components/pdf/cash-runway-chart";
import { WeekTable, type CashWeekRow } from "@/components/pdf/cash-week-table";
import { C, fmtRandCompact } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";
import { PACK_SHOWS } from "@/lib/advisory-pack-copy";
import { P, SANS } from "./pack-type";
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
    forecast ? { label: "Minimum cash", value: fmtRandCompact(floor, market) } : null,
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
        style={{
          fontSize: 15,
          fontFamily: SANS,
          fontWeight: 600,
          color: "#102A43",
          marginBottom: 6,
          textAlign: "center",
        }}
      >
        Cash in the bank, week by week
      </Text>
      {weeks.length === 0 ? (
        <Text style={{ fontSize: 9.5, fontFamily: SANS, color: C.body, marginBottom: 8 }}>
          No 13-week forecast was frozen with this report.
        </Text>
      ) : (
        <RunwayChart
          weeks={weeks}
          threshold={floor}
          accent={accent}
          markWeek={forecast?.lowestWeek}
          chartHeight={88}
          fontFamily={SANS}
          centerLegend
          showThresholdTag={false}
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
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 7,
                  fontFamily: SANS,
                  fontWeight: 600,
                  color: P.muted,
                  textAlign: "center",
                }}
              >
                {tile.label}
              </Text>
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: SANS,
                  fontWeight: 700,
                  color: P.navy,
                  textAlign: "center",
                  marginTop: 1,
                }}
              >
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
          fontFamily={SANS}
          together
          heading={
            <Text
              style={{
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: 8,
                letterSpacing: 1.2,
                color: P.cobalt,
                textAlign: "center",
                marginBottom: 6,
              }}
            >
              WEEKLY CASH MOVEMENT
            </Text>
          }
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
