/**
 * DuPont visuals — the diagnostic thread of the report suite.
 *
 * DuPontDiagram: flagship decomposition diagram (Asset Productivity report)
 * with connector lines and a weak-lever callout.
 * DuPontStrip: compact one-line strip (Health Scorecard) pointing readers to
 * the deep-dive report covering the weak lever.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, fmtPct } from "./theme";
import type { DuPontDiagnosis, DuPontLevers } from "@/reports/narrative";

// ── Shared lever config ────────────────────────────────────────────────────

type LeverKey = "margin" | "turnover" | "leverage";

function leverCards(l: DuPontLevers) {
  return [
    {
      key: "margin" as LeverKey,
      label: "Net Profit Margin",
      value: Number.isFinite(l.netMargin) ? fmtPct(l.netMargin) : "n/m",
      sub: "Profitability — what each sale keeps",
    },
    {
      key: "turnover" as LeverKey,
      label: "Asset Turnover",
      value: Number.isFinite(l.assetTurnover) ? `${l.assetTurnover.toFixed(2)}×` : "n/m",
      sub: "Efficiency — revenue per rand of assets",
    },
    {
      key: "leverage" as LeverKey,
      label: "Equity Multiplier",
      value: Number.isFinite(l.equityMultiplier) ? `${l.equityMultiplier.toFixed(2)}×` : "n/m",
      sub: "Leverage — assets funded per rand of equity",
    },
  ];
}

// ── Flagship diagram ───────────────────────────────────────────────────────

const D = StyleSheet.create({
  wrap: { marginBottom: 16 },
  roeRow: { alignItems: "center" },
  roeBox: {
    borderRadius: 6,
    paddingHorizontal: 28,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: C.blueDeep,
  },
  roeLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    opacity: 0.85,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  roeValue: { fontSize: 24, fontFamily: "Helvetica-Bold", color: C.white },
  goldUnderline: { width: 34, height: 1, backgroundColor: C.gold, marginTop: 6 },
  // connector lines
  stem: { width: 0.75, height: 12, backgroundColor: C.line, alignSelf: "center" },
  crossbar: { height: 0.75, backgroundColor: C.line, marginHorizontal: 85 },
  dropRow: { flexDirection: "row", marginHorizontal: 85, justifyContent: "space-between" },
  drop: { width: 0.75, height: 10, backgroundColor: C.line },
  cardsRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  opCol: { justifyContent: "center" },
  op: { fontSize: 15, color: C.faint, fontFamily: "Helvetica" },
  card: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 0.75,
    borderColor: C.line,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 11,
    backgroundColor: C.white,
  },
  cardWeak: { borderColor: C.red, borderWidth: 1.25, backgroundColor: C.redSoft },
  cardLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  cardValue: { fontSize: 17, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 3 },
  cardSub: { fontSize: 6, fontFamily: "Helvetica", color: C.faint, lineHeight: 1.4 },
  dragChip: {
    alignSelf: "flex-start",
    backgroundColor: C.red,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 6,
  },
  dragText: { fontSize: 5.5, fontFamily: "Helvetica-Bold", color: C.white, letterSpacing: 0.6 },
  callout: {
    marginTop: 12,
    borderRadius: 5,
    borderWidth: 0.75,
    borderColor: C.line,
    borderLeftWidth: 2.5,
    padding: 11,
    backgroundColor: C.soft,
  },
  calloutTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  calloutText: { fontSize: 8, fontFamily: "Helvetica", color: C.body, lineHeight: 1.55 },
});

export function DuPontDiagram({
  levers,
  diagnosis,
}: {
  levers: DuPontLevers;
  diagnosis: DuPontDiagnosis;
}) {
  const cards = leverCards(levers);
  const roeOk = Number.isFinite(levers.roe);

  return (
    <View style={D.wrap}>
      {/* ROE result */}
      <View style={D.roeRow}>
        <View style={D.roeBox}>
          <Text style={D.roeLabel}>Return on Equity</Text>
          <Text style={D.roeValue}>{roeOk ? fmtPct(levers.roe) : "n/m"}</Text>
          <View style={D.goldUnderline} />
        </View>
      </View>

      {/* Connector: stem, crossbar, three drops */}
      <View style={D.stem} />
      <View style={D.crossbar} />
      <View style={D.dropRow}>
        <View style={D.drop} />
        <View style={D.drop} />
        <View style={D.drop} />
      </View>

      {/* Lever cards with × operators */}
      <View style={D.cardsRow}>
        {cards.map((card, i) => {
          const isWeak = diagnosis.weakLever === card.key;
          return (
            <View key={card.key} style={{ flexDirection: "row", flex: 1, gap: 10 }}>
              {i > 0 && (
                <View style={D.opCol}>
                  <Text style={D.op}>×</Text>
                </View>
              )}
              <View style={[D.card, isWeak ? D.cardWeak : {}]}>
                <Text style={D.cardLabel}>{card.label}</Text>
                <Text style={[D.cardValue, isWeak ? { color: C.redDeep } : {}]}>
                  {card.value}
                </Text>
                <Text style={D.cardSub}>{card.sub}</Text>
                {isWeak && (
                  <View style={D.dragChip}>
                    <Text style={D.dragText}>DRAG ON ROE</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Weak-lever callout */}
      <View
        style={[
          D.callout,
          { borderLeftColor: diagnosis.weakLever ? C.red : C.green },
        ]}
      >
        <Text style={D.calloutTitle}>
          {diagnosis.weakLever ? `Diagnosis — ${diagnosis.weakLeverLabel}` : "Diagnosis — Balanced"}
        </Text>
        <Text style={D.calloutText}>
          ROE = Net Profit Margin × Asset Turnover × Equity Multiplier. {diagnosis.sentence}
        </Text>
      </View>
    </View>
  );
}

// ── Compact strip (Health Scorecard) ───────────────────────────────────────

const WEAK_LEVER_REPORT: Record<LeverKey, string> = {
  margin: "Profitability Waterfall report",
  turnover: "Asset Productivity report",
  leverage: "Leverage & Solvency report",
};

const S = StyleSheet.create({
  wrap: {
    borderRadius: 5,
    borderWidth: 0.75,
    borderColor: C.line,
    backgroundColor: C.soft,
    overflow: "hidden",
  },
  goldTop: { height: 1, backgroundColor: C.gold, opacity: 0.8 },
  inner: { paddingHorizontal: 14, paddingVertical: 10 },
  heading: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  row: { flexDirection: "row", alignItems: "center" },
  cell: { flex: 1 },
  label: {
    fontSize: 5.5,
    fontFamily: "Helvetica",
    color: C.faint,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  value: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink },
  weakValue: { color: C.redDeep },
  op: { fontSize: 10, color: C.faint, fontFamily: "Helvetica", marginHorizontal: 8 },
  eq: { fontSize: 10, color: C.muted, fontFamily: "Helvetica-Bold", marginHorizontal: 8 },
  weakDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.red, marginLeft: 3 },
  pointer: { fontSize: 6.5, fontFamily: "Helvetica", color: C.muted, marginTop: 7 },
  pointerBold: { fontFamily: "Helvetica-Bold", color: C.ink },
});

export function DuPontStrip({
  levers,
  diagnosis,
}: {
  levers: DuPontLevers;
  diagnosis: DuPontDiagnosis;
}) {
  const cards = leverCards(levers);
  const pointer = diagnosis.weakLever
    ? `${diagnosis.sentence} See the ${WEAK_LEVER_REPORT[diagnosis.weakLever]} for the deep dive.`
    : `${diagnosis.sentence} The Asset Productivity report holds the full decomposition.`;

  return (
    <View style={S.wrap}>
      <View style={S.goldTop} />
      <View style={S.inner}>
        <Text style={S.heading}>ROE Drivers — DuPont Lens</Text>
        <View style={S.row}>
          <View style={S.cell}>
            <Text style={S.label}>Return on Equity</Text>
            <Text style={S.value}>
              {Number.isFinite(levers.roe) ? fmtPct(levers.roe) : "n/m"}
            </Text>
          </View>
          <Text style={S.eq}>=</Text>
          {cards.map((card, i) => {
            const isWeak = diagnosis.weakLever === card.key;
            return (
              <View key={card.key} style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                {i > 0 && <Text style={S.op}>×</Text>}
                <View style={S.cell}>
                  <Text style={S.label}>{card.label}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={[S.value, isWeak ? S.weakValue : {}]}>{card.value}</Text>
                    {isWeak && <View style={S.weakDot} />}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
        <Text style={S.pointer}>
          <Text style={S.pointerBold}>Where to look: </Text>
          {pointer}
        </Text>
      </View>
    </View>
  );
}
