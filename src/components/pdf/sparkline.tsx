/**
 * Sparkline — compact inline trend visual (mini column series) for showing
 * historical movement without a full chart. Degrades to nothing when fewer
 * than two points exist.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, StyleSheet } from "@react-pdf/renderer";
import { C } from "./theme";

type Props = {
  values: (number | null | undefined)[];
  width?: number;
  height?: number;
  /** Highlight the most recent bar in this colour (defaults to blue). */
  color?: string;
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end" },
  bar: { borderTopLeftRadius: 1, borderTopRightRadius: 1 },
});

export function Sparkline({ values, width = 44, height = 12, color = C.blue }: Props) {
  const pts = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (pts.length < 2) return null;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const gap = 1.5;
  const barW = Math.max(1.5, (width - gap * (pts.length - 1)) / pts.length);

  return (
    <View style={[styles.row, { width, height }]}>
      {pts.map((v, i) => {
        const h = Math.max(1.5, ((v - min) / range) * (height - 2) + 2);
        const isLast = i === pts.length - 1;
        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                width: barW,
                height: h,
                marginLeft: i > 0 ? gap : 0,
                backgroundColor: isLast ? color : C.line,
              },
            ]}
          />
        );
      })}
    </View>
  );
}
