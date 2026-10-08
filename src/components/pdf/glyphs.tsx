/**
 * Glyph helpers — standard Helvetica (WinAnsi) lacks ▲ ▼ → and ō, so we draw
 * them. CSS border triangles paint as black squares in react-pdf, so arrows
 * are SVG polygons.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, Svg, Polygon, Path } from "@react-pdf/renderer";
import { C } from "./theme";

export type ArrowDir = "up" | "down" | "flat";

/** Small directional arrow. Triangles are filled polygons, not transparent borders. */
export function Arrow({
  dir,
  color,
  size = 5,
}: {
  dir: ArrowDir;
  color: string;
  size?: number;
}) {
  if (dir === "flat") {
    return (
      <View
        style={{ width: size + 2, height: 1.5, borderRadius: 0.75, backgroundColor: color }}
      />
    );
  }
  const w = size * 1.15;
  const h = size;
  const points =
    dir === "up" ? `${w / 2},0 ${w},${h} 0,${h}` : `0,0 ${w},0 ${w / 2},${h}`;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Polygon points={points} fill={color} />
    </Svg>
  );
}

/** WinAnsi has no check mark (U+2713). Drawn so the sign-off badge can show ✓. */
export function CheckMark({ size = 9, color = C.greenDeep }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path
        d="M2.1 6.2 L4.7 9 L10.1 3.1"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/**
 * "Milōn" wordmark — the macron over the o is a hairline, because ō (U+014D)
 * is missing from Helvetica. The column is the glyph advance of "o" so the
 * bar sits on the letter, not on the gap beside it.
 * Helvetica advance widths (em): o 0.556, bold o 0.611.
 */
export function MilonMark({
  fontSize = 6.5,
  color = C.gold,
  bold = true,
}: {
  fontSize?: number;
  color?: string;
  bold?: boolean;
}) {
  const family = bold ? "Helvetica-Bold" : "Helvetica";
  const advance = bold ? 0.611 : 0.556;
  const col = fontSize * advance;
  const bar = col * 0.62;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Text style={{ fontSize, fontFamily: family, color }}>Mil</Text>
      <View style={{ width: col, alignItems: "center" }}>
        <View
          style={{
            width: bar,
            height: Math.max(0.7, fontSize * 0.08),
            backgroundColor: color,
            marginBottom: fontSize * 0.1,
          }}
        />
        <Text style={{ fontSize, fontFamily: family, color, width: col, textAlign: "center" }}>
          o
        </Text>
      </View>
      <Text style={{ fontSize, fontFamily: family, color }}>n</Text>
    </View>
  );
}
