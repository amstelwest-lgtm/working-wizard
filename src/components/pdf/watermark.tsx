/**
 * Watermarks and title badges for demo, draft, signed, and sample PDFs.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { SAMPLE_STAMP_LINE, SAMPLE_STAMP_WORD } from "@/lib/pdf-sample";
import { DRAFT_WATERMARK_TOP } from "@/lib/report-pdf-layout";
import { C } from "./theme";
import { CheckMark } from "./glyphs";

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
 * Unsigned deliverable. A short diagonal in the body, clear of the footer
 * page number. A line along the footer used to print through "1 / 2".
 */
export function DraftWatermark({ text = "DRAFT" }: { text?: string }) {
  return (
    <View style={styles.layer} fixed>
      <Text
        style={{
          position: "absolute",
          top: DRAFT_WATERMARK_TOP,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 48,
          fontFamily: "Helvetica-Bold",
          color: C.blueDeep,
          opacity: 0.07,
          letterSpacing: 8,
          transform: "rotate(-32deg)",
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * Fictional client (`clients.is_demo`). Figures and the sign-off stay.
 * The word and the caption are on every page.
 */
export function SampleWatermark() {
  return (
    <View style={styles.layer} fixed>
      <Text
        style={{
          position: "absolute",
          top: 340,
          left: -40,
          width: 680,
          textAlign: "center",
          fontSize: 64,
          fontFamily: "Helvetica-Bold",
          color: C.amberDeep,
          opacity: 0.13,
          letterSpacing: 10,
          transform: "rotate(-28deg)",
        }}
      >
        {SAMPLE_STAMP_WORD}
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
export function DraftNotice({ text = "Draft" }: { text?: string }) {
  return (
    <View style={chip.wrap}>
      <View style={chip.dot} />
      <Text style={chip.text}>{text}</Text>
    </View>
  );
}

/**
 * Current sign-off, under the title. 8.5pt. The check is an SVG because
 * Helvetica cannot draw U+2713. Sits in the same slot as the draft chip.
 */
export function SignedNotice({ line }: { line: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
        marginBottom: 4,
        maxWidth: 515,
      }}
    >
      <CheckMark size={9} color={C.greenDeep} />
      <Text
        style={{
          fontSize: 8.5,
          fontFamily: "Helvetica",
          color: C.greenDeep,
          lineHeight: 1.35,
        }}
      >
        {line}
      </Text>
    </View>
  );
}

/** Exact sample caption. Shown under the title and repeated in the footer. */
export function SampleNotice() {
  return (
    <View style={{ marginTop: 6, marginBottom: 2 }}>
      <Text
        style={{
          fontSize: 8.5,
          fontFamily: "Helvetica-Bold",
          color: C.amberDeep,
          letterSpacing: 1.2,
        }}
      >
        {SAMPLE_STAMP_WORD}
      </Text>
      <Text
        style={{
          fontSize: 8,
          fontFamily: "Helvetica",
          color: C.amberDeep,
          marginTop: 1,
        }}
      >
        {SAMPLE_STAMP_LINE}
      </Text>
    </View>
  );
}
