import { useId } from "react";

type Props = {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /**
   * When fewer than 2 points, draw a muted sparkline silhouette so the slot
   * stays visible. Never invent historical values — the ghost path is decorative.
   */
  placeholder?: boolean;
};

const GHOST_LINE = "M1.5 12.2 C 11 16.5, 17 4.8, 26.5 8.8 S 40 15.2, 50.5 5.8";
const GHOST_FILL = `${GHOST_LINE} L 50.5 17 L 1.5 17 Z`;

/** Tiny dependency-free sparkline. */
export function KpiTrendline({
  values,
  width = 80,
  height = 24,
  className,
  placeholder = false,
}: Props) {
  const gradId = useId().replace(/:/g, "");
  const pts = values.filter((n) => isFinite(n));

  if (pts.length >= 2) {
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const stepX = width / (pts.length - 1);
    const coords = pts.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 3) - 1.5;
      return { x, y };
    });
    const line = coords
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
    const last = coords[coords.length - 1]!;
    const first = coords[0]!;
    const up = pts[pts.length - 1]! >= pts[0]!;
    const stroke = up ? "hsl(142 70% 36%)" : "hsl(0 70% 46%)";
    const fill = `${line} L ${last.x.toFixed(1)},${height} L ${first.x.toFixed(1)},${height} Z`;
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={fill} fill={`url(#${gradId})`} />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={last.x} cy={last.y} r={2.1} fill={stroke} />
      </svg>
    );
  }

  if (!placeholder) return null;

  return (
    <svg
      viewBox="0 0 52 18"
      width={width}
      height={height}
      className={className}
      aria-hidden
    >
      <path d={GHOST_FILL} fill="#d4a550" fillOpacity={0.14} />
      <path
        d={GHOST_LINE}
        fill="none"
        stroke="#b7872a"
        strokeOpacity={0.45}
        strokeWidth={1.5}
        strokeDasharray="2.8 2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.length === 1 ? <circle cx={50.5} cy={5.8} r={2.2} fill="#b7872a" /> : null}
    </svg>
  );
}

export function pctDelta(values: number[]): number | null {
  const pts = values.filter((n) => isFinite(n));
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first === 0) return null;
  return (last - first) / Math.abs(first);
}
