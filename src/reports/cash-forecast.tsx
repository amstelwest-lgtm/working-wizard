/**
 * CashForecastPDF — 13-Week Rolling Cash Flow Forecast.
 * Page 1: exec summary + runway chart with shaded danger zone and threshold
 * line. Page 2: full data table + assumptions.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { View, Text } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { MetricBox } from "@/components/pdf/metric-box";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ReportSection } from "@/lib/report-pdf-layout";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { RunwayChart } from "@/components/pdf/cash-runway-chart";
import { WeekTable } from "@/components/pdf/cash-week-table";
import { C, fmtRand, fmtRandCompact, resolveTheme } from "@/components/pdf/theme";
import { cashForecastNarrative } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { profileCashAssumptions } from "@/lib/profile-signals";
import { CASH_RUNWAY_THRESHOLD_RAND } from "@/lib/cash-runway";
import { ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { reportKicker } from "@/lib/report-catalog";
import { forecastIsCashGenerative } from "@/lib/client-metrics";
import {
  forecastFloorPosition,
  forecastLowestPoint,
  forecastRunwayHeadlineShared,
  forecastWeeksBelowReadout,
} from "@/lib/cash-forecast-parity";

// ── Types ──────────────────────────────────────────────────────────────────

/** A manufactured zero series is not a forecast. Rounding matches the PDF's dash rule. */
export function cashForecastSeriesBlank(
  weeks: readonly {
    opening_balance?: number | null;
    total_receipts?: number | null;
    total_payments?: number | null;
    net_movement?: number | null;
    closing_balance?: number | null;
  }[],
): boolean {
  if (weeks.length === 0) return true;
  return weeks.every((week) =>
    [
      week.opening_balance,
      week.total_receipts,
      week.total_payments,
      week.net_movement,
      week.closing_balance,
    ].every((value) => value == null || !Number.isFinite(value) || Math.round(value) === 0),
  );
}

export type CashForecastWeek = {
  period_label: string;
  opening_balance: number | null;
  total_receipts: number | null;
  total_payments: number | null;
  net_movement: number | null;
  closing_balance: number | null;
  scenario: "critical" | "moderate" | "growth";
  runway_weeks: number | null;
};

export type CashForecastPDFProps = {
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  cashForecast: CashForecastWeek[];
  /** "base" is the published forecast. Named scenarios are only for a scenario export. */
  scenario: "base" | "critical" | "moderate" | "growth";
  accountantProfile: AccountantProfile;
  minimumThreshold?: number;
  /** Shared runway label ("Cash generative", "6 weeks"). Wins over the floor index. */
  runwayLabel?: string | null;
  cashGenerative?: boolean;
  assumptions?: string[];
  /** Honest label when the weeks were spread from monthly actuals. */
  seedLabel?: string | null;
  isDemo?: boolean;
  /** Fictional client (`clients.is_demo`). Live figures, SAMPLE stamp. */
  sample?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  market?: ResolvedMarket;
};

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = CASH_RUNWAY_THRESHOLD_RAND;

const SCENARIO_META: Record<string, { label: string; color: string }> = {
  base: { label: "Base forecast", color: C.blue },
  critical: { label: "Critical scenario", color: C.red },
  moderate: { label: "Moderate scenario", color: C.blue },
  growth: { label: "Growth scenario", color: C.green },
};

const DEFAULT_ASSUMPTIONS = [
  "Cash receipts are based on current debtor-day patterns and projected sales volume.",
  "Payments reflect existing supplier terms, contracted fixed costs, and known variable outflows.",
  "Tax and loan repayments follow the current scheduled payment calendar.",
  "No extraordinary capital expenditure, asset disposals, or one-off items are assumed in this forecast.",
];

function finiteCash(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sumFinite(values: readonly (number | null | undefined)[]): number | null {
  if (values.length === 0 || values.some((value) => !finiteCash(value))) return null;
  return values.reduce<number>((sum, value) => sum + (value as number), 0);
}

// ── Main component ─────────────────────────────────────────────────────────

export function CashForecastPDF({
  smeData,
  cashForecast,
  scenario,
  accountantProfile,
  minimumThreshold = DEFAULT_THRESHOLD,
  runwayLabel = null,
  cashGenerative = false,
  assumptions = DEFAULT_ASSUMPTIONS,
  seedLabel = null,
  isDemo,
  sample,
  reviewSignoff,
  operatingProfile,
  market,
}: CashForecastPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const m = market ?? ZA_MARKET;
  const weeks = cashForecast;
  const scenarioMeta = SCENARIO_META[scenario] ?? SCENARIO_META.base;
  const seriesBlank = cashForecastSeriesBlank(weeks);
  const labelledAssumptions = seedLabel?.trim() ? [seedLabel.trim(), ...assumptions] : assumptions;
  const resolvedAssumptions = seriesBlank
    ? []
    : [...labelledAssumptions, ...profileCashAssumptions(operatingProfile)];

  const openingRaw = weeks[0]?.opening_balance;
  const startBalance = finiteCash(openingRaw) ? openingRaw : null;
  const balancesKnown =
    startBalance != null && weeks.every((week) => finiteCash(week.closing_balance));
  const closings = balancesKnown ? weeks.map((week) => week.closing_balance as number) : [];
  const lowestPoint = balancesKnown ? forecastLowestPoint(startBalance, closings) : null;
  const minBalance = lowestPoint?.amount ?? null;
  const floorPos = balancesKnown
    ? forecastFloorPosition({
        opening: startBalance,
        closings,
        floor: minimumThreshold,
      })
    : null;
  const weeksReadout = seriesBlank
    ? { value: "—", note: "Not enough data", clear: false }
    : floorPos
      ? forecastWeeksBelowReadout(floorPos)
      : { value: "—", note: "Opening cash unknown", clear: false };
  const totalReceipts = sumFinite(weeks.map((week) => week.total_receipts));
  const totalPayments = sumFinite(weeks.map((week) => week.total_payments));
  const endRaw = weeks[weeks.length - 1]?.closing_balance;
  const endBalance = finiteCash(endRaw) ? endRaw : null;

  const netFlow =
    totalReceipts != null && totalPayments != null ? totalReceipts - totalPayments : null;
  const generative =
    balancesKnown &&
    totalReceipts != null &&
    totalPayments != null &&
    Boolean(cashGenerative) &&
    forecastIsCashGenerative(totalReceipts, totalPayments);
  const sharedRunway = balancesKnown
    ? forecastRunwayHeadlineShared({
        opening: startBalance,
        closings,
        floor: minimumThreshold,
        runwayLabel,
        cashGenerative: generative && floorPos?.staysAbove === true,
      })
    : null;
  const runwayValue = seriesBlank
    ? "Not enough data"
    : sharedRunway
      ? sharedRunway.headline
      : "Opening cash unknown";
  const runwayWeeks =
    floorPos == null || floorPos.firstDipWeek == null ? weeks.length : floorPos.firstDipWeek - 1;
  const blankFigure = {
    value: "—",
    note: seriesBlank ? "Not enough data" : "Opening cash unknown",
  };
  const figures: HeadlineFigure[] =
    seriesBlank || !balancesKnown || minBalance == null || endBalance == null
      ? [
          { label: "Runway", value: runwayValue, note: blankFigure.note },
          { label: "Lowest Balance", ...blankFigure },
          { label: "Closing Position", ...blankFigure },
          {
            label: "Net Flow",
            value: netFlow == null ? "—" : fmtRandCompact(netFlow, m),
            good: netFlow != null && netFlow > 0,
            note: seriesBlank ? "Not enough data" : "over 13 weeks",
          },
        ]
      : [
          {
            label: "Runway",
            value: runwayValue,
            good: sharedRunway?.note === "above the floor",
            direction: sharedRunway?.note === "above the floor" ? "up" : "down",
            note: sharedRunway?.note,
          },
          {
            label: "Lowest Balance",
            value: fmtRandCompact(minBalance, m),
            good: minBalance >= minimumThreshold,
            note: lowestPoint?.isOpening ? "opening balance" : "projected trough",
          },
          {
            label: "Closing Position",
            value: fmtRandCompact(endBalance, m),
            direction: endBalance >= startBalance ? "up" : "down",
            good: endBalance >= startBalance,
            note: "end of horizon",
          },
          {
            label: "Net Flow",
            value: netFlow == null ? "—" : fmtRandCompact(netFlow, m),
            good: netFlow != null && netFlow > 0,
            note: "over 13 weeks",
          },
        ];

  const narrative = seriesBlank
    ? "Not enough data"
    : !balancesKnown || minBalance == null || floorPos == null
      ? "Opening cash unknown"
      : cashForecastNarrative(
          {
            runwayWeeks: generative && floorPos.staysAbove ? null : runwayWeeks,
            cashGenerative: generative && floorPos.staysAbove,
            minBalance,
            threshold: minimumThreshold,
            weeksBelow: floorPos.weeksBelow,
            firstBreachWeek: floorPos.firstDipWeek,
            opensBelow: floorPos.opensBelow,
            empty: false,
          },
          operatingProfile,
          m,
        );

  return (
    <PDFDocument
      title={`13-Week Cash Forecast — ${smeData.name}`}
      subject="Cash Flow Forecast"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      sample={sample}
      draft={!isDemo && !sample && !reviewSignoff}
      reviewSignoff={reviewSignoff}
      market={m}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker={reportKicker("forecast", scenarioMeta.label)}
        title="13-Week Cash Forecast"
        subtitle="Projected cash position, runway, and the danger threshold that triggers action"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      <ReportSection
        heading={<SectionHeader title="Projected Closing Balance by Week" color={theme.accent} />}
        lead={
          seriesBlank ? (
            <Text style={{ fontSize: 9, fontFamily: "Helvetica", color: C.body }}>
              Not enough data
            </Text>
          ) : !balancesKnown ? (
            <Text style={{ fontSize: 9, fontFamily: "Helvetica", color: C.body }}>
              Opening cash unknown
            </Text>
          ) : (
            <RunwayChart weeks={weeks} threshold={minimumThreshold} accent={theme.accent} />
          )
        }
      >
        <View style={{ flexDirection: "row", gap: 10 }}>
          <MetricBox
            label="Total Receipts"
            value={totalReceipts == null ? "—" : fmtRand(totalReceipts, m)}
            accentColor={C.green}
            note="13-week inflows"
          />
          <MetricBox
            label="Total Payments"
            value={totalPayments == null ? "—" : fmtRand(totalPayments, m)}
            accentColor={C.red}
            note="13-week outflows"
          />
          <MetricBox
            label="Weeks Below Minimum"
            value={weeksReadout.value}
            accentColor={weeksReadout.clear ? C.green : C.red}
            note={weeksReadout.note}
          />
        </View>
      </ReportSection>

      {/* ── PAGE 2 ── */}
      <View break>
        <WeekTable
          heading={<SectionHeader title="Weekly Cash Movement Detail" color={theme.accent} />}
          weeks={weeks}
          threshold={minimumThreshold}
          accent={theme.accent}
        />

        {resolvedAssumptions.length > 0 ? (
          <ReportSection
            heading={<SectionHeader title="Forecast Assumptions" color={theme.accent} />}
            lead={
              <View
                style={{
                  backgroundColor: C.soft,
                  borderRadius: 5,
                  borderWidth: 0.75,
                  borderColor: C.line,
                  padding: 12,
                }}
              >
                {resolvedAssumptions.map((a, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: "row",
                      marginBottom: i < resolvedAssumptions.length - 1 ? 6 : 0,
                    }}
                  >
                    <Text style={{ fontSize: 8, color: C.faint, width: 12 }}>•</Text>
                    <Text
                      style={{
                        fontSize: 8,
                        color: C.body,
                        fontFamily: "Helvetica",
                        lineHeight: 1.5,
                        flex: 1,
                      }}
                    >
                      {a}
                    </Text>
                  </View>
                ))}
              </View>
            }
          />
        ) : null}
      </View>
    </PDFDocument>
  );
}
