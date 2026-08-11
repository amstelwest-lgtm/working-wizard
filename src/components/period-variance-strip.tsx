/**
 * Period vs prior variance strip for the accountant client page.
 */

import type { VarianceChip } from "@/lib/prior-period";

function fmt(chip: VarianceChip): string {
  if (chip.current == null) return "—";
  if (chip.unit === "pct") return `${(chip.current * 100).toFixed(1)}%`;
  if (chip.unit === "days") return `${Math.round(chip.current)}d`;
  if (chip.unit === "score") return `${Math.round(chip.current)}`;
  if (Math.abs(chip.current) >= 1000) {
    return `R ${Math.round(chip.current).toLocaleString("en-ZA")}`;
  }
  return chip.current.toFixed(1);
}

function fmtDelta(chip: VarianceChip): string {
  if (chip.delta == null) return "vs prior —";
  if (chip.unit === "pct") {
    const pts = chip.delta * 100;
    return `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts`;
  }
  if (chip.unit === "days") return `${chip.delta >= 0 ? "+" : ""}${Math.round(chip.delta)}d`;
  if (chip.unit === "score") return `${chip.delta >= 0 ? "+" : ""}${Math.round(chip.delta)}`;
  if (Math.abs(chip.delta) >= 1000) {
    return `${chip.delta >= 0 ? "+" : ""}R ${Math.round(Math.abs(chip.delta)).toLocaleString("en-ZA")}`;
  }
  return `${chip.delta >= 0 ? "+" : ""}${chip.delta.toFixed(1)}`;
}

function tone(chip: VarianceChip): "ok" | "risk" | "warn" | "neutral" {
  if (chip.status === "na" || chip.status === "flat") return "neutral";
  const improved =
    (chip.status === "up" && chip.higherIsBetter) ||
    (chip.status === "down" && !chip.higherIsBetter);
  return improved ? "ok" : "risk";
}

export function PeriodVarianceStrip({
  chips,
  priorLabel,
  onOpenMovement,
}: {
  chips: VarianceChip[];
  priorLabel?: string | null;
  onOpenMovement?: () => void;
}) {
  if (!chips.length) {
    return (
      <div className="card" style={{ marginTop: 12, padding: "14px 18px" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-dim)",
          }}
        >
          This period vs prior
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-dim)" }}>
          Save at least two period snapshots to unlock variance. Absolute ratios alone are a
          scoreboard — consultants live in the bridge.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12, padding: "14px 18px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-dim)",
            }}
          >
            This period vs prior
          </div>
          {priorLabel && (
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-dim)" }}>
              Compared to {priorLabel}
            </div>
          )}
        </div>
        {onOpenMovement && (
          <button type="button" className="btn ghost mini" onClick={onOpenMovement}>
            Open movement report
          </button>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {chips.map((chip) => {
          const t = tone(chip);
          const color =
            t === "ok" ? "var(--ok)" : t === "risk" ? "var(--risk)" : "var(--ink-dim)";
          return (
            <div
              key={chip.key}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--ink-dim)",
                }}
              >
                {chip.label}
              </div>
              <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
                {fmt(chip)}
              </div>
              <div style={{ marginTop: 2, fontSize: 12, color, fontWeight: 600 }}>
                {fmtDelta(chip)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
