/**
 * DemoWatermark — elegant diagonal watermark + notice chip for demo/mock data
 * so a firm never accidentally sends placeholder numbers as real figures.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C } from "./theme";

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  diagonal: {
    position: "absolute",
    top: 380,
    left: -60,
    width: 720,
    textAlign: "center",
    fontSize: 46,
    fontFamily: "Helvetica-Bold",
    color: C.blueDeep,
    opacity: 0.055,
    letterSpacing: 6,
    transform: "rotate(-32deg)",
  },
});

/** Full-page diagonal watermark. Render as first child of the Page (fixed). */
export function DemoWatermark() {
  return (
    <View style={styles.layer} fixed>
      <Text style={styles.diagonal}>ILLUSTRATIVE DATA</Text>
    </View>
  );
}

/**
 * Unsigned budget. A flat line in the page body. The old rotated header
 * word wrapped, and the last two letters sat in the top margin.
 */
export function DraftWatermark() {
  return (
    <View style={styles.layer} fixed>
      <Text
        style={{
          position: "absolute",
          top: 400,
          left: 40,
          width: 515,
          textAlign: "center",
          fontSize: 22,
          fontFamily: "Helvetica-Bold",
          color: C.blueDeep,
          opacity: 0.05,
          letterSpacing: 4,
        }}
      >
        DRAFT
      </Text>
    </View>
  );
}

const chip = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 0.75,
    borderColor: C.gold,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    marginBottom: 12,
    backgroundColor: C.white,
    maxWidth: 480,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.gold },
  text: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.amberDeep,
    textTransform: "uppercase",
  },
});

/** Small inline notice chip shown near the report title on demo data. */
export function DemoNotice() {
  return (
    <View style={chip.wrap}>
      <View style={chip.dot} />
      <Text style={chip.text}>Demo data — illustrative figures, not client results</Text>
    </View>
  );
}

/** Unsigned deliverable — download is allowed; the page says it is still a draft. */
export function DraftNotice() {
  return (
    <View style={chip.wrap}>
      <View style={chip.dot} />
      <Text style={chip.text}>Draft — not signed off</Text>
    </View>
  );
}
