/**
 * Owner and accountant cash-card copy: human dates, one owner roll line,
 * and the rest as short bullets.
 */
import { cashExplainerCopy, humanCalendarDay, humanizeIsoDates } from "../src/lib/cash-explainer";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

assert(humanCalendarDay("2026-10-12") === "12 Oct 2026", humanCalendarDay("2026-10-12"));
assert(humanCalendarDay("2026-10-12", false) === "12 Oct", humanCalendarDay("2026-10-12", false));
assert(
  humanizeIsoDates("from 2026-10-05 to 2026-10-12") === "from 5 Oct 2026 to 12 Oct 2026",
  humanizeIsoDates("from 2026-10-05 to 2026-10-12"),
);

const rolled = cashExplainerCopy({
  rangeStart: "2026-10-12",
  rangeEnd: "2027-01-04",
  floorText: "R 178k",
  anchorNote: "Opening cash was rolled forward 7 days from 2026-10-05 to this week (2026-10-12).",
  cycleNote:
    "Debtor days are 33 on Ratios. That figure is not applied to this forecast. Collections follow the monthly revenue run-rate unless a collection delay in weeks is set.",
  otherNote: null,
  timingNote: null,
});

assert(rolled.range === "12 Oct 2026 – 4 Jan 2027", rolled.range);
assert(rolled.ownerRollLine === "Rolled forward 12 Oct", rolled.ownerRollLine ?? "missing roll line");
assert(rolled.bullets[0] === "Floor R 178k.", rolled.bullets[0] ?? "missing floor");
assert(
  rolled.bullets.some((line) => line === "Rolled forward to 12 Oct 2026 (7 days from 5 Oct 2026)."),
  rolled.bullets.join(" | "),
);
assert(
  rolled.bullets.some((line) => line.includes("Debtor days (33)") && !line.includes("2026-10")),
  rolled.bullets.join(" | "),
);
assert(!rolled.bullets.some((line) => /\d{4}-\d{2}-\d{2}/.test(line)), "ISO date leaked into bullets");

const quiet = cashExplainerCopy({
  rangeStart: "2026-10-12",
  rangeEnd: "2027-01-04",
  floorText: "R 50k",
  anchorNote: null,
  cycleNote: null,
  otherNote: "Estimated from the P&L",
  timingNote: null,
});
assert(quiet.ownerRollLine === null, "no roll line without a roll");
assert(
  quiet.bullets.includes("Estimated from the profit and loss."),
  quiet.bullets.join(" | "),
);

const creditors = cashExplainerCopy({
  rangeStart: null,
  rangeEnd: null,
  floorText: "",
  anchorNote: null,
  cycleNote:
    "Creditor days are 120 on Ratios. That figure is not applied to this forecast — weekly payments follow the scaled monthly run-rate.",
  otherNote: null,
  timingNote: "Timing: collections delayed 2 weeks.",
});
assert(
  creditors.bullets.some((line) => line.startsWith("Payments follow the monthly run-rate. Creditor days (120)")),
  creditors.bullets.join(" | "),
);

console.log("cash-explainer-test: ok");
