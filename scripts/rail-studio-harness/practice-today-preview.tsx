/**
 * Labelled fixture for the practice digest. Not a firm's book.
 */
import { PortfolioExceptions } from "@/components/portfolio-exceptions";
import {
  buildAttentionItems,
  practiceNeedsAttention,
} from "@/lib/portfolio-dashboard";
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
  return (
    <div className="min-h-screen bg-[#F4F7FB] px-4 py-6 text-[#102A43]">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Fixture proof — not a client file
      </p>
      <PortfolioExceptions firmId="fixture" hideWhenClear queue={book.items} />
    </div>
  );
}
