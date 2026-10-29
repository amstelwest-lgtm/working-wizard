/**
 * ProfitabilityWaterfallPDF — Profitability Waterfall Report.
 * Page 1: exec summary + true bridge chart (floating bars, connector lines,
 * green/red step colouring). Page 2: comparison table + profit ratio rows.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { View, Text } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { scoreRatio } from "@/lib/health-score";
import { interestBurdenRatio, metricDirection, scoreTier, taxBurdenRatio } from "@/lib/ratios";
import { NO_PRIOR_PERIOD, priorMarginsDiffer } from "@/lib/report-coherence";
import { C, fmtRandCompact, fmtPct, resolveTheme } from "@/components/pdf/theme";
import { formatReportAmount } from "@/lib/market";
import { t, ZA_MARKET, type ResolvedMarket } from "@/lib/market";
import { BridgeChart } from "@/components/pdf/profit-bridge";
import { MarginLadder } from "@/components/pdf/margin-ladder";
import { ComparisonTable, type ProfitCompRow } from "@/components/pdf/profit-comparison-table";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ReportSection } from "@/lib/report-pdf-layout";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { profitabilityNarrative } from "./narrative";

import type { ClientOperatingProfile } from "@/lib/client-profile";
import { reportKicker } from "@/lib/report-catalog";

export { statedDepreciation } from "@/components/pdf/profit-bridge";

// ── Types ──────────────────────────────────────────────────────────────────

export type PeriodData = {
  revenue: number;
  gross_profit: number;
  gross_margin_pct: number;
  gross_margin_score?: number;
  gross_margin_tier?: string;
  operating_profit: number;
  operating_margin_pct: number;
  operating_margin_score?: number;
  operating_margin_tier?: string;
  ebt: number;
  interest_burden_pct?: number;
  interest_burden_score?: number;
  tax: number;
  tax_burden_pct?: number;
  tax_burden_score?: number;
  net_profit: number;
  net_margin_pct: number;
  net_margin_score?: number;
  net_margin_tier?: string;
  /** Non-cash D&A between operating expenses and operating profit. */
  depreciation?: number;
};

export type ProfitabilityData = PeriodData & {
  prior_period?: PeriodData;
};

export type ProfitabilityWaterfallPDFProps = {
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  profitabilityData: ProfitabilityData;
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  /** Fictional client (`clients.is_demo`). Live figures, SAMPLE stamp. */
  sample?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  market?: ResolvedMarket;
};

// ── Main component ─────────────────────────────────────────────────────────

export function ProfitabilityWaterfallPDF({
  smeData,
  profitabilityData: d,
  accountantProfile,
  isDemo,
  sample,
  reviewSignoff,
  operatingProfile,
  market,
}: ProfitabilityWaterfallPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const m = market ?? ZA_MARKET;
  const p = d.prior_period;
  const interestBurden = interestBurdenRatio(d.operating_profit, d.ebt);
  const taxBurden = taxBurdenRatio(d.ebt, d.net_profit);
  const priorInterest = p ? interestBurdenRatio(p.operating_profit, p.ebt) : NaN;
  const priorTax = p ? taxBurdenRatio(p.ebt, p.net_profit) : NaN;
  const comparablePrior = p != null && priorMarginsDiffer(d.net_margin_pct, p.net_margin_pct);
  const prior = comparablePrior ? p : undefined;

  const compRows: ProfitCompRow[] = [
    {
      metric: "Revenue",
      curVal: d.revenue,
      curPct: 1,
      priorVal: prior?.revenue,
      priorPct: prior ? 1 : undefined,
    },
    {
      metric: "Gross Profit",
      curVal: d.gross_profit,
      curPct: d.gross_margin_pct,
      priorVal: prior?.gross_profit,
      priorPct: prior?.gross_margin_pct,
    },
    {
      metric: "Operating Profit",
      curVal: d.operating_profit,
      curPct: d.operating_margin_pct,
      priorVal: prior?.operating_profit,
      priorPct: prior?.operating_margin_pct,
    },
    {
      metric: "EBT",
      curVal: d.ebt,
      curPct: d.ebt / d.revenue,
      priorVal: prior?.ebt,
      priorPct: prior ? prior.ebt / prior.revenue : undefined,
    },
    {
      metric: "Net Profit",
      curVal: d.net_profit,
      curPct: d.net_margin_pct,
      priorVal: prior?.net_profit,
      priorPct: prior?.net_margin_pct,
    },
  ];

  const profitRatioRows = [
    {
      name: "Gross Margin",
      value: fmtPct(d.gross_margin_pct),
      score: d.gross_margin_score ?? null,
      prior: prior?.gross_margin_score,
    },
    {
      name: "Operating Margin",
      value: fmtPct(d.operating_margin_pct),
      score: d.operating_margin_score ?? null,
      prior: prior?.operating_margin_score,
    },
    {
      name: "Net Margin",
      value: fmtPct(d.net_margin_pct),
      score: d.net_margin_score ?? null,
      prior: prior?.net_margin_score,
    },
    {
      name: "Interest Burden",
      value: Number.isFinite(interestBurden) ? fmtPct(interestBurden) : "—",
      score: Number.isFinite(interestBurden)
        ? Math.round(scoreRatio("Interest Burden", interestBurden))
        : null,
      prior: prior && Number.isFinite(priorInterest) ? Math.round(scoreRatio("Interest Burden", priorInterest)) : undefined,
      unscored: !Number.isFinite(interestBurden),
    },
    {
      name: "Tax Burden",
      value: Number.isFinite(taxBurden) ? fmtPct(taxBurden) : "—",
      score: Number.isFinite(taxBurden) ? Math.round(scoreRatio("Tax Burden", taxBurden)) : null,
      prior: prior && Number.isFinite(priorTax) ? Math.round(scoreRatio("Tax Burden", priorTax)) : undefined,
      unscored: !Number.isFinite(taxBurden),
    },
  ];

  const revChange =
    prior && prior.revenue !== 0 ? ((d.revenue - prior.revenue) / prior.revenue) * 100 : undefined;
  const figures: HeadlineFigure[] = [
    {
      label: "Revenue",
      value: fmtRandCompact(d.revenue, m),
      direction: revChange === undefined ? undefined : revChange >= 0 ? "up" : "down",
      good: revChange === undefined ? undefined : revChange >= 0,
      note:
        revChange !== undefined
          ? `${formatReportAmount(revChange, m, { style: "percent", percentPoints: true, sign: "always" })} vs prior`
          : undefined,
    },
    {
      label: "Gross Margin",
      value: fmtPct(d.gross_margin_pct),
      good: d.gross_margin_pct >= (metricDirection("Gross Margin")?.healthyMin ?? 0.32),
    },
    {
      label: "Operating Margin",
      value: fmtPct(d.operating_margin_pct),
      good: d.operating_margin_pct >= (metricDirection("Operating Margin")?.healthyMin ?? 0.16),
    },
    {
      label: "Net Profit",
      value: fmtRandCompact(d.net_profit, m),
      direction: prior ? (d.net_profit >= prior.net_profit ? "up" : "down") : undefined,
      good: d.net_profit >= 0 && (!prior || d.net_profit >= prior.net_profit),
      note: `${fmtPct(d.net_margin_pct)} of revenue`,
    },
  ];

  const narrative = profitabilityNarrative(
    {
      revenue: d.revenue,
      net_profit: d.net_profit,
      gross_margin_pct: d.gross_margin_pct,
      net_margin_pct: d.net_margin_pct,
      priorNetMargin: prior?.net_margin_pct,
    },
    operatingProfile,
    m,
  );

  return (
    <PDFDocument
      title={`Profitability Waterfall — ${smeData.name}`}
      subject="Profitability Waterfall Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      sample={sample}
      draft={!isDemo && !sample && !reviewSignoff}
      reviewSignoff={reviewSignoff}
      market={m}
    >
      {/* ── PAGE 1: Bridge ── */}
      <ReportTitle
        kicker={reportKicker("waterfall")}
        title="Profitability Waterfall"
        subtitle={`How each ${t("currencyWord", m)} of revenue becomes profit — and where it leaks away`}
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      <ReportSection
        heading={<SectionHeader title="Revenue-to-Profit Bridge" color={theme.accent} />}
        lead={<BridgeChart d={d} accent={theme.accent} />}
      />

      <ReportSection
        heading={<SectionHeader title="Margin Ladder" color={theme.accent} />}
        lead={<MarginLadder d={d} accent={theme.accent} />}
      />

      {/* ── PAGE 2: Comparison + ratios ── */}
      <View break>
        <ReportSection
          heading={<SectionHeader title="Current vs Prior Period" color={theme.accent} />}
          lead={
            prior ? (
              <ComparisonTable rows={compRows} accent={theme.accent} />
            ) : (
              <Text style={{ fontSize: 8, fontFamily: "Helvetica", color: C.muted, marginBottom: 10 }}>
                {NO_PRIOR_PERIOD}. Comparative claims are left off until a different period is on file.
              </Text>
            )
          }
        />

        <ReportSection
          heading={<SectionHeader title="Profit Pillar Ratio Analysis" color={theme.accent} />}
          lead={profitRatioRows.slice(0, 2).map((r, i) => (
            <RatioRow
              key={r.name}
              ratioName={r.name}
              formattedValue={r.value}
              healthScore={r.score}
              healthTier={scoreTier(r.score)}
              unscored={"unscored" in r && Boolean(r.unscored)}
              priorScore={r.prior}
              isAlternate={i % 2 === 1}
            />
          ))}
        >
          {profitRatioRows.slice(2).map((r, i) => (
            <RatioRow
              key={r.name}
              ratioName={r.name}
              formattedValue={r.value}
              healthScore={r.score}
              healthTier={scoreTier(r.score)}
              unscored={"unscored" in r && Boolean(r.unscored)}
              priorScore={r.prior}
              isAlternate={(i + 2) % 2 === 1}
            />
          ))}
        </ReportSection>
      </View>
    </PDFDocument>
  );
}
