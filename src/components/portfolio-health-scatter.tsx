import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { HealthTier } from "@/lib/ratios";

export type ScatterClient = {
  id: string;
  name: string;
  score: number;
  trendDelta: number;
  revenue: number | null;
  status: HealthTier;
};

type Props = {
  clients: ScatterClient[];
  onSelect: (clientId: string) => void;
};

function clampTrend(delta: number): number {
  return Math.max(-25, Math.min(25, delta));
}

function bubbleColor(status: HealthTier): string {
  if (status === "healthy") return "#5ccf8a";
  if (status === "at_risk") return "#e8b34b";
  return "#e25c5c";
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterClient & { x: number; y: number; z: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  const delta = c.trendDelta;
  const deltaLabel = delta === 0 ? "Stable" : delta > 0 ? `+${delta} pts` : `${delta} pts`;
  return (
    <div className="ph-tooltip">
      <div className="ph-tooltip-name">{c.name}</div>
      <div className="ph-tooltip-row">
        Health <b>{Math.round(c.score)}</b>
      </div>
      <div className="ph-tooltip-row">
        30d trend <b>{deltaLabel}</b>
      </div>
      {c.revenue != null && (
        <div className="ph-tooltip-row">
          Revenue <b>{c.revenue.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</b>
        </div>
      )}
      <div className="ph-tooltip-hint">Click to open</div>
    </div>
  );
}

/**
 * Portfolio Health scatter — health score (Y) vs ~30-day trend (X).
 * Bubble size scales with revenue when available.
 */
export function PortfolioHealthScatter({ clients, onSelect }: Props) {
  const data = clients.map((c) => ({
    ...c,
    x: clampTrend(c.trendDelta),
    y: Math.max(0, Math.min(100, c.score)),
    z: c.revenue != null ? Math.max(c.revenue, 1) : 40_000,
  }));

  return (
    <div className="ph-scatter">
      <div className="ph-scatter-head">
        <div>
          <div className="ph-kicker">Portfolio health</div>
          <div className="ph-sub">Health score vs trend</div>
        </div>
      </div>

      <div className="ph-scatter-chart">
        {data.length === 0 ? (
          <div className="ph-empty">Score a client to plot portfolio health.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, bottom: 28, left: 8 }}>
              <CartesianGrid stroke="var(--line-soft)" strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[-25, 25]}
                ticks={[-20, -10, 0, 10, 20]}
                tickFormatter={(v) => (v === 0 ? "Stable" : v < 0 ? "Declining" : "Improving")}
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                axisLine={{ stroke: "var(--line)" }}
                tickLine={false}
                label={{
                  value: "TREND (30 DAYS)",
                  position: "insideBottom",
                  offset: -14,
                  fill: "var(--ink-dim)",
                  fontSize: 10,
                  letterSpacing: 1.5,
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                axisLine={{ stroke: "var(--line)" }}
                tickLine={false}
                width={42}
                label={{
                  value: "HEALTH SCORE",
                  angle: -90,
                  position: "insideLeft",
                  offset: 8,
                  fill: "var(--ink-dim)",
                  fontSize: 10,
                  letterSpacing: 1.5,
                }}
              />
              <ZAxis type="number" dataKey="z" range={[80, 420]} />
              <ReferenceLine x={0} stroke="var(--line)" strokeDasharray="4 4" />
              <ReferenceLine y={65} stroke="var(--line-soft)" strokeDasharray="4 4" />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<CustomTooltip />} />
              <Scatter
                data={data}
                cursor="pointer"
                onClick={(point) => {
                  const row = point as unknown as { id?: string; payload?: { id?: string } };
                  const id = row.id ?? row.payload?.id;
                  if (id) onSelect(id);
                }}
              >
                {data.map((d) => (
                  <Cell
                    key={d.id}
                    fill={bubbleColor(d.status)}
                    fillOpacity={0.85}
                    stroke={bubbleColor(d.status)}
                    strokeWidth={1.5}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="ph-legend">
        <div className="ph-legend-title">How to read</div>
        <div className="ph-legend-row">
          <i className="ok" /> Healthy &amp; improving
        </div>
        <div className="ph-legend-row">
          <i className="warn" /> Needs monitoring
        </div>
        <div className="ph-legend-row">
          <i className="risk" /> At risk
        </div>
        <div className="ph-legend-note">Bubble size · relative to revenue</div>
      </div>

      <p className="ph-hint">
        Hover over a client to see key insights. Click a bubble to open that client.
      </p>
    </div>
  );
}
