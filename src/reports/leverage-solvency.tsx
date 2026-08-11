/**
 * LeverageSolvencyPDF — Leverage & Solvency Report.
 * Page 1: exec summary + funding structure visual + leverage ratio rows.
 * Page 2: debt facility breakdown + equity movement.
 *
 * SSR safety: Only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { scoreTier } from "@/lib/ratios";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { C, fmtRand, fmtRandCompact, fmtPct, resolveTheme } from "@/components/pdf/theme";
import { leverageNarrative } from "./narrative";
import type { ClientOperatingProfile } from "@/lib/client-profile";


// ── Types ──────────────────────────────────────────────────────────────────

export type DebtLine = {
  label: string;
  amount: number;
  annual_rate_pct: number;
  maturity_year: number;
};

export type LeverageSolvencyData = {
  total_debt: number;
  total_equity: number;
  /** Balance-sheet total assets — used when debt facilities are not captured. */
  total_assets: number;
  /** False when no debt schedule lines — total_debt is 0 and must not be read as “debt-free”. */
  debt_facilities_captured: boolean;
  net_profit: number;
  drawings: number;
  prior_equity: number;
  debt_lines: DebtLine[];
  health_scores: {
    fundingStructure: number | null;
    equityMultiplier: number | null;
    debtToEquity: number | null;
    debtToAssets: number | null;
    interestBurden: number | null;
  };
};

export type LeverageSolvencyPDFProps = {
  /** Owner operating profile — shapes narrative wording only. */
  operatingProfile?: ClientOperatingProfile | null;
  smeData: SmeData;
  data: LeverageSolvencyData;
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
};

// ── Funding structure bar ──────────────────────────────────────────────────

const fs = StyleSheet.create({
  barRow: { flexDirection: "row", height: 26, borderRadius: 5, overflow: "hidden", marginBottom: 8 },
  seg: { justifyContent: "center", paddingLeft: 10 },
  segText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.white },
  legend: { flexDirection: "row", gap: 18, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendLabel: { fontSize: 7, fontFamily: "Helvetica", color: C.muted },
  legendValue: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.ink },
});

function FundingBar({ debt, equity, accent }: { debt: number; equity: number; accent: string }) {
  const total = debt + equity || 1;
  const debtPct = debt / total;
  return (
    <View>
      <View style={fs.barRow}>
        <View style={[fs.seg, { flex: Math.max(0.0001, debtPct), backgroundColor: C.blueDeep }]}>
          {debtPct > 0.18 && <Text style={fs.segText}>Debt {fmtPct(debtPct)}</Text>}
        </View>
        <View style={[fs.seg, { flex: Math.max(0.0001, 1 - debtPct), backgroundColor: accent === C.blueDeep ? C.blue : accent }]}>
          {1 - debtPct > 0.18 && <Text style={fs.segText}>Equity {fmtPct(1 - debtPct)}</Text>}
        </View>
      </View>
      <View style={fs.legend}>
        <View style={fs.legendItem}>
          <View style={[fs.legendDot, { backgroundColor: C.blueDeep }]} />
          <Text style={fs.legendLabel}>Debt</Text>
          <Text style={fs.legendValue}>{fmtRand(debt)}</Text>
        </View>
        <View style={fs.legendItem}>
          <View style={[fs.legendDot, { backgroundColor: accent === C.blueDeep ? C.blue : accent }]} />
          <Text style={fs.legendLabel}>Equity</Text>
          <Text style={fs.legendValue}>{fmtRand(equity)}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Debt facilities table ──────────────────────────────────────────────────

const dt = StyleSheet.create({
  wrapper: { borderRadius: 5, overflow: "hidden", borderWidth: 0.75, borderColor: C.line, marginBottom: 10 },
  headerRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8 },
  headerCell: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: C.white, letterSpacing: 0.4, textTransform: "uppercase" },
  row: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 7.5, borderTopWidth: 0.5, borderTopColor: C.hairline },
  cell: { fontSize: 8, fontFamily: "Helvetica", color: C.body },
  totalRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 0.75, borderTopColor: C.line, backgroundColor: C.soft },
  totalCell: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink },
});

function DebtTable({ lines, accent }: { lines: DebtLine[]; accent: string }) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return (
    <View style={dt.wrapper}>
      <View style={[dt.headerRow, { backgroundColor: accent }]}>
        <Text style={[dt.headerCell, { flex: 2.5 }]}>Facility</Text>
        <Text style={[dt.headerCell, { flex: 1.3, textAlign: "right" }]}>Balance</Text>
        <Text style={[dt.headerCell, { flex: 1, textAlign: "right" }]}>Rate</Text>
        <Text style={[dt.headerCell, { flex: 1, textAlign: "right" }]}>Maturity</Text>
        <Text style={[dt.headerCell, { flex: 1, textAlign: "right" }]}>Share</Text>
      </View>
      {lines.map((l, i) => (
        <View key={i} style={[dt.row, { backgroundColor: i % 2 === 1 ? C.soft : C.white }]}>
          <Text style={[dt.cell, { flex: 2.5, fontFamily: "Helvetica-Bold", color: C.ink }]}>{l.label}</Text>
          <Text style={[dt.cell, { flex: 1.3, textAlign: "right" }]}>{fmtRand(l.amount)}</Text>
          <Text style={[dt.cell, { flex: 1, textAlign: "right" }]}>
            {l.annual_rate_pct > 0 ? `${l.annual_rate_pct.toFixed(1)}%` : "—"}
          </Text>
          <Text style={[dt.cell, { flex: 1, textAlign: "right" }]}>{l.maturity_year}</Text>
          <Text style={[dt.cell, { flex: 1, textAlign: "right" }]}>
            {total > 0 ? fmtPct(l.amount / total) : "—"}
          </Text>
        </View>
      ))}
      <View style={dt.totalRow}>
        <Text style={[dt.totalCell, { flex: 2.5 }]}>Total Debt</Text>
        <Text style={[dt.totalCell, { flex: 1.3, textAlign: "right" }]}>{fmtRand(total)}</Text>
        <Text style={{ flex: 3 }} />
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function LeverageSolvencyPDF({
  smeData,
  data: d,
  accountantProfile,
  isDemo,
  reviewSignoff,
  operatingProfile,
}: LeverageSolvencyPDFProps) {
  const theme = resolveTheme(accountantProfile);
  const hs = d.health_scores;
  const hasDebt = d.debt_facilities_captured;
  const totalAssets = d.total_assets > 0 ? d.total_assets : d.total_debt + d.total_equity;
  const debtToEquity = hasDebt && d.total_equity !== 0 ? d.total_debt / d.total_equity : NaN;
  const debtToAssets = hasDebt && totalAssets !== 0 ? d.total_debt / totalAssets : NaN;
  const equityMultiplier = d.total_equity !== 0 ? totalAssets / d.total_equity : NaN;
  const weightedRate =
    hasDebt && d.debt_lines.length > 0 && d.total_debt > 0
      ? d.debt_lines.reduce((s, l) => s + l.amount * l.annual_rate_pct, 0) / d.total_debt
      : NaN;
  const equityMovement = d.total_equity - d.prior_equity;
  const retained = d.net_profit - d.drawings;

  const figures: HeadlineFigure[] = [
    {
      label: "Debt-to-Equity",
      value: Number.isFinite(debtToEquity) ? `${debtToEquity.toFixed(2)}×` : "—",
      good: Number.isFinite(debtToEquity) ? debtToEquity <= 1.5 : undefined,
      note: hasDebt ? undefined : "Capture facilities first",
    },
    {
      label: "Total Debt",
      value: hasDebt ? fmtRandCompact(d.total_debt) : "—",
      note: hasDebt
        ? Number.isFinite(weightedRate)
          ? `avg. rate ${weightedRate.toFixed(1)}%`
          : undefined
        : "No facilities captured",
    },
    {
      label: "Total Equity",
      value: fmtRandCompact(d.total_equity),
      direction: equityMovement >= 0 ? "up" : "down",
      good: equityMovement >= 0,
      note: `${equityMovement >= 0 ? "+" : ""}${fmtRandCompact(equityMovement)} this period`,
    },
    {
      label: "Retained This Period",
      value: fmtRandCompact(retained),
      good: retained >= 0,
      note: "profit less drawings",
    },
  ];

  const narrative = leverageNarrative({
    debtToEquity: Number.isFinite(debtToEquity) ? debtToEquity : 0,
    totalDebt: hasDebt ? d.total_debt : 0,
    totalEquity: d.total_equity,
  }, operatingProfile);

  const ratioRows = [
    {
      name: "Funding Structure (Debt %)",
      value: Number.isFinite(debtToAssets) ? fmtPct(debtToAssets) : "—",
      score: hs.fundingStructure,
    },
    {
      name: "Equity Multiplier",
      value: Number.isFinite(equityMultiplier) ? `${equityMultiplier.toFixed(2)}×` : "n/m",
      score: hs.equityMultiplier,
    },
    {
      name: "Debt-to-Equity",
      value: Number.isFinite(debtToEquity) ? `${debtToEquity.toFixed(2)}×` : "—",
      score: hs.debtToEquity,
    },
    {
      name: "Debt-to-Assets",
      value: Number.isFinite(debtToAssets) ? fmtPct(debtToAssets) : "—",
      score: hs.debtToAssets,
    },
    {
      name: "Interest Burden",
      value: Number.isFinite(weightedRate) ? `${weightedRate.toFixed(1)}%` : "—",
      score: hs.interestBurden,
    },
  ].filter((r) => r.score != null) as Array<{ name: string; value: string; score: number }>;

  return (
    <PDFDocument
      title={`Leverage & Solvency — ${smeData.name}`}
      subject="Leverage & Solvency Report"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      reviewSignoff={reviewSignoff}
    >
      {/* ── PAGE 1 ── */}
      <ReportTitle
        kicker="Advisory Report 06"
        title="Leverage & Solvency"
        subtitle="How the business is funded, what the debt costs, and whether the structure is sustainable"
        isDemo={isDemo}
      />

      <ExecSummary figures={figures} narrative={narrative} />

      <SectionHeader title="Funding Structure" color={theme.accent} />
      {hasDebt ? (
        <FundingBar debt={d.total_debt} equity={d.total_equity} accent={theme.accent} />
      ) : (
        <Text style={{ fontSize: 8, color: C.muted, marginBottom: 8, fontFamily: "Helvetica" }}>
          No debt facilities captured on the client page — enter the schedule before quoting leverage totals.
        </Text>
      )}

      <SectionHeader title="Leverage Ratio Analysis" color={theme.accent} />
      {ratioRows.map((r, i) => (
        <RatioRow
          key={r.name}
          ratioName={r.name}
          formattedValue={r.value}
          healthScore={r.score}
          healthTier={scoreTier(r.score)}
          isAlternate={i % 2 === 1}
        />
      ))}

      {/* ── PAGE 2 ── */}
      <View break>
        <SectionHeader title="Debt Facility Breakdown" color={theme.accent} />
        {d.debt_lines.length > 0 ? (
          <DebtTable lines={d.debt_lines} accent={theme.accent} />
        ) : (
          <View
            style={{
              backgroundColor: C.soft,
              borderRadius: 5,
              borderWidth: 0.75,
              borderColor: C.line,
              padding: 16,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontSize: 8, fontFamily: "Helvetica", color: C.muted, lineHeight: 1.5 }}>
              No debt facilities captured yet. Enter the schedule on the client page — this report
              will not invent a debt total from assets minus equity.
            </Text>
          </View>
        )}

        <SectionHeader title="Equity Movement" color={theme.accent} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <MetricBox label="Opening Equity" value={fmtRand(d.prior_equity)} accentColor={theme.accent} />
          <MetricBox label="Net Profit" value={fmtRand(d.net_profit)} accentColor={C.green} />
          <MetricBox label="Drawings" value={`(${fmtRand(Math.abs(d.drawings))})`} accentColor={C.red} />
          <MetricBox
            label="Closing Equity"
            value={fmtRand(d.total_equity)}
            accentColor={equityMovement >= 0 ? C.green : C.red}
            note={`${equityMovement >= 0 ? "+" : ""}${fmtRandCompact(equityMovement)} movement`}
          />
        </View>
      </View>
    </PDFDocument>
  );
}
