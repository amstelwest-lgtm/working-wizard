/**
 * LeverageSolvencyPDF — Leverage & Solvency Report.
 * Page 1: Debt summary + breakdown table + 5 financing ratio rows.
 * Page 2: Debt maturity bar chart + equity bridge.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { MetricBox } from "@/components/pdf/metric-box";
import { RatioRow } from "@/components/pdf/ratio-row";

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
  net_profit: number;
  drawings: number;
  prior_equity: number;
  debt_lines: DebtLine[];
  health_scores: {
    fundingStructure: number;
    equityMultiplier: number;
    debtToEquity: number;
    debtToAssets: number;
    interestBurden: number;
  };
};

export type LeverageSolvencyPDFProps = {
  smeData: SmeData;
  data: LeverageSolvencyData;
  accountantProfile: AccountantProfile;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRand(v: number): string {
  const abs = Math.abs(Math.round(v));
  return (v < 0 ? "-R " : "R ") + abs.toLocaleString("en-ZA");
}

function scoreTier(s: number): "critical" | "at_risk" | "healthy" {
  return s >= 70 ? "healthy" : s >= 40 ? "at_risk" : "critical";
}

// ── Styles ─────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111827", marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#6b7280", fontFamily: "Helvetica", marginBottom: 16 },
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  sectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 16, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  // Debt table
  tblHeader: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 7 },
  tblHCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  tblRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "#f3f4f6" },
  tblCell: { fontSize: 8, fontFamily: "Helvetica", color: "#374151" },
  tblBold: { fontFamily: "Helvetica-Bold", color: "#111827" },
  // Equity bridge
  bridgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: "#f3f4f6" },
  bridgeLabel: { fontSize: 8.5, fontFamily: "Helvetica", color: "#374151" },
  bridgeValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#111827" },
  // Chart
  chartContainer: { position: "relative", backgroundColor: "#f9fafb", borderRadius: 6 },
  chartBar: { position: "absolute", borderRadius: 3 },
  chartLabel: { position: "absolute", bottom: 3, fontSize: 7, textAlign: "center", fontFamily: "Helvetica", color: "#6b7280" },
  chartAmt: { position: "absolute", fontSize: 6.5, textAlign: "center", fontFamily: "Helvetica", color: "#374151" },
});

// ── Debt breakdown table ───────────────────────────────────────────────────

function DebtTable({ lines, accentColor }: { lines: DebtLine[]; accentColor: string }) {
  const headers = [
    { label: "Facility", flex: 3 },
    { label: "Amount", flex: 1.5, align: "right" as const },
    { label: "Rate", flex: 0.8, align: "right" as const },
    { label: "Maturity", flex: 0.8, align: "right" as const },
  ];
  const totalDebt = lines.reduce((s, l) => s + l.amount, 0);
  return (
    <View>
      <View style={[S.tblHeader, { backgroundColor: accentColor }]}>
        {headers.map((h, i) => (
          <Text key={i} style={[S.tblHCell, { flex: h.flex, textAlign: h.align ?? "left" }]}>{h.label}</Text>
        ))}
      </View>
      {lines.map((line, ri) => (
        <View key={ri} style={[S.tblRow, { backgroundColor: ri % 2 === 1 ? "#f9fafb" : "#ffffff" }]}>
          <Text style={[S.tblCell, { flex: 3 }]}>{line.label}</Text>
          <Text style={[S.tblCell, { flex: 1.5, textAlign: "right" }]}>{formatRand(line.amount)}</Text>
          <Text style={[S.tblCell, { flex: 0.8, textAlign: "right" }]}>{line.annual_rate_pct > 0 ? `${line.annual_rate_pct.toFixed(1)}%` : "0%"}</Text>
          <Text style={[S.tblCell, { flex: 0.8, textAlign: "right" }]}>{line.maturity_year}</Text>
        </View>
      ))}
      <View style={[S.tblRow, { backgroundColor: "#f3f4f6" }]}>
        <Text style={[S.tblCell, S.tblBold, { flex: 3 }]}>Total Debt</Text>
        <Text style={[S.tblCell, S.tblBold, { flex: 1.5, textAlign: "right" }]}>{formatRand(totalDebt)}</Text>
        <Text style={[S.tblCell, { flex: 0.8, textAlign: "right" }]}> </Text>
        <Text style={[S.tblCell, { flex: 0.8, textAlign: "right" }]}> </Text>
      </View>
    </View>
  );
}

// ── Debt maturity bar chart ────────────────────────────────────────────────

const CHART_W = 515;
const CHART_H = 100;
const LABEL_H = 20;

function MaturityChart({ lines, accentColor }: { lines: DebtLine[]; accentColor: string }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear + i);
  const matMap = new Map<number, number>();
  for (const l of lines) matMap.set(l.maturity_year, (matMap.get(l.maturity_year) ?? 0) + l.amount);
  const maturities = years.map((y) => ({ year: y, amount: matMap.get(y) ?? 0 }));
  const maxAmt = Math.max(...maturities.map((m) => m.amount), 1);
  const slot = CHART_W / 5;
  const barW = slot - 16;
  const totalH = CHART_H + LABEL_H;

  return (
    <View>
      <Text style={S.sectionTitle}>Debt Maturity Profile (Next 5 Years)</Text>
      <View style={[S.chartContainer, { height: totalH }]}>
        {[0.25, 0.5, 0.75].map((p, i) => (
          <View key={i} style={{ position: "absolute", left: 0, right: 0, bottom: LABEL_H + p * CHART_H, height: 0.5, backgroundColor: "#e5e7eb" }} />
        ))}
        {maturities.map((m, i) => {
          const barH = m.amount > 0 ? Math.max(4, (m.amount / maxAmt) * CHART_H) : 4;
          const left = i * slot + 8;
          const color = m.amount === 0 ? "#e5e7eb" : m.amount > maxAmt * 0.6 ? "#ef4444" : m.amount > maxAmt * 0.3 ? "#f59e0b" : accentColor;
          return (
            <View key={i}>
              <View style={[S.chartBar, { bottom: LABEL_H, left, width: barW, height: barH, backgroundColor: color }]} />
              {m.amount > 0 && (
                <Text style={[S.chartAmt, { bottom: LABEL_H + barH + 2, left, width: barW }]}>
                  {Math.round(m.amount / 1000)}k
                </Text>
              )}
              <Text style={[S.chartLabel, { left, width: barW }]}>{m.year}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Equity bridge ──────────────────────────────────────────────────────────

function EquityBridge({ data, accentColor }: { data: LeverageSolvencyData; accentColor: string }) {
  const closingEquity = data.prior_equity + data.net_profit - data.drawings;
  const rows = [
    { label: "Opening Equity", value: formatRand(data.prior_equity), color: "#374151", isBold: false },
    { label: "+ Net Profit (Retained)", value: `+ ${formatRand(data.net_profit)}`, color: "#10b981", isBold: false },
    { label: "− Owner Drawings / Dividends", value: `(${formatRand(data.drawings)})`, color: "#ef4444", isBold: false },
    { label: "Closing Equity", value: formatRand(closingEquity), color: accentColor, isBold: true },
  ];
  return (
    <View>
      <Text style={[S.sectionTitle, { marginTop: 24 }]}>Equity Bridge</Text>
      <View style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 6, overflow: "hidden" }}>
        {rows.map((row, i) => (
          <View key={i} style={[S.bridgeRow, { backgroundColor: row.isBold ? "#f9fafb" : i % 2 === 1 ? "#fafafa" : "#ffffff" }]}>
            <Text style={[S.bridgeLabel, row.isBold ? { fontFamily: "Helvetica-Bold", fontSize: 9 } : {}]}>{row.label}</Text>
            <Text style={[S.bridgeValue, { color: row.color }]}>{row.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function LeverageSolvencyPDF({ smeData, data, accountantProfile }: LeverageSolvencyPDFProps) {
  const accent = accountantProfile.accentColor || "#0f3460";
  const hs = data.health_scores;
  const debtToAssets = data.total_debt / (data.total_debt + data.total_equity);
  const debtToEquity = data.total_debt / data.total_equity;
  const ratioRows = [
    { name: "Funding Structure", value: `${(debtToAssets * 100).toFixed(1)}%`, score: hs.fundingStructure },
    { name: "Equity Multiplier", value: `${(1 + debtToEquity).toFixed(2)}×`, score: hs.equityMultiplier },
    { name: "Debt-to-Equity", value: `${debtToEquity.toFixed(2)}×`, score: hs.debtToEquity },
    { name: "Debt-to-Assets", value: `${(debtToAssets * 100).toFixed(1)}%`, score: hs.debtToAssets },
    { name: "Interest Burden", value: `${(100 - hs.interestBurden * 0.7).toFixed(1)}%`, score: hs.interestBurden },
  ];

  return (
    <PDFDocument title={`Leverage & Solvency — ${smeData.name}`} subject="Leverage & Solvency Report" smeData={smeData} accountantProfile={accountantProfile}>
      {/* ── PAGE 1 ── */}
      <Text style={S.title}>Leverage & Solvency Report</Text>
      <Text style={S.subtitle}>Analysis of funding structure, debt levels, and long-term financial stability</Text>

      <View style={S.metricsRow}>
        <MetricBox label="Total Debt" value={formatRand(data.total_debt)} accentColor="#ef4444" />
        <MetricBox label="Total Equity" value={formatRand(data.total_equity)} accentColor="#10b981" />
        <MetricBox label="Debt / Equity Ratio" value={`${debtToEquity.toFixed(2)}×`} accentColor={hs.debtToEquity >= 70 ? "#10b981" : hs.debtToEquity >= 40 ? "#f59e0b" : "#ef4444"} />
      </View>

      <Text style={S.sectionTitle}>Debt Facility Breakdown</Text>
      <DebtTable lines={data.debt_lines} accentColor={accent} />

      <Text style={[S.sectionTitle, { marginTop: 18 }]}>Financing Ratio Analysis</Text>
      {ratioRows.map((r, i) => (
        <RatioRow key={r.name} ratioName={r.name} formattedValue={r.value} healthScore={r.score} healthTier={scoreTier(r.score)} isAlternate={i % 2 === 1} />
      ))}

      {/* ── PAGE 2 ── */}
      <View break>
        <MaturityChart lines={data.debt_lines} accentColor={accent} />
        <EquityBridge data={data} accentColor={accent} />
      </View>
    </PDFDocument>
  );
}
