/**
 * Tests for Phase 4 workspace helpers + publish replace/merge.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/cash-from-banks-workspace-test.mts
 */
import {
  mergeDraftLines,
  moveLineToBucket,
  splitDraftLine,
  confirmAllProposed,
} from "../src/lib/cash-from-banks.workspace";
import {
  buildCashflowPublishPayload,
  existingCashflowIsMeaningful,
} from "../src/lib/cash-from-banks.publish";
import type { CashForecastDraftLine } from "../src/lib/cash-from-banks.types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function line(partial: Partial<CashForecastDraftLine> & Pick<CashForecastDraftLine, "id" | "name">): CashForecastDraftLine {
  return {
    side: "outflow",
    bucket: "opex",
    amount: 1000,
    cadence: "monthly",
    start_week: 1,
    split_count: 3,
    status: "proposed",
    confidence: 0.7,
    source: "ai",
    txn_count: 2,
    sample_descriptions: [],
    ...partial,
  };
}

const a = line({ id: "a", name: "Card fees A", amount: 100, bucket: "opex" });
const b = line({ id: "b", name: "Card fees B", amount: 120, bucket: "opex" });
const c = line({ id: "c", name: "Payroll", amount: 12000, bucket: "payroll", cadence: "weekly" });

let lines = [a, b, c];
lines = moveLineToBucket(lines, "c", "trading");
assert(lines.find((l) => l.id === "c")?.bucket === "trading", "move to trading");
assert(lines.find((l) => l.id === "c")?.side === "inflow", "trading forces inflow");

lines = mergeDraftLines(lines, ["a", "b"]);
assert(lines.length === 2, `merge should collapse to 2, got ${lines.length}`);
const merged = lines.find((l) => l.source === "merged");
assert(merged, "merged line exists");
assert(merged!.txn_count === 4, "txn counts sum");

lines = splitDraftLine(lines, merged!.id);
assert(lines.length === 3, "split adds a line");
assert(lines.filter((l) => l.name.includes("(A)") || l.name.includes("(B)")).length === 2, "split halves named");

const confirmed = confirmAllProposed(lines);
assert(confirmed.every((l) => l.status !== "proposed"), "confirm all clears proposed");

const existing = {
  startDate: "2026-01-01",
  openingBalance: "999",
  revenue: [{ id: "r1", name: "Old sales", amount: "5000", frequency: "recurring-monthly" as const, startWeek: 1, splitCount: 3 }],
  expenses: [{ id: "e1", name: "Old rent", amount: "2000", frequency: "recurring-monthly" as const, startWeek: 1, splitCount: 3 }],
  other: [],
  revAdj: 90,
};
assert(existingCashflowIsMeaningful(existing), "existing meaningful");

const replaced = buildCashflowPublishPayload({
  lines: confirmed,
  startDate: "2026-08-01",
  openingBalance: 72500,
  policy: "replace",
  existing,
});
assert(replaced.openingBalance === "72500", "replace adopts bank opening");
assert(!replaced.revenue.some((r) => r.name === "Old sales"), "replace drops old revenue");

const mergedPub = buildCashflowPublishPayload({
  lines: confirmed,
  startDate: "2026-08-01",
  openingBalance: 72500,
  policy: "merge",
  existing,
  adoptBankBalances: false,
});
assert(mergedPub.openingBalance === "999", "merge can keep old opening");
assert(mergedPub.revenue.some((r) => r.name === "Old sales"), "merge keeps old revenue");
assert(mergedPub.revAdj === 90, "merge keeps scenario knobs");

console.log("ok — workspace merge/split/move + publish policies");
