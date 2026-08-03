type Benchmark = {
  p25: number;
  p50: number;
  p75: number;
  unit: string;
  higher_is_better: boolean;
};

type Props = {
  value: number;
  benchmark?: Benchmark | null;
  width?: number;
  height?: number;
};

/** Horizontal bar showing client value vs industry 25/50/75 percentiles. */
export function BenchmarkBar({ value, benchmark, width = 140, height = 34 }: Props) {
  if (!benchmark || !isFinite(value)) return null;
  const { p25, p50, p75, higher_is_better } = benchmark;
  const minRaw = Math.min(p25, value);
  const maxRaw = Math.max(p75, value);
  const pad = (maxRaw - minRaw) * 0.15 || Math.abs(maxRaw) * 0.15 || 1;
  const min = minRaw - pad;
  const max = maxRaw + pad;
  const range = max - min || 1;
  // Reserve a left/right inset so labels at the extremes are not clipped
  const inset = 12;
  const x = (n: number) => inset + ((n - min) / range) * (width - inset * 2);

  const tier = (() => {
    if (higher_is_better) {
      if (value >= p75) return "hsl(142 70% 45%)";
      if (value >= p50) return "hsl(48 90% 55%)";
      if (value >= p25) return "hsl(25 90% 55%)";
      return "hsl(0 70% 55%)";
    }
    if (value <= p25) return "hsl(142 70% 45%)";
    if (value <= p50) return "hsl(48 90% 55%)";
    if (value <= p75) return "hsl(25 90% 55%)";
    return "hsl(0 70% 55%)";
  })();

  const labelY = 8;
  const trackY = height - 10;
  const labels: Array<{ x: number; text: string }> = [
    { x: x(p25), text: "25%" },
    { x: x(p50), text: "50%" },
    { x: x(p75), text: "75%" },
  ];

  return (
    <svg width={width} height={height} aria-label="industry benchmark">
      {labels.map((l) => (
        <text
          key={l.text}
          x={l.x}
          y={labelY}
          textAnchor="middle"
          fontSize={9}
          fill="hsl(213 27% 70%)"
          style={{ fontFamily: "inherit" }}
        >
          {l.text}
        </text>
      ))}
      {/* tick marks linking labels to the bar */}
      {labels.map((l) => (
        <line
          key={`tick-${l.text}`}
          x1={l.x}
          x2={l.x}
          y1={labelY + 2}
          y2={trackY - 4}
          stroke="hsl(217 33% 30%)"
          strokeWidth={1}
        />
      ))}
      {/* track */}
      <rect x={inset} y={trackY - 2} width={width - inset * 2} height={4} rx={2} fill="hsl(217 33% 22%)" />
      {/* IQR band p25→p75 */}
      <rect
        x={x(p25)}
        y={trackY - 3}
        width={Math.max(2, x(p75) - x(p25))}
        height={6}
        rx={2}
        fill="hsl(217 33% 38%)"
      />
      {/* p50 marker */}
      <line x1={x(p50)} x2={x(p50)} y1={trackY - 6} y2={trackY + 6} stroke="hsl(213 27% 70%)" strokeWidth={1.5} />
      {/* client value dot */}
      <circle
        cx={Math.min(width - 2, Math.max(2, x(value)))}
        cy={trackY}
        r={4.5}
        fill={tier}
        stroke="hsl(222 47% 11%)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export const INDUSTRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "retail", label: "Retail" },
  { value: "services", label: "Services" },
  { value: "saas", label: "SaaS" },
  { value: "hospitality", label: "Hospitality" },
  { value: "construction", label: "Construction" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "professional", label: "Professional services" },
  { value: "other", label: "Other" },
];
