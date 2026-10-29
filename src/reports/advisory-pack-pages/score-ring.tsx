import { Circle, Path, Svg, Text, View } from "@react-pdf/renderer";
import { TIER_META, tierForScore } from "@/components/pdf/theme";
import { DISPLAY, P, SANS } from "./pack-type";

function arcPath(cx: number, cy: number, r: number, pct: number): string {
  const start = -Math.PI / 2;
  const end = start + (Math.min(pct, 99.99) / 100) * Math.PI * 2;
  const large = pct > 50 ? 1 : 0;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function ScoreRing({ score, size = 132 }: { score: number | null; size?: number }) {
  const stroke = Math.max(7, size * 0.07);
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const pct = score == null || !Number.isFinite(score) ? 0 : Math.max(0, Math.min(100, score));
  const tone = TIER_META[tierForScore(score)].color;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0 }}>
        <Circle cx={cx} cy={cy} r={radius} stroke={P.line} strokeWidth={stroke} fill="none" />
        {pct >= 99.5 ? (
          <Circle cx={cx} cy={cy} r={radius} stroke={tone} strokeWidth={stroke} fill="none" />
        ) : pct > 0 ? (
          <Path
            d={arcPath(cx, cy, radius, pct)}
            stroke={tone}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
          />
        ) : null}
      </Svg>
      <Text
        style={{
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: size * 0.32,
          color: P.navy,
          lineHeight: 1,
        }}
      >
        {score == null ? "—" : String(Math.round(score))}
      </Text>
      <Text
        style={{
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 7,
          color: P.muted,
          letterSpacing: 1,
          marginTop: 2,
        }}
      >
        OF 100
      </Text>
    </View>
  );
}
