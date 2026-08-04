/**
 * BenchmarkBar — one-line benchmark position indicator: a soft track with the
 * median→top-quartile band shaded and a marker showing the client's position.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, StyleSheet } from "@react-pdf/renderer";
import { C } from "./theme";

type Props = {
  /** Client value normalised to 0..1 along the track. */
  position: number;
  /** Benchmark band start (0..1), e.g. sector median. */
  bandStart: number;
  /** Benchmark band end (0..1), e.g. top quartile. */
  bandEnd: number;
  width?: number;
  markerColor?: string;
};

const H = 6;

const styles = StyleSheet.create({
  track: {
    height: H,
    backgroundColor: C.hairline,
    borderRadius: H / 2,
    position: "relative",
    overflow: "hidden",
  },
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: C.blueSoft,
  },
  marker: {
    position: "absolute",
    top: 0.75,
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
  },
});

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function BenchmarkBar({
  position,
  bandStart,
  bandEnd,
  width = 90,
  markerColor = C.blue,
}: Props) {
  const lo = clamp(Math.min(bandStart, bandEnd));
  const hi = clamp(Math.max(bandStart, bandEnd));
  const pos = clamp(position);

  return (
    <View style={[styles.track, { width }]}>
      <View style={[styles.band, { left: lo * width, width: Math.max(2, (hi - lo) * width) }]} />
      <View
        style={[
          styles.marker,
          { left: Math.min(width - 5, pos * width), backgroundColor: markerColor },
        ]}
      />
    </View>
  );
}
