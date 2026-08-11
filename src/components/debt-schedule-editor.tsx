/**
 * Debt & facilities editor — captures schedule for the Leverage PDF.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  type DebtSchedule,
  type DebtFacility,
  newDebtFacility,
  totalDebtFromSchedule,
} from "@/lib/debt-schedule";

function money(n: number): string {
  return `R ${Math.round(n).toLocaleString("en-ZA")}`;
}

export function DebtScheduleEditor({
  value,
  onChange,
  disabled,
}: {
  value: DebtSchedule;
  onChange: (next: DebtSchedule) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(value.lines.length > 0);

  const patchLine = (id: string, patch: Partial<DebtFacility>) => {
    onChange({
      ...value,
      lines: value.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  };

  const removeLine = (id: string) => {
    onChange({ ...value, lines: value.lines.filter((l) => l.id !== id) });
  };

  const addLine = () => {
    onChange({ ...value, lines: [...value.lines, newDebtFacility()] });
    setOpen(true);
  };

  const total = totalDebtFromSchedule(value);

  return (
    <div className="card" style={{ marginTop: 16, padding: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 18px",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          color: "var(--ink)",
          textAlign: "left",
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
            Debt & facilities
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: "var(--ink-dim)" }}>
            {value.lines.length === 0
              ? "No facilities captured — leverage report will show an empty schedule (no invented lines)."
              : `${value.lines.length} facility${value.lines.length === 1 ? "" : "ies"} · total ${money(total)}`}
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--line)", padding: "12px 18px 16px" }}>
          <div style={{ display: "grid", gap: 10 }}>
            {value.lines.map((line) => (
              <div
                key={line.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 0.7fr 0.7fr auto",
                  gap: 8,
                  alignItems: "end",
                }}
              >
                <label style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                  Facility
                  <input
                    disabled={disabled}
                    value={line.label}
                    onChange={(e) => patchLine(line.id, { label: e.target.value })}
                    placeholder="e.g. ABSA term loan"
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--bg, #0a0e1a)",
                      color: "var(--ink)",
                    }}
                  />
                </label>
                <label style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                  Amount (R)
                  <input
                    disabled={disabled}
                    type="number"
                    value={line.amount || ""}
                    onChange={(e) =>
                      patchLine(line.id, { amount: parseFloat(e.target.value) || 0 })
                    }
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--bg, #0a0e1a)",
                      color: "var(--ink)",
                    }}
                  />
                </label>
                <label style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                  Rate %
                  <input
                    disabled={disabled}
                    type="number"
                    step="0.1"
                    value={line.annual_rate_pct ?? ""}
                    onChange={(e) =>
                      patchLine(line.id, {
                        annual_rate_pct:
                          e.target.value === "" ? null : parseFloat(e.target.value),
                      })
                    }
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--bg, #0a0e1a)",
                      color: "var(--ink)",
                    }}
                  />
                </label>
                <label style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                  Maturity
                  <input
                    disabled={disabled}
                    type="number"
                    value={line.maturity_year ?? ""}
                    onChange={(e) =>
                      patchLine(line.id, {
                        maturity_year:
                          e.target.value === "" ? null : parseInt(e.target.value, 10),
                      })
                    }
                    placeholder="2028"
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--bg, #0a0e1a)",
                      color: "var(--ink)",
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeLine(line.id)}
                  aria-label="Remove facility"
                  style={{
                    height: 36,
                    width: 36,
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--risk, #e25c5c)",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 14,
              alignItems: "end",
            }}
          >
            <label style={{ fontSize: 11, color: "var(--ink-dim)" }}>
              Drawings YTD (R)
              <input
                disabled={disabled}
                type="number"
                value={value.drawings_ytd ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    drawings_ytd: e.target.value === "" ? null : parseFloat(e.target.value),
                  })
                }
                style={{
                  display: "block",
                  width: 160,
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--bg, #0a0e1a)",
                  color: "var(--ink)",
                }}
              />
            </label>
            <label style={{ fontSize: 11, color: "var(--ink-dim)" }}>
              Prior equity (R)
              <input
                disabled={disabled}
                type="number"
                value={value.prior_equity ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    prior_equity: e.target.value === "" ? null : parseFloat(e.target.value),
                  })
                }
                placeholder="From prior snapshot if blank"
                style={{
                  display: "block",
                  width: 180,
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--bg, #0a0e1a)",
                  color: "var(--ink)",
                }}
              />
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={addLine}
              className="btn ghost mini"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Plus size={14} />
              Add facility
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
