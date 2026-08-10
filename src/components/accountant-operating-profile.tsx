/**
 * Accountant-facing view of the client's operating profile answers.
 * Collapsed by default with goal / risk chips; expands to the full 10 answers.
 */

import type { ClientOperatingProfile } from "@/lib/client-profile";
import { profileDisplayRows, profileIndustryLabel } from "@/lib/profile-signals";

function RiskChip({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "risk" | "neutral";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "chip ok"
      : tone === "warn"
        ? "chip warn"
        : tone === "risk"
          ? "chip risk"
          : "chip";
  return (
    <span
      className={cls}
      style={
        tone === "neutral"
          ? { border: "1px solid var(--line)", color: "var(--ink-dim)" }
          : undefined
      }
    >
      {children}
    </span>
  );
}

function concentrationTone(
  c: ClientOperatingProfile["customerConcentration"],
): "ok" | "warn" | "risk" {
  if (c === "diverse") return "ok";
  if (c === "moderate") return "warn";
  return "risk";
}

function debtTone(d: ClientOperatingProfile["debtPosition"]): "ok" | "warn" | "risk" {
  if (d === "none" || d === "light") return "ok";
  if (d === "moderate" || d === "seeking") return "warn";
  return "risk";
}

export function AccountantOperatingProfile({
  profile,
  fallbackType,
}: {
  profile: ClientOperatingProfile | null;
  fallbackType?: string | null;
}) {
  if (!profile) {
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
          Business profile
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-dim)" }}>
          {fallbackType
            ? `Legacy type only · ${fallbackType.replace(/_/g, " ")}. Ask the owner to retake the Milōn profile questions for concentration, debt, and goal context.`
            : "Owner has not completed the business profile yet — health, budget, and advice will be thinner until they do."}
        </p>
      </div>
    );
  }

  const rows = profileDisplayRows(profile);
  const industry = profileIndustryLabel(profile, fallbackType ?? "SME");
  const goalRow = rows.find((r) => r.label === "Owner goal")?.value;

  return (
    <details className="card op-profile" style={{ marginTop: 12, padding: 0 }}>
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          padding: "14px 18px",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
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
            Business profile
          </div>
          <div style={{ marginTop: 4, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
            {industry}
            <span style={{ fontWeight: 400, color: "var(--ink-dim)" }}>
              {" · "}
              {goalRow}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <RiskChip tone={concentrationTone(profile.customerConcentration)}>Concentration</RiskChip>
          <RiskChip tone={debtTone(profile.debtPosition)}>Debt</RiskChip>
          <span style={{ fontSize: 11, color: "var(--ink-dim)" }}>Show answers</span>
        </div>
      </summary>
      <div
        style={{
          borderTop: "1px solid var(--line)",
          padding: "12px 18px 16px",
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        }}
      >
        {rows.map((r) => (
          <div key={r.label}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--ink-dim)",
              }}
            >
              {r.label}
            </div>
            <div style={{ marginTop: 2, fontSize: 13, color: "var(--ink)" }}>{r.value}</div>
          </div>
        ))}
      </div>
    </details>
  );
}
