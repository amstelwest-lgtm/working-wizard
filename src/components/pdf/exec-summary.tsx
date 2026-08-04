/**
 * ExecSummary — executive summary band that opens every report:
 * 3–5 headline figures with directional arrows plus a one-paragraph
 * auto-generated narrative ("what these numbers say").
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C } from "./theme";
import { Arrow } from "./glyphs";

export type HeadlineFigure = {
  label: string;
  value: string;
  /** Direction of movement (optional). */
  direction?: "up" | "down" | "flat";
  /** Whether the movement (or level) is good news. Drives green/red. */
  good?: boolean;
  /** Small line under the value, e.g. "vs prior period". */
  note?: string;
};

type Props = {
  figures: HeadlineFigure[];
  narrative: string;
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: C.soft,
    borderRadius: 6,
    borderWidth: 0.75,
    borderColor: C.line,
    marginBottom: 18,
    overflow: "hidden",
  },
  goldTop: { height: 1.5, backgroundColor: C.gold, opacity: 0.85 },
  inner: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14 },
  heading: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  figuresRow: { flexDirection: "row", marginBottom: 12 },
  figure: { flex: 1, paddingRight: 12 },
  divider: { width: 0.75, backgroundColor: C.line, marginRight: 12 },
  figLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  figValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: C.ink },
  figNote: { fontSize: 6, fontFamily: "Helvetica", color: C.faint, marginTop: 3 },
  hairline: { height: 0.75, backgroundColor: C.line, marginBottom: 9 },
  narrative: {
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: C.body,
    lineHeight: 1.6,
  },
});

export function ExecSummary({ figures, narrative }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.goldTop} />
      <View style={styles.inner}>
        <Text style={styles.heading}>Executive Summary</Text>

        <View style={styles.figuresRow}>
          {figures.map((f, i) => {
            const arrowColor =
              f.good === undefined ? C.faint : f.good ? C.green : C.red;
            return (
              <View key={i} style={{ flexDirection: "row", flex: 1 }}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.figure}>
                  <Text style={styles.figLabel}>{f.label}</Text>
                  <View style={styles.valueRow}>
                    <Text style={styles.figValue}>{f.value}</Text>
                    {f.direction ? <Arrow dir={f.direction} color={arrowColor} size={5} /> : null}
                  </View>
                  {f.note ? <Text style={styles.figNote}>{f.note}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.hairline} />
        <Text style={styles.narrative}>{narrative}</Text>
      </View>
    </View>
  );
}
