/**
 * Jobs board counts and the first-run step are pure. This pins them.
 * Run: pnpm test:milon-jobs
 */
import {
  JOB_KEYS,
  JOB_META,
  firstRunStep,
  jobForRoutine,
  jobsBoardCounts,
  jobsForAgent,
  type JobsBoardClient,
} from "../src/lib/milon-jobs.ts";
import { ROUTINE_ACTION_KINDS } from "../src/lib/client-routines.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function client(over: Partial<JobsBoardClient> & { id: string }): JobsBoardClient {
  return {
    name: over.id,
    openQueries: 0,
    chaseActions: [],
    openActions: 0,
    overdueActions: 0,
    taxEnabled: false,
    taxDeadlineNear: false,
    reportsReady: 0,
    hasFigures: false,
    ...over,
  };
}

// Every routine kind belongs to a job, and every job names at least one agent.
for (const routine of ROUTINE_ACTION_KINDS) {
  assert(JOB_KEYS.includes(jobForRoutine(routine)), `${routine} maps to a job`);
}
for (const key of JOB_KEYS) {
  assert(JOB_META[key].agents.length > 0, `${key} has an agent`);
}
assert(jobsForAgent("tax_specialist").includes("tax"), "tax specialist is on Tax");
assert(jobsForAgent("financial_manager").includes("collect"), "financial manager is on Collect");

// Empty book.
const empty = jobsBoardCounts([]);
assert(empty.collect.count === 0 && empty.collect.clientId === null, "empty collect");
assert(empty.tax.line.includes("No South African clients"), "empty tax line");
assert(empty.advise.line.includes("Connect or upload"), "empty advise line");

// A small SA book.
const book = [
  client({
    id: "acme",
    openQueries: 2,
    chaseActions: [{ title: "Bank statement", overdue: true }],
    taxEnabled: true,
    taxDeadlineNear: true,
    hasFigures: true,
    reportsReady: 3,
  }),
  client({
    id: "beta",
    openQueries: 0,
    taxEnabled: true,
    taxDeadlineNear: true,
    hasFigures: false,
  }),
  client({
    id: "gamma",
    chaseActions: [{ title: "Invoices", overdue: false }],
    hasFigures: true,
    reportsReady: 1,
    overdueActions: 2,
  }),
];
const counts = jobsBoardCounts(book);
assert(
  counts.collect.count === 2,
  `collect counts clients with anything outstanding, got ${counts.collect.count}`,
);
assert(counts.collect.line.startsWith("4 items outstanding across 2 clients"), counts.collect.line);
assert(counts.collect.clientId === "acme", "collect opens the client with overdue chases first");
assert(counts.tax.count === 2, "tax counts returns due soon");
assert(counts.tax.line.includes("1 still need figures"), counts.tax.line);
assert(counts.tax.clientId === "acme", "tax opens a client with a return due");
assert(counts.advise.count === 2, "advise counts clients with a pack ready");
assert(counts.advise.line.includes("1 with overdue action points"), counts.advise.line);
assert(counts.advise.clientId === "acme", "advise opens the client with most reports ready");
assert(counts.books.clientId === null, "books has no target yet");

// First run leads to an outcome and stays until one is approved.
assert(
  firstRunStep({
    interviewDone: false,
    clientsWithFigures: 0,
    finishedRuns: 0,
    approvedDrafts: 0,
  }) === "interview",
  "no plan → interview",
);
assert(
  firstRunStep({
    interviewDone: true,
    clientsWithFigures: 0,
    finishedRuns: 0,
    approvedDrafts: 0,
  }) === "connect",
  "plan, no figures → connect",
);
assert(
  firstRunStep({
    interviewDone: true,
    clientsWithFigures: 1,
    finishedRuns: 0,
    approvedDrafts: 0,
  }) === "first_draft",
  "figures → first draft",
);
assert(
  firstRunStep({
    interviewDone: false,
    clientsWithFigures: 5,
    finishedRuns: 3,
    approvedDrafts: 0,
  }) === "interview",
  "skipping the interview keeps the strip",
);
assert(
  firstRunStep({
    interviewDone: false,
    clientsWithFigures: 5,
    finishedRuns: 3,
    approvedDrafts: 1,
  }) === "done",
  "one approval ends first run",
);

console.log("milon-jobs: ok");
