/**
 * Practice digest reuses the existing per-client reasons and ranking.
 * Run: pnpm test:practice-today-digest
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildAttentionItems,
  needsAttentionToday,
  practiceNeedsAttention,
  todayAttentionAction,
} from "../src/lib/portfolio-dashboard";
import type { OverallHealth } from "../src/lib/health-score";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

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
  ]),
  [
    {
      clientId: "hot",
      name: "Hot Co",
      exceptions: [{ severity: 1, label: "Pack waiting for sign-off", tab: "plan" }],
    },
  ],
);

const today = needsAttentionToday(book.items);
assert(today[0]?.clientId === "hot", "the critical client ranks first");
assert(today[0]?.reason.includes("Pack waiting for sign-off"), today[0]?.reason ?? "");
assert(today[0]?.reason.includes("Cash"), "the health reason is kept");
assert(todayAttentionAction(today[0]!) === "Chase →", "overdue plan work is the chase action");
assert(todayAttentionAction({ tab: "ratios", openPlan: false, overdue: false }) === "Open →", "other rows open");

const src = readFileSync(resolve("src/components/portfolio-exceptions.tsx"), "utf8");
assert(src.includes("Needs attention today"), "the practice strip is titled for today");
assert(src.includes("needsAttentionToday"), "the strip uses the ranked queue");
assert(src.includes("todayAttentionAction"), "the one-click label comes from the shared helper");
assert(src.includes("{row.reason}"), "the row prints the existing reason");
assert(src.includes('id="needs-attention"'), "it stays the one attention strip");

console.log("practice-today-digest ok");
