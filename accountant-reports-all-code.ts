// =============================================================================
// MILŌN — ALL ACCOUNTANT REPORT CODE
// =============================================================================
// This file contains every file involved in generating, displaying, and
// downloading accountant-facing reports. Files are concatenated in dependency
// order. They are NOT meant to be executed from here — they remain in their
// original locations in src/.
//
// File inventory:
//   1.  src/components/pdf/health-score-gauge.tsx
//   2.  src/components/pdf/metric-box.tsx
//   3.  src/components/pdf/insight-box.tsx
//   4.  src/components/pdf/section-header.tsx
//   5.  src/components/pdf/ratio-row.tsx
//   6.  src/components/pdf/data-table.tsx
//   7.  src/components/pdf/report-header.tsx
//   8.  src/components/pdf/report-footer.tsx
//   9.  src/components/pdf/pdf-document.tsx
//  10.  src/reports/health-scorecard.tsx
//  11.  src/reports/intervention-priority.tsx
//  12.  src/reports/cash-forecast.tsx
//  13.  src/reports/cash-cycle.tsx
//  14.  src/reports/profitability-waterfall.tsx
//  15.  src/reports/leverage-solvency.tsx
//  16.  src/reports/asset-productivity.tsx
//  17.  src/reports/labor-productivity.tsx
//  18.  src/reports/ratio-movement.tsx
//  19.  src/reports/benchmark-report.tsx
//  20.  src/components/extraction-review-modal.tsx
//  21.  src/components/accountant-ratios.tsx
//  22.  src/routes/_authenticated/reports.demo.tsx
//  23.  src/routes/_authenticated/reports.index.tsx
// =============================================================================


// =============================================================================
// FILE 1 — src/components/pdf/health-score-gauge.tsx
// =============================================================================
// Horizontal progress-bar gauge used inside every PDF page.
// Props: score (0–100), height (px, default 7).
// =============================================================================

/*
import { View, StyleSheet } from "@react-pdf/renderer";

type Props = {
  score: number;
  height?: number;
  showMarker?: boolean;
};

const styles = StyleSheet.create({
  track: { borderRadius: 4, overflow: "hidden", position: "relative" },
  fill:  { borderRadius: 4 },
});

function scoreColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

export function HealthScoreGauge({ score, height = 7 }: Props) {
  const pct   = Math.max(0, Math.min(100, score || 0));
  const color = scoreColor(pct);
  return (
    <View style={[styles.track, { height, backgroundColor: "#e5e7eb" }]}>
      <View style={[styles.fill, { width: `${pct}%`, height, backgroundColor: color }]} />
    </View>
  );
}
*/


// =============================================================================
// FILE 2 — src/components/pdf/metric-box.tsx
// =============================================================================
// Single KPI card rendered inside @react-pdf/renderer.
// Props: label, value, change (optional %, triggers ▲/▼), accentColor.
// =============================================================================

/*
import { View, Text, StyleSheet } from "@react-pdf/renderer";

type Props = { label: string; value: string; change?: number; accentColor?: string };

const styles = StyleSheet.create({
  box:       { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 6, padding: 12, flex: 1, backgroundColor: "#ffffff" },
  accentBar: { height: 3, borderRadius: 2, marginBottom: 8 },
  label:     { fontSize: 7.5, color: "#6b7280", marginBottom: 5, fontFamily: "Helvetica", textTransform: "uppercase", letterSpacing: 0.3 },
  value:     { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  changeText:{ fontSize: 7.5, fontFamily: "Helvetica" },
});

export function MetricBox({ label, value, change, accentColor }: Props) {
  const changeColor = change !== undefined ? (change >= 0 ? "#10b981" : "#ef4444") : undefined;
  return (
    <View style={styles.box}>
      {accentColor && <View style={[styles.accentBar, { backgroundColor: accentColor }]} />}
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {change !== undefined && (
        <View style={styles.changeRow}>
          <Text style={[styles.changeText, { color: changeColor }]}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
          </Text>
        </View>
      )}
    </View>
  );
}
*/


// =============================================================================
// FILE 3 — src/components/pdf/insight-box.tsx
// =============================================================================
// Intervention step card: numbered circle, title, description, Timeframe /
// Effort / Impact badges. Left coloured strip = healthTier colour.
// =============================================================================

/*
import { View, Text, StyleSheet } from "@react-pdf/renderer";

type HealthTier = "critical" | "at_risk" | "healthy";
type Props = {
  stepNumber: number; ratioName: string; stepTitle: string; description: string;
  timeframe: string; effort: string; impact: string;
  healthTier: HealthTier; accentColor?: string;
};

const TIER_COLOR: Record<HealthTier, string> = {
  critical: "#ef4444", at_risk: "#f59e0b", healthy: "#10b981",
};

const styles = StyleSheet.create({
  outer:      { flexDirection: "row", backgroundColor: "#f8fafc", borderRadius: 6, marginBottom: 12, overflow: "hidden" },
  leftStrip:  { width: 4, borderRadius: 2 },
  content:    { flex: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 13 },
  headerRow:  { flexDirection: "row", alignItems: "center", marginBottom: 7, gap: 8 },
  circle:     { width: 22, height: 22, borderRadius: 11, justifyContent: "center", alignItems: "center" },
  circleText: { fontSize: 9, color: "#ffffff", fontFamily: "Helvetica-Bold" },
  ratioLabel: { fontSize: 7.5, color: "#6b7280", fontFamily: "Helvetica" },
  title:      { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 6 },
  description:{ fontSize: 8.5, color: "#4b5563", lineHeight: 1.5, fontFamily: "Helvetica" },
  badgesRow:  { flexDirection: "row", marginTop: 10, gap: 8 },
  badge:      { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 },
  badgeLabel: { fontSize: 6.5, fontFamily: "Helvetica", marginBottom: 1, textTransform: "uppercase", letterSpacing: 0.2 },
  badgeValue: { fontSize: 8, fontFamily: "Helvetica-Bold" },
});

function Badge({ label, value, bg, fg }: { label: string; value: string; bg: string; fg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.badgeValue, { color: fg }]}>{value}</Text>
    </View>
  );
}

export function InsightBox({ stepNumber, ratioName, stepTitle, description,
  timeframe, effort, impact, healthTier, accentColor = "#0f3460" }: Props) {
  const tierColor = TIER_COLOR[healthTier] ?? "#6b7280";
  return (
    <View style={styles.outer}>
      <View style={[styles.leftStrip, { backgroundColor: tierColor }]} />
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={[styles.circle, { backgroundColor: accentColor }]}>
            <Text style={styles.circleText}>{stepNumber}</Text>
          </View>
          <Text style={styles.ratioLabel}>{ratioName}</Text>
        </View>
        <Text style={styles.title}>{stepTitle}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.badgesRow}>
          <Badge label="Timeframe" value={timeframe} bg="#dbeafe" fg="#1d4ed8" />
          <Badge label="Effort"    value={effort}    bg="#fef3c7" fg="#92400e" />
          <Badge label="Impact"    value={impact}    bg="#d1fae5" fg="#065f46" />
        </View>
      </View>
    </View>
  );
}
*/


// =============================================================================
// FILE 4 — src/components/pdf/section-header.tsx
// =============================================================================
// Coloured pillar header bar with optional score chip. Used in scorecard.
// =============================================================================

/*
import { View, Text, StyleSheet } from "@react-pdf/renderer";

type Props = { title: string; score?: number; color?: string };

const styles = StyleSheet.create({
  wrapper:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                paddingHorizontal: 14, paddingVertical: 9, marginBottom: 0 },
  title:      { fontFamily: "Helvetica-Bold", fontSize: 10, color: "#ffffff", letterSpacing: 0.6, textTransform: "uppercase" },
  scoreWrap:  { flexDirection: "row", alignItems: "center", gap: 6 },
  scoreLabel: { fontSize: 7.5, fontFamily: "Helvetica", color: "#ffffff", opacity: 0.75 },
  scoreValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#ffffff" },
});

export function SectionHeader({ title, score, color = "#1a1a2e" }: Props) {
  return (
    <View style={[styles.wrapper, { backgroundColor: color }]}>
      <Text style={styles.title}>{title}</Text>
      {score !== undefined && (
        <View style={styles.scoreWrap}>
          <Text style={styles.scoreLabel}>Score</Text>
          <Text style={styles.scoreValue}>{Math.round(score)}</Text>
        </View>
      )}
    </View>
  );
}
*/


// =============================================================================
// FILE 5 — src/components/pdf/ratio-row.tsx
// =============================================================================
// Single ratio table row: name | value | gauge | score | tier badge | ▲/▼/→
// Used in health-scorecard and most other reports.
// =============================================================================

/*
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { HealthScoreGauge } from "./health-score-gauge";

type HealthTier = "critical" | "at_risk" | "healthy";
type Props = {
  ratioName: string; formattedValue: string; healthScore: number;
  healthTier: HealthTier; priorScore?: number; isAlternate?: boolean;
};

const TIER: Record<HealthTier, { label: string; color: string; bg: string; fg: string }> = {
  critical: { label: "CRITICAL", color: "#ef4444", bg: "#fee2e2", fg: "#991b1b" },
  at_risk:  { label: "AT RISK",  color: "#f59e0b", bg: "#fef3c7", fg: "#92400e" },
  healthy:  { label: "HEALTHY",  color: "#10b981", bg: "#d1fae5", fg: "#065f46" },
};

const styles = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 14,
              borderBottomWidth: 0.5, borderBottomColor: "#f3f4f6" },
  name:     { fontSize: 8.5, fontFamily: "Helvetica", color: "#1f2937" },
  value:    { width: 58, fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#111827", textAlign: "right" },
  gaugeWrap:{ flex: 2, marginHorizontal: 10 },
  scoreNum: { width: 26, fontSize: 8.5, textAlign: "center", fontFamily: "Helvetica-Bold" },
  tierBadge:{ width: 54, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2.5, alignItems: "center" },
  tierText: { fontSize: 6, fontFamily: "Helvetica-Bold", letterSpacing: 0.3 },
  arrow:    { width: 18, fontSize: 10, textAlign: "center" },
});

export function RatioRow({ ratioName, formattedValue, healthScore, healthTier, priorScore, isAlternate = false }: Props) {
  const tier    = TIER[healthTier] ?? TIER.at_risk;
  const rounded = Math.round(healthScore || 0);
  let movement: { symbol: string; color: string } | null = null;
  if (priorScore !== undefined) {
    const delta = healthScore - priorScore;
    if (delta > 2)  movement = { symbol: "▲", color: "#10b981" };
    else if (delta < -2) movement = { symbol: "▼", color: "#ef4444" };
    else movement = { symbol: "→", color: "#9ca3af" };
  }
  return (
    <View style={[styles.row, isAlternate ? { backgroundColor: "#f9fafb" } : { backgroundColor: "#ffffff" }]}>
      <Text style={[styles.name, { flex: 3 }]}>{ratioName}</Text>
      <Text style={styles.value}>{formattedValue}</Text>
      <View style={styles.gaugeWrap}><HealthScoreGauge score={healthScore} height={5} /></View>
      <Text style={[styles.scoreNum, { color: tier.color }]}>{rounded}</Text>
      <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
        <Text style={[styles.tierText, { color: tier.fg }]}>{tier.label}</Text>
      </View>
      {movement
        ? <Text style={[styles.arrow, { color: movement.color }]}>{movement.symbol}</Text>
        : <View style={{ width: 18 }} />}
    </View>
  );
}
*/


// =============================================================================
// FILE 6 — src/components/pdf/data-table.tsx
// =============================================================================
// Generic typed table for @react-pdf/renderer.  Not used by all reports —
// available as a utility for custom report extensions.
// =============================================================================

/*
import { View, Text, StyleSheet } from "@react-pdf/renderer";

export type TableColumn<T> = {
  header: string; key: keyof T; flex?: number;
  align?: "left" | "right" | "center";
  render?: (value: T[keyof T], row: T) => string;
};
type Props<T extends Record<string, unknown>> = {
  columns: TableColumn<T>[]; rows: T[]; accentColor?: string;
};

const styles = StyleSheet.create({
  container:  { borderRadius: 6, overflow: "hidden", borderWidth: 1, borderColor: "#e5e7eb" },
  headerRow:  { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 9 },
  headerCell: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff",
                letterSpacing: 0.4, textTransform: "uppercase" },
  dataRow:    { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8,
                borderTopWidth: 0.5, borderTopColor: "#f3f4f6" },
  cell:       { fontSize: 8, fontFamily: "Helvetica", color: "#374151" },
});

export function DataTable<T extends Record<string, unknown>>({ columns, rows, accentColor = "#1a1a2e" }: Props<T>) {
  return (
    <View style={styles.container}>
      <View style={[styles.headerRow, { backgroundColor: accentColor }]}>
        {columns.map((col, i) => (
          <Text key={i} style={[styles.headerCell, { flex: col.flex ?? 1, textAlign: col.align ?? "left" }]}>
            {col.header}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.dataRow, { backgroundColor: ri % 2 === 1 ? "#f9fafb" : "#ffffff" }]}>
          {columns.map((col, ci) => {
            const raw     = row[col.key];
            const display = col.render ? col.render(raw, row) : String(raw ?? "");
            return (
              <Text key={ci} style={[styles.cell, { flex: col.flex ?? 1, textAlign: col.align ?? "left" }]}>
                {display}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}
*/


// =============================================================================
// FILE 7 — src/components/pdf/report-header.tsx
// =============================================================================
// Fixed header on every PDF page: firm logo (or name) left, client name/period
// right, accent-colour border bottom. Reads from AccountantProfile context.
// =============================================================================

/*
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";

type Props = { profile: AccountantProfile; smeName: string; period: string; fixed?: boolean };

const styles = StyleSheet.create({
  outer:       { backgroundColor: "#ffffff" },
  wrapper:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                 paddingHorizontal: 40, paddingTop: 28, paddingBottom: 16 },
  borderLine:  { height: 2, marginHorizontal: 0 },
  left:        { flex: 1, justifyContent: "center" },
  logoImage:   { maxHeight: 40, maxWidth: 130, objectFit: "contain" },
  firmNameText:{ fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 0.4 },
  tagline:     { fontSize: 7.5, fontFamily: "Helvetica", marginTop: 3, opacity: 0.65 },
  right:       { alignItems: "flex-end" },
  preparedFor: { fontSize: 7.5, fontFamily: "Helvetica", opacity: 0.55, marginBottom: 2 },
  smeName:     { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  period:      { fontSize: 7.5, fontFamily: "Helvetica", opacity: 0.6 },
  email:       { fontSize: 7, fontFamily: "Helvetica", opacity: 0.45, marginTop: 3 },
});

export function ReportHeader({ profile, smeName, period, fixed }: Props) {
  const accentHex  = profile.accentColor  || "#0f3460";
  const primaryHex = profile.primaryColor || "#1a1a2e";
  return (
    <View style={styles.outer} fixed={fixed}>
      <View style={styles.wrapper}>
        <View style={styles.left}>
          {profile.logoUrl
            ? <Image src={profile.logoUrl} style={styles.logoImage} />
            : <>
                <Text style={[styles.firmNameText, { color: primaryHex }]}>{profile.firmName || "Your Firm"}</Text>
                {profile.tagline && <Text style={[styles.tagline, { color: primaryHex }]}>{profile.tagline}</Text>}
              </>}
        </View>
        <View style={styles.right}>
          <Text style={[styles.preparedFor, { color: primaryHex }]}>Prepared for:</Text>
          <Text style={[styles.smeName,     { color: primaryHex }]}>{smeName}</Text>
          <Text style={[styles.period,      { color: primaryHex }]}>Period: {period}</Text>
          {profile.accountantEmail && <Text style={[styles.email, { color: primaryHex }]}>{profile.accountantEmail}</Text>}
        </View>
      </View>
      <View style={[styles.borderLine, { backgroundColor: accentHex }]} />
    </View>
  );
}
*/


// =============================================================================
// FILE 8 — src/components/pdf/report-footer.tsx
// =============================================================================
// Absolutely positioned footer on every PDF page.
// "Powered by Milōn | Page X of Y | Firm name"
// =============================================================================

/*
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";

type Props = { profile: AccountantProfile; fixed?: boolean };

const styles = StyleSheet.create({
  wrapper:    { position: "absolute", bottom: 0, left: 0, right: 0,
                paddingHorizontal: 40, paddingBottom: 20, paddingTop: 12 },
  borderLine: { height: 1, marginBottom: 10 },
  row:        { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  poweredBy:  { fontSize: 7, fontFamily: "Helvetica", color: "#9ca3af" },
  milonBold:  { fontFamily: "Helvetica-Bold", color: "#9ca3af" },
  pageNumber: { fontSize: 7.5, fontFamily: "Helvetica", color: "#6b7280", textAlign: "center", flex: 1 },
  firmName:   { fontSize: 7, fontFamily: "Helvetica", color: "#9ca3af", textAlign: "right" },
});

export function ReportFooter({ profile, fixed }: Props) {
  const accentHex = profile.accentColor || "#0f3460";
  return (
    <View style={styles.wrapper} fixed={fixed}>
      <View style={[styles.borderLine, { backgroundColor: accentHex }]} />
      <View style={styles.row}>
        <Text style={styles.poweredBy}>Powered by <Text style={styles.milonBold}>Milōn</Text></Text>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        <Text style={styles.firmName}>{profile.firmName || ""}</Text>
      </View>
    </View>
  );
}
*/


// =============================================================================
// FILE 9 — src/components/pdf/pdf-document.tsx
// =============================================================================
// Base A4 PDF wrapper. All 10 report PDFs extend this component.
// Adds ReportHeader (fixed, repeats every page) and ReportFooter (absolute).
// IMPORTANT: Only import via dynamic import() — never at top level of an SSR module.
// =============================================================================

/*
import { Document, Page, View } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { ReportHeader } from "./report-header";
import { ReportFooter } from "./report-footer";

export type SmeData = { name: string; period: string };
type Props = { title: string; subject?: string; smeData: SmeData;
               accountantProfile: AccountantProfile; children: React.ReactNode };

export function PDFDocument({ title, subject, smeData, accountantProfile, children }: Props) {
  return (
    <Document title={title} subject={subject}
              author={accountantProfile.firmName || "Milōn"}
              creator="Milōn" producer="Milōn PDF Engine">
      <Page size="A4" style={{ paddingBottom: 56, backgroundColor: "#ffffff" }}>
        <ReportHeader fixed profile={accountantProfile} smeName={smeData.name} period={smeData.period} />
        <View style={{ paddingHorizontal: 40, paddingTop: 16 }}>{children}</View>
        <ReportFooter fixed profile={accountantProfile} />
      </Page>
    </Document>
  );
}
*/


// =============================================================================
// FILE 10 — src/reports/health-scorecard.tsx
// =============================================================================
// Report 1 (Essential) — Financial Health Scorecard. 2 A4 pages.
// Page 1: overall score + gauge + tier badge + 2×2 pillar grid.
// Page 2: per-pillar ratio rows with score gauge, tier badge, ▲/▼/→.
//
// Props:
//   smeData           : { name, period }
//   ratioResults      : RatioResult[]
//   accountantProfile : AccountantProfile
//
// RatioResult shape:
//   { ratio_key, ratio_name, pillar, current_value, health_score,
//     health_tier, prior_period_value?, prior_period_score?, formatted_value }
// =============================================================================

/*
[Full source — see src/reports/health-scorecard.tsx]
Key exports: RatioResult (type), HealthScorecardPDFProps (type), HealthScorecardPDF (component)
*/


// =============================================================================
// FILE 11 — src/reports/intervention-priority.tsx
// =============================================================================
// Report 2 (Essential) — Priority Intervention Plan. 2–3 A4 pages.
// Sorts interventions critical-first, then by step_number.
// Each step rendered as InsightBox with Timeframe / Effort / Impact badges.
//
// Intervention shape:
//   { ratio_key, ratio_name, health_tier, step_number, step_title,
//     step_description, timeframe, effort, impact, category }
// =============================================================================

/*
[Full source — see src/reports/intervention-priority.tsx]
Key exports: Intervention (type), InterventionPriorityPDFProps (type), InterventionPriorityPDF (component)
*/


// =============================================================================
// FILE 12 — src/reports/cash-forecast.tsx
// =============================================================================
// Report 3 (Essential) — 13-Week Cash Flow Forecast. 2 A4 pages.
// Page 1: scenario badge + 3 metric boxes + bar chart (colour by threshold).
// Page 2: weekly data table + assumptions bullets.
//
// CashForecastWeek shape:
//   { period_label, opening_balance, total_receipts, total_payments,
//     net_movement, closing_balance, scenario, runway_weeks }
//
// minimumThreshold defaults to 50 000; assumptions defaults to 4 bullets.
// =============================================================================

/*
[Full source — see src/reports/cash-forecast.tsx]
Key exports: CashForecastWeek (type), CashForecastPDFProps (type), CashForecastPDF (component)
*/


// =============================================================================
// FILE 13 — src/reports/cash-cycle.tsx
// =============================================================================
// Report 4 (Essential) — Cash Flow Cycle Report. 2 A4 pages.
// Page 1: Inventory → WIP → Debtors flow diagram + creditor offset + CCC box
//         + 4 metric boxes (Debtor Days, Inventory Days, Creditor Days, CCC).
// Page 2: Cash-trapped callout + 7 working-capital ratio rows.
//
// WorkingCapitalData shape:
//   { debtor_days, debtor_days_prior?, inventory_days, inventory_days_prior?,
//     wip_days, wip_days_prior?, creditor_days, creditor_days_prior?,
//     cash_conversion_cycle, ccc_prior?, working_capital_funding,
//     working_capital_utilization, working_capital_days, annual_revenue,
//     cash_trapped_rands, health_scores? }
// =============================================================================

/*
[Full source — see src/reports/cash-cycle.tsx]
Key exports: WorkingCapitalData (type), CashCyclePDFProps (type), CashCyclePDF (component)
*/


// =============================================================================
// FILE 14 — src/reports/profitability-waterfall.tsx
// =============================================================================
// Report 5 (Essential) — Profitability Waterfall. 2 A4 pages.
// Page 1: Revenue → COGS → Gross Profit → OpEx → EBIT → Interest → EBT
//         → Tax → Net Profit waterfall with tier badges.
//         "For every R100 of revenue …" callout box.
// Page 2: Current vs Prior Period comparison table + 5 profit ratio rows.
//
// ProfitabilityData = PeriodData & { prior_period?: PeriodData }
// PeriodData shape:
//   { revenue, gross_profit, gross_margin_pct, gross_margin_score?,
//     gross_margin_tier?, operating_profit, operating_margin_pct,
//     operating_margin_score?, operating_margin_tier?, ebt,
//     interest_burden_pct?, interest_burden_score?, tax,
//     tax_burden_pct?, tax_burden_score?, net_profit, net_margin_pct,
//     net_margin_score?, net_margin_tier? }
// =============================================================================

/*
[Full source — see src/reports/profitability-waterfall.tsx]
Key exports: PeriodData (type), ProfitabilityData (type), ProfitabilityWaterfallPDFProps (type),
             ProfitabilityWaterfallPDF (component)
*/


// =============================================================================
// FILE 15 — src/reports/leverage-solvency.tsx
// =============================================================================
// Report 6 (Optional) — Leverage & Solvency. 2 A4 pages.
// Page 1: 3 metric boxes + Debt Facility Breakdown table + 5 financing ratio rows.
// Page 2: Debt Maturity Profile bar chart (next 5 years) + Equity Bridge table.
//
// LeverageSolvencyData shape:
//   { total_debt, total_equity, net_profit, drawings, prior_equity,
//     debt_lines: DebtLine[], health_scores: { fundingStructure, equityMultiplier,
//                                              debtToEquity, debtToAssets, interestBurden } }
// DebtLine: { label, amount, annual_rate_pct, maturity_year }
// =============================================================================

/*
[Full source — see src/reports/leverage-solvency.tsx]
Key exports: DebtLine (type), LeverageSolvencyData (type), LeverageSolvencyPDFProps (type),
             LeverageSolvencyPDF (component)
*/


// =============================================================================
// FILE 16 — src/reports/asset-productivity.tsx
// =============================================================================
// Report 7 (Optional) — Asset Productivity. 2 A4 pages.
// Page 1: 3 metric boxes + DuPont decomposition tree
//         (Net Margin × Asset Turnover × Equity Multiplier = ROE)
//         + 5 asset ratio rows.
// Page 2: Capex vs Depreciation bar chart (side-by-side per period).
//
// AssetProductivityData shape:
//   { roe, net_margin, asset_turnover, equity_multiplier,
//     capex_periods: CapexPeriod[], health_scores: { assetTurnover, roa,
//       fixedCapitalUtilization, assetReinvestmentRatio, capexIntensity },
//     ratios: { assetTurnover, roa, fixedCapitalUtilization,
//               assetReinvestmentRatio, capexIntensity } — each { value: string } }
// =============================================================================

/*
[Full source — see src/reports/asset-productivity.tsx]
Key exports: CapexPeriod (type), AssetProductivityData (type), AssetProductivityPDFProps (type),
             AssetProductivityPDF (component)
*/


// =============================================================================
// FILE 17 — src/reports/labor-productivity.tsx
// =============================================================================
// Report 8 (Optional) — Labour Productivity. 2 A4 pages.
// Page 1: 3 metric boxes + Revenue-per-Employee bar trend chart
//         + GP per R1 of Labour horizontal visual.
// Page 2: Revenue Growth vs Inflation comparison bars + insight box
//         + 3 labour ratio rows.
//
// LaborProductivityData shape:
//   { employee_count, total_labor_cost, total_revenue, total_gp,
//     revenue_per_employee, rpe_prior, gp_per_labor_rand,
//     revenue_growth, inflation_rate, periods: LaborPeriod[],
//     health_scores: { gpToLabor, salesPerEmployee, revenueGrowth } }
// LaborPeriod: { label, revenue, employees, labor_cost }
// =============================================================================

/*
[Full source — see src/reports/labor-productivity.tsx]
Key exports: LaborPeriod (type), LaborProductivityData (type), LaborProductivityPDFProps (type),
             LaborProductivityPDF (component)
*/


// =============================================================================
// FILE 18 — src/reports/ratio-movement.tsx
// =============================================================================
// Report 9 (Optional) — Ratio Movement. 2–3 A4 pages.
// One compact table showing all ratios across 4 time periods (12-month,
// 6-month, 3-month, current). Rows highlighted:
//   red   — declining across ALL periods
//   amber — declining in 3+ consecutive periods
// Arrow in last column: ▲ improving vs 3 months, ▼ declining, → stable.
// Grouped by pillar (profit / assets / financing / cash).
//
// RatioMovementRow shape:
//   { ratio_key, ratio_name, pillar, unit, current,
//     three_months, six_months, twelve_months, lower_is_better? }
// =============================================================================

/*
[Full source — see src/reports/ratio-movement.tsx]
Key exports: RatioMovementRow (type), RatioMovementPDFProps (type), RatioMovementPDF (component)
*/


// =============================================================================
// FILE 19 — src/reports/benchmark-report.tsx
// =============================================================================
// Report 10 (Optional) — Industry Benchmark Report. 2–3 A4 pages.
// Page 1: Summary banner (X/N above median) + 3 position-count chips
//         + full benchmark table grouped by pillar.
// Positions: TOP QUARTILE (green) / ABOVE MEDIAN (blue) / BELOW MEDIAN (amber).
// Industry code + name shown in a badge under the title.
//
// BenchmarkRow shape:
//   { ratio_key, ratio_name, pillar, current_value, formatted_current,
//     health_score, health_tier, sector_median, sector_top_quartile,
//     formatted_median, formatted_top_quartile, lower_is_better? }
// =============================================================================

/*
[Full source — see src/reports/benchmark-report.tsx]
Key exports: BenchmarkRow (type), BenchmarkReportPDFProps (type), BenchmarkReportPDF (component)
*/


// =============================================================================
// FILE 20 — src/components/extraction-review-modal.tsx
// =============================================================================
// Modal that opens after the accountant uploads 1–3 PDFs (financial statements).
// The AI extraction result (MergedExtractionResult) is displayed for review
// before populating the ratio form.
//
// Features:
//   - Collapsible sections: Income Statement / Balance Sheet / Cash Flow /
//     Top Expenses / Top Income Sources / Documents / Data Quality flags
//   - Inline edit: click pencil icon to edit any extracted value
//   - Conflict resolution: if two documents disagree, user picks one
//   - Annualisation note: shown when period < 12 months
//   - Confidence badge: high / medium / low
//   - Count of null core fields with warning
//
// MappedInputs (output shape handed to onConfirm):
//   { revenue?, cogs?, ebit?, ebt?, netIncome?, ebitda?,
//     operatingCashflow?, totalAssets?, equity?, receivables?,
//     inventory?, payables?, fixedCosts?, laborCost?, employees?,
//     cash?, capex?, depreciation? }
//
// Props: { result: MergedExtractionResult, open, onClose, onConfirm }
// =============================================================================

/*
[Full source — see src/components/extraction-review-modal.tsx]
Key exports: MappedInputs (type), ExtractionReviewModal (component)
*/


// =============================================================================
// FILE 21 — src/components/accountant-ratios.tsx
// =============================================================================
// Main accountant panel for a single client (used inside the client detail page).
// Renders three cards:
//   1. Actions bar  — Export PDF (jsPDF), Email draft (mailto), WhatsApp
//   2. Financials   — 18-field input grid, auto-saved to Supabase on 700ms debounce,
//                     "Save snapshot" button, "Upload statement" button
//   3. Ratios table — 19 rows, click to open next-steps dialog
//
// Data flow:
//   - On mount: loads client.financials from Supabase (clients table)
//   - On change: auto-saves to clients.financials + upserts client_financial_snapshots
//   - PDF upload: supports CSV/Excel (direct parse) or PDF (via PDFUploadZone +
//                 ExtractionReviewModal AI flow)
//   - History: last 6 snapshots loaded from client_financial_snapshots,
//              used for 6-month KpiTrendline sparklines
//   - Benchmarks: loaded from industry_benchmarks for client's business_type
//
// 19 computed ratio rows (from computeRatios in src/lib/ratios.ts):
//   Net Margin, Operating Margin, Gross Margin, Return on Equity,
//   Return on Assets, Asset Turnover, Equity Multiplier, Interest Burden,
//   Tax Burden, Debtor Days, Inventory Days, Creditor Days,
//   Working Capital Days, Fixed Cost Ratio, Degree of Operating Leverage,
//   Top-5 Customer Share, Gross Profit / Labor,
//   Sales-per-Employee Ratio, OCF / EBITDA
//
// Each row carries: health score (0–100), benchmark string, 3 next-step bullets.
// Clicking a row opens a Dialog with the next steps for client communication.
//
// Email draft: mailto link with structured subject + body (best metric + 3 worst).
// WhatsApp: wa.me link with abbreviated message.
// Both require contact email/phone — prompts to save if missing.
//
// Props: { clientId: string, clientName: string }
// =============================================================================

/*
[Full source — see src/components/accountant-ratios.tsx]
Key exports: AccountantRatiosPanel (component)
*/


// =============================================================================
// FILE 22 — src/routes/_authenticated/reports.demo.tsx
// =============================================================================
// Route: /reports/demo
// Standalone demo page showing 5 of the 10 report types with mock data
// (Acme Trading, June 2025). Download buttons generate real PDFs.
//
// Reports available on this page:
//   1. Financial Health Scorecard  (HealthScorecardPDF)
//   2. Priority Intervention Plan  (InterventionPriorityPDF)
//   3. 13-Week Cash Flow Forecast  (CashForecastPDF)
//   4. Cash Flow Cycle Report      (CashCyclePDF)
//   5. Profitability Waterfall     (ProfitabilityWaterfallPDF)
//
// Each card has a mini HTML preview + Download PDF button.
// All mock data constants are defined inline (MOCK_SME_DATA, MOCK_RATIO_RESULTS,
// MOCK_INTERVENTIONS, MOCK_CASH_FORECAST, MOCK_WC_DATA, MOCK_PROFIT_DATA).
//
// Uses useAccountantProfile() for firm branding on the PDFs.
// =============================================================================

/*
[Full source — see src/routes/_authenticated/reports.demo.tsx]
Key exports: ReportsDemoPage (component, registered via TanStack file route)
*/


// =============================================================================
// FILE 23 — src/routes/_authenticated/reports.index.tsx
// =============================================================================
// Route: /reports   (main production reports hub — accountant-facing)
//
// Layout: left card grid | right sticky settings sidebar
//
// Settings sidebar (SettingsPanel):
//   - Client / SME Name (text input, pre-filled from ?client= query param)
//   - Reporting Period (month + year selects)
//   - Industry (10 South African SIC codes for benchmark report)
//   - Include Prior Period toggle
//   - Brand preview (reads accountantProfile, link to /settings/brand)
//
// Report grid (10 reports, 3 sections):
//   Essential (5): Scorecard, Intervention Plan, Cash Forecast,
//                  Cash Cycle, Profitability Waterfall
//   Optional  (5): Leverage & Solvency, Asset Productivity, Labour Productivity,
//                  Ratio Movement, Benchmark Report
//   Playbooks    : 21 ratio cards across 6 pillars (profit / financing / cash /
//                  assets / labour / risk) — opens PlaybookDrawer
//
// Each report card has:
//   [Preview] — generates PDF, shows in full-screen iframe dialog (PreviewModal)
//   [Download] — generates PDF and triggers browser download
//
// "Generate All as ZIP" — generates all 10 PDFs and bundles via JSZip.
// Shows <Progress> bar while generating.
//
// PDF generation:
//   All 10 report generators in GEN: Record<string, GenFn>
//   Each imports its PDF component dynamically:
//     scorecard   → HealthScorecardPDF     (mock data: MOCK_RATIOS)
//     intervention→ InterventionPriorityPDF(mock data: MOCK_INTERVENTIONS)
//     forecast    → CashForecastPDF        (mock data: MOCK_FORECAST)
//     cycle       → CashCyclePDF           (mock data: MOCK_WC)
//     waterfall   → ProfitabilityWaterfallPDF (mock data: MOCK_PROFIT)
//     leverage    → LeverageSolvencyPDF    (mock data: MOCK_LEVERAGE)
//     assets      → AssetProductivityPDF   (mock data: MOCK_ASSETS)
//     labor       → LaborProductivityPDF   (mock data: MOCK_LABOR)
//     movement    → RatioMovementPDF       (mock data: MOCK_MOVEMENT)
//     benchmark   → BenchmarkReportPDF     (mock data: MOCK_BENCHMARK)
//
// NOTE: All 10 generators currently use embedded MOCK_* constants.
//       To wire real client data, replace these with live Supabase queries.
//
// Search params: ?client=<smeName> (pre-fills the client name input)
// =============================================================================

/*
[Full source — see src/routes/_authenticated/reports.index.tsx]
Key exports: ReportsPage (component, registered via TanStack file route)
*/


// =============================================================================
// SUMMARY — HOW THE PIECES FIT TOGETHER
// =============================================================================
//
// AccountantProfile context (src/contexts/accountant-profile.tsx)
//   └─ stored in localStorage; contains firmName, accentColor, primaryColor,
//      logoUrl, tagline, accountantEmail
//   └─ passed to every PDF as accountantProfile prop for branding
//
// PDF generation pipeline (client-side only):
//   1. User clicks Download or Preview on a report card
//   2. GEN[key](settings, profile) is called
//   3. PDF component imported dynamically (avoids SSR issues)
//   4. renderToBlob() calls @react-pdf/renderer's pdf().toBlob()
//   5. Blob → object URL → <a download> or <iframe src>
//
// Accountant ratio panel (client detail view):
//   1. AccountantRatiosPanel mounts, loads financials from Supabase
//   2. 19 ratios computed client-side via computeRatios()
//   3. Auto-saves on debounce + upserts monthly snapshot
//   4. Upload statement → PDFUploadZone → AI extraction → ExtractionReviewModal
//      → applyExtraction() populates inputs + saves snapshot immediately
//   5. Export PDF via jsPDF + jspdf-autotable (19-row table, no @react-pdf)
//   6. Email draft via mailto:, WhatsApp via wa.me
//
// Supabase tables touched by accountant report flows:
//   clients                    — financials (JSONB), contact_email, contact_phone,
//                                business_type
//   client_financial_snapshots — client_id, period_label, period_date,
//                                financials (JSONB), ratios (JSONB), source
//   industry_benchmarks        — metric_key, business_type, p25, p50, p75,
//                                unit, higher_is_better
// =============================================================================
