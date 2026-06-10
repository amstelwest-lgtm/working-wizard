type Props = {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
};

/** Tiny dependency-free sparkline. Renders nothing if <2 finite points. */
export function KpiTrendline({ values, width = 80, height = 24, className }: Props) {
  const pts = values.filter((n) => isFinite(n));
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const stepX = width / (pts.length - 1);
  const path = pts
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = pts[pts.length - 1];
  const first = pts[0];
  const up = last >= first;
  const stroke = up ? "hsl(142 70% 40%)" : "hsl(0 70% 50%)";
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
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
