/**
 * One health-pillar card shared by the scorecard and the advisory pack.
 */
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C, scoreColor } from "@/components/pdf/theme";
import { HealthScoreGauge } from "@/components/pdf/health-score-gauge";
import { PDF_CARD_MIN_PRESENCE } from "@/lib/report-pdf-layout";
import { PILLAR_LABELS, type HealthPillarId } from "@/lib/health-score";

const styles = StyleSheet.create({
  pillarBox: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 6,
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 12,
    backgroundColor: C.white,
  },
  pillarName: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  pillarScoreRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginBottom: 7 },
  pillarScore: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  pillarUnscored: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: C.muted,
    lineHeight: 1.35,
    marginTop: 2,
  },
  pillarGaugeRow: { marginBottom: 8 },
  pillarCountRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  countChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  countDot: { width: 5, height: 5, borderRadius: 2.5 },
  countText: { fontSize: 6.5, fontFamily: "Helvetica", color: C.muted },
});

export function pillarLabel(pillar: string): string {
  return PILLAR_LABELS[pillar as HealthPillarId] ?? pillar;
}

function unscoredPillarNote(pillar: string, note?: string | null): string {
  if (note) return note;
  if (pillar === "financing") return "Not scored — needs balance sheet";
  return "Not scored";
}

export function PillarBox({
  pillar,
  score,
  counts,
  note,
}: {
  pillar: string;
  score: number | null;
  counts: { critical: number; at_risk: number; healthy: number };
  note?: string | null;
}) {
  const hasScore = score != null && Number.isFinite(score);
  const rounded = hasScore ? Math.round(score) : null;

  if (!hasScore) {
    return (
      <View style={styles.pillarBox} wrap={false} minPresenceAhead={PDF_CARD_MIN_PRESENCE}>
        <Text style={styles.pillarName}>{pillarLabel(pillar)}</Text>
        <Text style={styles.pillarUnscored}>{unscoredPillarNote(pillar, note)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.pillarBox} wrap={false} minPresenceAhead={PDF_CARD_MIN_PRESENCE}>
      <Text style={styles.pillarName}>{pillarLabel(pillar)}</Text>
      <View style={styles.pillarScoreRow}>
        <Text style={[styles.pillarScore, { color: scoreColor(rounded!) }]}>{rounded}</Text>
      </View>
      <View style={styles.pillarGaugeRow}>
        <HealthScoreGauge score={rounded!} height={5} />
      </View>
      <View style={styles.pillarCountRow}>
        {counts.critical > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: C.red }]} />
            <Text style={styles.countText}>{counts.critical} critical</Text>
          </View>
        )}
        {counts.at_risk > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: C.amber }]} />
            <Text style={styles.countText}>{counts.at_risk} watch</Text>
          </View>
        )}
        {counts.healthy > 0 && (
          <View style={styles.countChip}>
            <View style={[styles.countDot, { backgroundColor: C.green }]} />
            <Text style={styles.countText}>{counts.healthy} healthy</Text>
          </View>
        )}
      </View>
    </View>
  );
}
