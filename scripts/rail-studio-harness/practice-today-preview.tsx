/**
 * Labelled fixture for the practice digest. Not a firm's book.
 */
import { useState } from "react";
import { PortfolioExceptions } from "@/components/portfolio-exceptions";
import { buildAttentionItems, practiceNeedsAttention } from "@/lib/portfolio-dashboard";
import type { OverallHealth } from "@/lib/health-score";

function health(status: OverallHealth["displayStatus"], score: number): OverallHealth {
  return {
    overall: score,
    status,
    displayStatus: status,
    displayLabel: status === "critical" ? "Critical" : "Watch",
    pillars: [],
    weakestPillar: { id: "cash", label: "Cash", score: 30, status: "critical" },
    hasCriticalPillar: status === "critical",
  };
}

const book = practiceNeedsAttention(
  buildAttentionItems([
    {
      id: "hot",
      name: "Hot Co",
      score: 20,
      health: health("critical", 20),
      trendDelta: -6,
      runwayWeeks: 3,
      openQueries: 0,
      openActions: 1,
      overdueActions: 2,
      revenue: 2000,
    },
    {
      id: "calm",
      name: "Calm Co",
      score: 48,
      health: health("at_risk", 48),
      trendDelta: -2,
      runwayWeeks: 10,
      openQueries: 0,
      openActions: 0,
      overdueActions: 0,
      revenue: 1000,
    },
  ]),
  [
    {
      clientId: "hot",
      name: "Hot Co",
      exceptions: [{ severity: 1, label: "Pack waiting for sign-off", tab: "plan" }],
    },
  ],
);

export function PracticeTodayPreview() {
  const [chased, setChased] = useState<string | null>(null);
  return (
    <div className="accountant-portal premium-shell min-h-screen">
      <main className="shell">
        <div className="deliverable-main" style={{ paddingTop: 28 }}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
            Fixture proof — not a client file
          </p>
          <PortfolioExceptions
            firmId="fixture"
            hideWhenClear
            queue={book.items}
            onChase={(_id, name) => setChased(name)}
          />
          {chased ? (
            <p className="mt-3 text-[13px] text-[#3D5270]" role="status">
              Chase draft ready for {chased}. Nothing was sent.
            </p>
          ) : null}
          <section
            className="mt-6 rounded-2xl border border-[color:var(--line)] bg-white p-4 shadow-sm"
            aria-label="Needs attention today"
          >
            <h2 className="m-0 text-[15px] font-bold leading-tight text-[#102A43]">
              Needs attention today
            </h2>
            <p className="sub mt-2">Nothing needs attention.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
