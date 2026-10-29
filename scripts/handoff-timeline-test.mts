/**
 * Hand-off timeline: what a bot did, from agent_runs + agent_findings.
 * Run: pnpm test:handoff-timeline
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  handoffTimeline,
  humanizeAgentTool,
  parseHandoffRunDetail,
  pausedHandoffLine,
  sanitizeHandoffTrace,
} from "../src/lib/handoff-timeline";
import { HandoffTimelineList } from "../src/components/handoff-run-timeline";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const baseRow = {
  id: "run-1",
  agent: "analyst",
  status: "queued",
  stop_reason: null,
  summary: "",
  error: null,
  trace: [],
  queued_at: "2026-10-27T09:00:00Z",
  started_at: null,
  finished_at: null,
};

assert(humanizeAgentTool("get_financial_snapshot") === "Read the P&L and balance sheet", "known tools read as a sentence");
assert(humanizeAgentTool("record_finding") === "Wrote a finding", "record_finding is humanised");
assert(humanizeAgentTool("get_widget_count") === "Checked widget count", "unknown tools still read as an action");
assert(humanizeAgentTool(null, "Planned") === "Planned", "a step with no tool keeps its label");

const trace = sanitizeHandoffTrace([
  { tool: "record_finding", label: "x", status: "ok", happened: true, args: { secret: 1 }, rejected_args: "{}" },
]);
assert(trace.length === 1 && !("args" in trace[0]) && !("rejected_args" in trace[0]), "trace args never reach the browser");

const queued = parseHandoffRunDetail(baseRow, []);
assert(queued, "a queued row parses");
let steps = handoffTimeline({ agentName: "Analyst", run: queued });
assert(steps.map((s) => s.key).join(",") === "queued,started", "queued shows handed and waiting");
assert(steps[1].state === "active" && steps[1].label.includes("Waiting"), "queued waits for the runner");

const running = parseHandoffRunDetail({ ...baseRow, status: "running", started_at: "2026-10-27T09:00:05Z" }, []);
steps = handoffTimeline({ agentName: "Analyst", run: running });
assert(steps.at(-1)?.key === "working" && steps.at(-1)?.state === "active", "running shows Working");

const finished = parseHandoffRunDetail(
  {
    ...baseRow,
    status: "succeeded",
    stop_reason: "objective_complete",
    summary: "Debtors are 62 days; chase the top three.",
    started_at: "2026-10-27T09:00:05Z",
    finished_at: "2026-10-27T09:01:00Z",
    trace: [
      { tool: "get_financial_snapshot", label: "", status: "ok", happened: true },
      { tool: "get_ratios", label: "", status: "ok", happened: true },
      { tool: "record_finding", label: "", status: "ok", happened: true, args: { title: "x" } },
    ],
  },
  [{ id: "f-1", title: "Debtor days are high", detail: "62 days against 45", severity: "act" }],
);
assert(finished && finished.findings.length === 1, "findings attach to the run");
steps = handoffTimeline({ agentName: "Analyst", run: finished });
assert(
  steps.map((s) => s.label).join(" | ") ===
    "Assigned to Analyst | Analyst started | Read the P&L and balance sheet | Checked the ratios | Wrote a finding | Finished",
  `finished run lists every step: ${steps.map((s) => s.label).join(" | ")}`,
);
assert(steps.at(-1)?.detail?.includes("Debtors are 62 days"), "the finish step carries the summary");

const none = parseHandoffRunDetail(
  { ...baseRow, status: "succeeded", stop_reason: "no_further_action", finished_at: "2026-10-27T09:01:00Z" },
  [],
);
steps = handoffTimeline({ agentName: "Advisor", run: none });
assert(steps.at(-1)?.label === "Finished, no further action needed", "finished with nothing to write says so");

const stopped = parseHandoffRunDetail(
  { ...baseRow, status: "partial", stop_reason: "insufficient_information", finished_at: "2026-10-27T09:01:00Z" },
  [],
);
steps = handoffTimeline({ agentName: "Analyst", run: stopped });
assert(steps.at(-1)?.state === "failed" && steps.at(-1)?.label.includes("not enough information"), "a stop reason is plain");

const failed = parseHandoffRunDetail({ ...baseRow, status: "failed", error: "Claude timed out" }, []);
steps = handoffTimeline({ agentName: "Analyst", run: failed });
assert(steps.at(-1)?.label === "Analyst could not finish" && steps.at(-1)?.detail === "Claude timed out", "failure shows the error");

const refused = parseHandoffRunDetail(
  {
    ...baseRow,
    status: "succeeded",
    stop_reason: "tool_blocked",
    finished_at: "2026-10-27T09:01:00Z",
    trace: [{ tool: "assign_task", status: "refused", happened: false }],
  },
  [],
);
steps = handoffTimeline({ agentName: "Financial Manager", run: refused });
assert(steps.find((s) => s.key === "step-0")?.state === "failed", "a refused tool is marked failed");

steps = handoffTimeline({ agentName: "Advisor", run: null, paused: true, handedAt: "2026-10-27T09:00:00Z" });
assert(steps.at(-1)?.label === "Not started: Advisor is paused", "a paused runner says so");
assert(pausedHandoffLine("Advisor") === "Not started: Advisor is paused", "paused line copy");

const html = renderToStaticMarkup(createElement(HandoffTimelineList, { steps: handoffTimeline({ agentName: "Analyst", run: finished }) }));
assert(html.includes('data-step-state="done"') && html.includes("Wrote a finding"), "the list renders each step with its state");

const status = readFileSync(new URL("../src/components/handoff-run-status.tsx", import.meta.url), "utf8");
assert(status.includes("<HandoffRunTimeline"), "the hand-off row offers the timeline");
assert(status.includes("data-handoff-reassign"), "a paused hand-off offers Reassign");
const client = readFileSync(new URL("../src/lib/owner-handoff-client.ts", import.meta.url), "utf8");
assert(client.includes("rememberHandoffPaused(input.actionItemId, input.agent, since)"), "an undispatched hand-off is remembered as paused");
assert(
  client.includes('"id, agent, status, stop_reason, summary, error, trace, queued_at, started_at, finished_at"'),
  "the run detail select reads the trace",
);

console.log("handoff-timeline-test: all assertions passed");
