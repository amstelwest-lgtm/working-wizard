interface SparklineProps {
  data: number[];
  trend: "up" | "down" | "flat";
  width?: number;
  height?: number;
}

export function Sparkline({ data, trend, width = 100, height = 36 }: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} />;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padX = 4;
  const padY = 4;
  const w = width - padX * 2;
  const h = height - padY * 2;

  const points = data.map((val, i) => {
    const x = padX + (i / (data.length - 1)) * w;
    const y = padY + h - ((val - min) / range) * h;
    return { x, y };
  });

  const color = trend === "up" ? "#4CAF82" : trend === "down" ? "#e05c5c" : "#d4a550";
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  const first = points[0];
  const last = points[points.length - 1];
  const fillPoints = [
    `${first.x},${height - padY}`,
    ...points.map((p) => `${p.x},${p.y}`),
    `${last.x},${height - padY}`,
  ].join(" ");

  const gradId = `spark-grad-${trend}-${width}`;

  return (
    <svg width={width} height={height} style={{ marginTop: 6 }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#${gradId})`} />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={3} fill={color} />
    </svg>
  );
}
