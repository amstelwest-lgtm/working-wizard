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

const dashSrc = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(dashSrc.includes('id="follow-up"'), "dashboard has follow-up panel");
assert(dashSrc.includes("buildFollowUpQueue"), "dashboard uses follow-up queue");
assert(dashSrc.includes('tab: "plan"'), "Chase opens Action Plan tab");
assert(dashSrc.includes('filter: "overdue"'), "overdue Chase deep-links filter=overdue");
assert(!dashSrc.includes("Follow up on Action Plan"), "follow-up is not a button on the client row");
assert(dashSrc.includes("Chase →"), "the practice follow-up list still chases");
assert(dashSrc.includes("openClientPlan"), "attention cards can open the plan");

const practiceAt = dashSrc.indexOf('view === "practice"');
const clientsAt = dashSrc.indexOf('view === "clients"');
const followAt = dashSrc.indexOf('id="follow-up"');
const insightsAt = dashSrc.indexOf('id="portfolio-insights"');
const playAt = dashSrc.indexOf('id="playbooks"');
assert(practiceAt > 0 && clientsAt > practiceAt, "practice and clients are separate pages");
assert(followAt > practiceAt && followAt < clientsAt, "follow-up is on the practice overview");
assert(insightsAt > practiceAt && insightsAt < clientsAt, "portfolio insights are on the practice overview");
assert(playAt > practiceAt && playAt < clientsAt, "playbooks are on the practice overview");
assert(dashSrc.indexOf('id="clients-table"') > clientsAt, "the client table is on the clients page");
assert(dashSrc.includes("hideWhenClear"), "clear portfolio does not render an empty card");
assert(!dashSrc.includes("nice work"), "empty needs-attention does not celebrate");
const exceptionsSrc = readFileSync(resolve("src/components/portfolio-exceptions.tsx"), "utf8");
assert(exceptionsSrc.includes('id="needs-attention"'), "urgent items use one needs-attention strip");
assert(exceptionsSrc.includes("mergeNeedsAttention"), "health and sign-off share that strip");
assert(!dashSrc.includes('className="attn-strip"'), "dashboard does not render a second attention strip");
assert(
  dashSrc.includes('<details className="home-fold" id="playbooks">'),
  "playbook library is collapsed by default",
);

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes("filter?: string"), "client search accepts filter");
assert(clientSrc.includes('search.filter === "overdue"'), "Action Plan receives overdue filter");
assert(clientSrc.includes("initialFilter="), "Action Plan is given initialFilter");

console.log("accountant-followup-test: ok");
