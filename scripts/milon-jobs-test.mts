/**
 * Jobs board counts and the first-run step are pure. This pins them.
 * Run: pnpm test:milon-jobs
 */
import { readFileSync } from "node:fs";
import {
  JOB_KEYS,
  JOB_META,
  firstRunStep,
  jobForRoutine,
  jobPickerRows,
  jobsBoardCounts,
  jobsForAgent,
  type JobsBoardClient,
} from "../src/lib/milon-jobs.ts";
import { clientNavSearch } from "../src/lib/client-route-search.ts";
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

// A December year start ends on 30 Nov. On 26 Nov that IRP6 is inside the watch window.
const fyDecember = {
  version: 1,
  payMotion: "time_delivery",
  volumeUnit: "billable_hours",
  templateId: "services_hours",
  fyStartMonth: 12,
};
const nearNow = new Date("2026-11-26T12:00:00+02:00");
const taxBook: JobsBoardClient[] = [
  {
    ...client({ id: "acme", name: "Acme", taxEnabled: true }),
    operatingProfile: fyDecember,
  },
  {
    ...client({ id: "beta", name: "Beta", taxEnabled: true, individual: true }),
    operatingProfile: {
      version: 1,
      payMotion: "time_delivery",
      volumeUnit: "billable_hours",
      templateId: "services_hours",
      fyStartMonth: 3,
    },
  },
  client({ id: "gamma", name: "Gamma", taxEnabled: false, operatingProfile: fyDecember }),
  client({ id: "", name: "Blank", taxEnabled: true, operatingProfile: fyDecember }),
];
const taxRows = jobPickerRows("tax", taxBook, nearNow, [
  { clientId: "acme", form: "IRP6", period: 2, status: "draft" },
]);
assert(taxRows.length > 0, "a return inside the watch window is listed");
assert(taxRows.every((row) => row.clientId.trim().length > 0), "every tax row names a client");
assert(taxRows.every((row) => row.headingId === "tax"), "tax rows open the tax tab");
assert(!taxRows.some((row) => row.clientId === "gamma" || row.clientId === "beta"), "only the due ZA client is listed");
assert(taxRows.some((row) => row.clientId === "acme" && row.form === "IRP6" && row.status === "Draft"), taxRows.map((row) => `${row.form} ${row.status}`).join(", "));
assert(taxRows.every((row) => row.due && row.form && row.status), "tax rows show the return, the due date and the draft status");

const annualNow = new Date("2027-02-24T12:00:00+02:00");
const annual = jobPickerRows("tax", taxBook, annualNow);
const itr12 = annual.find((row) => row.clientId === "beta" && row.form === "ITR12");
assert(itr12?.form === "ITR12" && itr12.status === "No draft" && Boolean(itr12.due), "an individual annual return is ITR12");
assert(!annual.some((row) => row.form === "ITR14" && row.clientId === "beta"), "an individual annual return is not labelled ITR14");

const collectRows = jobPickerRows("collect", book, nearNow);
assert(collectRows.map((row) => row.clientId).join(",") === "acme,gamma", collectRows.map((row) => row.clientId).join(","));
assert(collectRows.every((row) => row.headingId === "send-agent"), "collect rows open send-agent");
assert(jobPickerRows("collect", [client({ id: "quiet" })], nearNow).length === 0, "nothing outstanding is an empty list");

const adviseRows = jobPickerRows("advise", book, nearNow);
assert(adviseRows.map((row) => row.clientId).join(",") === "acme,gamma", adviseRows.map((row) => row.detail ?? "").join(" | "));
assert(adviseRows.every((row) => row.headingId === "reports"), "advise rows open reports");
assert(jobPickerRows("advise", [client({ id: "quiet" })], nearNow).length === 0, "no figures means no advise row");

for (const row of [...taxRows, ...annual, ...collectRows, ...adviseRows]) {
  assert(row.clientId.trim().length > 0, "no picker row drafts without a client id");
  const search = clientNavSearch({}, row.headingId) as { tab?: string; section?: string };
  assert(Boolean(search.tab), `${row.headingId} is a client-scoped tab`);
}

const ui = readFileSync(new URL("../src/components/practice-jobs-board.tsx", import.meta.url), "utf8");
assert(!ui.includes("count.clientId"), "no jobs-board CTA opens a pre-picked client");
assert(ui.includes("params={{ clientId: row.clientId }}"), "picker rows link to that client");
assert(ui.includes("clientNavSearch({}, row.headingId)"), "picker rows use the client nav helper");
assert(ui.includes('data-job-picker-empty=""'), "an empty picker is one line, not a draft");

console.log("milon-jobs: ok");
