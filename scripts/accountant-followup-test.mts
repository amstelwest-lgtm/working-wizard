/**
 * Accountant follow-up queue: dashboard Chase → Action Plan overdue filter.
 * Run: pnpm test:accountant-followup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFollowUpQueue } from "../src/lib/portfolio-dashboard";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const queue = buildFollowUpQueue(
  [
    { id: "c-clean", name: "Clean Co", overdueActions: 0, openActions: 0 },
    { id: "c-open", name: "Open Co", overdueActions: 0, openActions: 2 },
    { id: "c-over", name: "Overdue Co", overdueActions: 3, openActions: 4 },
    { id: "c-over-b", name: "Also Overdue", overdueActions: 3, openActions: 3 },
  ],
  8,
);
assert(queue.length === 3, "drops clients with nothing outstanding");
assert(queue[0].clientId === "c-over", "overdue count ranks first");
assert(queue[1].clientId === "c-over-b", "tie-break overdue by open count then name");
assert(queue[2].clientId === "c-open", "open-only clients still appear after overdue");

const capped = buildFollowUpQueue(
  Array.from({ length: 12 }, (_, i) => ({
    id: `c-${i}`,
    name: `Client ${i}`,
    overdueActions: 0,
    openActions: 1,
  })),
  8,
);
assert(capped.length === 8, "follow-up queue is capped");

const dashSrc = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dashSrc.includes('id="follow-up"'), "dashboard has follow-up panel");
assert(dashSrc.includes("buildFollowUpQueue"), "dashboard uses follow-up queue");
assert(dashSrc.includes('tab: "plan"'), "Chase opens Action Plan tab");
assert(dashSrc.includes('filter: "overdue"'), "overdue Chase deep-links filter=overdue");
assert(dashSrc.includes("Follow up on Action Plan"), "client row has follow-up action");
assert(dashSrc.includes("openClientPlan"), "attention cards can open the plan");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes("filter?: string"), "client search accepts filter");
assert(clientSrc.includes('search.filter === "overdue"'), "Action Plan receives overdue filter");
assert(clientSrc.includes("initialFilter="), "Action Plan is given initialFilter");

console.log("accountant-followup-test: ok");
