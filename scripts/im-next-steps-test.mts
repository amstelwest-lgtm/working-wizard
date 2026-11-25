/**
 * Next undone step on the Implementation Manager checklist.
 * Run: pnpm test:im-next-steps
 */
import { buildImNextSteps, markStepDone, nextUndoneStep } from "../src/lib/im-next-steps.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const steps = [
  { id: "monthly-client-update" },
  { id: "document-collection" },
  { id: "cash-flow" },
];

assert(nextUndoneStep(steps, [])?.id === "monthly-client-update", "the first step is next when none are done");
assert(
  nextUndoneStep(steps, ["monthly-client-update"])?.id === "document-collection",
  "a done step is skipped",
);
assert(nextUndoneStep(steps, ["cash-flow", "monthly-client-update"])?.id === "document-collection", "order is the list order");
assert(nextUndoneStep(steps, steps.map((step) => step.id)) === null, "every step done has no next step");
assert(nextUndoneStep([], []) === null, "an empty list has no next step");
assert(markStepDone(["cash-flow"], "cash-flow").join(",") === "cash-flow", "marking a done step does not duplicate it");

const client = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const rows = [
  { playId: "cash-flow", section: "lead" as const, actionHref: `/clients/${client}?report=forecast&action=preview` },
  { playId: "monthly-client-update", section: "lead" as const, actionHref: `/clients/${client}?tab=portal&section=routines` },
  { playId: "budget", section: "already_covered" as const, actionHref: `/clients/${client}?tab=budget` },
];
const before = buildImNextSteps({ rows, integrationStarted: false, sendAgentAllowed: true });
assert(before.map((step) => step.id).join(",") === "monthly-client-update,cash-flow", "lead steps follow the gap order");
assert(before[0]?.kind === "start", "the month-end update waits for Start integration");
assert(!before.some((step) => step.id === "budget"), "already covered work is not a next step");
const after = buildImNextSteps({ rows, integrationStarted: true, sendAgentAllowed: true });
assert(after[0]?.href?.includes("section=routines"), "after Start integration the update opens Routines");
const blocked = buildImNextSteps({
  rows: [
    {
      playId: "document-collection",
      section: "lead",
      actionHref: `/clients/${client}?tab=portal&section=send-agent`,
    },
  ],
  integrationStarted: true,
  sendAgentAllowed: false,
});
assert(blocked[0]?.href?.includes("agent=financial_manager"), "a firm off the send list asks the Financial Manager");
assert(!/whatsapp/i.test(JSON.stringify(before)), "the steps do not name a chat app");

console.log("im-next-steps-test: ok");
