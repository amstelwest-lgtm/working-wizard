/**
 * MetricBox — clean headline metric card: hairline border, uppercase label,
 * large value, optional delta chip and note.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C } from "./theme";
import { DeltaChip } from "./delta-chip";

type Props = {
  label: string;
  value: string;
  /** Percentage change vs prior (drives the delta chip). */
  change?: number;
  /** When set, movement down is favourable (e.g. debtor days). */
  lowerIsBetter?: boolean;
  /** Accent colour for the top tick (signal colour or theme accent). */
  accentColor?: string;
  note?: string;
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 11,
    flex: 1,
    backgroundColor: C.white,
  },
  tick: { width: 22, height: 2, borderRadius: 1, marginBottom: 8 },
  label: {
    fontSize: 6.5,
    color: C.muted,
    marginBottom: 5,
    fontFamily: "Helvetica",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 4 },
  note: { fontSize: 6, fontFamily: "Helvetica", color: C.faint, marginTop: 3 },
});

export function MetricBox({
  label,
  value,
  change,
  lowerIsBetter,
  accentColor = C.blue,
  note,
}: Props) {
  let chip: React.ReactNode = null;
  if (change !== undefined && Number.isFinite(change)) {
    const dir = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";
    const improved = lowerIsBetter ? change < 0 : change > 0;
    chip = (
      <DeltaChip
        text={`${change >= 0 ? "+" : "-"}${Math.abs(change).toFixed(1)}%`}
        direction={dir}
        good={dir === "flat" ? undefined : improved}
      />
    );
  }

  return (
    <View style={styles.box}>
      <View style={[styles.tick, { backgroundColor: accentColor }]} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {chip}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}
