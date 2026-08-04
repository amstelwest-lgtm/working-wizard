/**
 * Glyph helpers — standard Helvetica (WinAnsi) lacks ▲ ▼ → and ō, so we draw
 * them as Views instead of relying on missing font glyphs.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text } from "@react-pdf/renderer";
import { C } from "./theme";

export type ArrowDir = "up" | "down" | "flat";

/** Small directional arrow drawn with border triangles (WinAnsi-safe). */
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
  const half = size * 0.7;
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: half,
        borderRightWidth: half,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        ...(dir === "up"
          ? { borderBottomWidth: size, borderBottomColor: color }
          : { borderTopWidth: size, borderTopColor: color }),
      }}
    />
  );
}

/**
 * "Milōn" wordmark — the macron over the o is drawn as a hairline View since
 * ō (U+014D) is missing from the built-in Helvetica encoding.
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
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Text style={{ fontSize, fontFamily: family, color }}>Mil</Text>
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: fontSize * 0.52,
            height: Math.max(0.6, fontSize * 0.09),
            backgroundColor: color,
            marginBottom: fontSize * 0.16,
          }}
        />
        <Text style={{ fontSize, fontFamily: family, color }}>o</Text>
      </View>
      <Text style={{ fontSize, fontFamily: family, color }}>n</Text>
    </View>
  );
}
