/**
 * What a bot did after a hand-off, as an ordered list of steps.
 * Built from agent_runs (queued_at, started_at, finished_at, status,
 * stop_reason, summary, error, trace) and the run's agent_findings.
 * Runners write the trace when they finish, so a running run shows
 * Queued and Started only. Tool arguments never reach the browser.
 */

export type HandoffTraceStep = {
  tool: string | null;
  label: string;
  status: string;
  happened: boolean;
};

export type HandoffRunFinding = {
  id: string;
  title: string;
  detail: string | null;
  severity: string | null;
};

export type HandoffRunDetail = {
  id: string;
  agent: string;
  status: string;
  stopReason: string | null;
  summary: string;
  error: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  trace: HandoffTraceStep[];
  findings: HandoffRunFinding[];
};

export type TimelineStepState = "done" | "active" | "pending" | "failed" | "skipped";

export type TimelineStep = {
  key: string;
  label: string;
  state: TimelineStepState;
  at?: string | null;
  detail?: string | null;
};

const TOOL_LABELS: Record<string, string> = {
  get_company: "Read the company profile",
  get_financial_snapshot: "Read the P&L and balance sheet",
  get_health: "Checked the health score",
  get_ratios: "Checked the ratios",
  get_cash_flow: "Read the cash forecast",
  get_statement_history: "Compared earlier statements",
  get_score_history: "Looked at how the score has moved",
  get_variance: "Checked budget against actual",
  get_budget_status: "Checked the budget",
  get_data_freshness: "Checked how current the books are",
  get_books_quality: "Checked the quality of the books",
  get_team_findings: "Read the other bots' findings",
  get_own_memory: "Read its notes on this client",
  get_inbox: "Read its inbox",
  get_invite_status: "Checked the owner invite",
  get_advisory_position: "Read the advisory position",
  list_recommendations: "Listed open recommendations",
  list_prior_outcomes: "Looked at past outcomes",
  list_tasks: "Listed open tasks",
  list_data_requests: "Listed open data requests",
  list_blockers: "Listed blockers",
  answer_from_brain: "Looked up the client notes",
  propose_next_steps: "Proposed next steps",
  draft_deliverable: "Drafted a deliverable",
  create_task_from_recommendation: "Created a task",
  assign_task: "Assigned a task",
  request_human: "Asked a person to step in",
  record_finding: "Wrote a finding",
  record_draft: "Wrote a draft for review",
  send_agent_message: "Messaged another bot",
  propose_figure_adjustment: "Proposed a figure change",
};

const STOP_LABELS: Record<string, string> = {
  objective_complete: "Finished",
  no_further_action: "Finished, no further action needed",
  insufficient_information: "Stopped: not enough information",
  tool_blocked: "Stopped: a step was blocked",
  needs_human: "Stopped: needs a person",
  safety_limit: "Stopped at the safety limit",
  cost_ceiling: "Stopped at the cost ceiling",
};

/** One plain sentence per tool. Unknown tools still read as an action. */
export function humanizeAgentTool(tool: string | null | undefined, label?: string | null): string {
  const key = (tool ?? "").trim();
  if (key && TOOL_LABELS[key]) return TOOL_LABELS[key];
  const fallback = (label ?? "").trim();
  if (fallback) return fallback;
  if (!key) return "Thought about the next step";
  return `Checked ${key.replace(/^(get|list)_/, "").replace(/_/g, " ")}`;
}

export function handoffRunActive(status: string | null | undefined): boolean {
  return status === "queued" || status === "running";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw : null;
}

/** Keeps tool, label, status, and happened. Drops args and rejected_args. */
export function sanitizeHandoffTrace(raw: unknown): HandoffTraceStep[] {
  if (!Array.isArray(raw)) return [];
  const out: HandoffTraceStep[] = [];
  for (const row of raw) {
    const rec = asRecord(row);
    if (!rec) continue;
    out.push({
      tool: str(rec.tool),
      label: str(rec.label) ?? "",
      status: str(rec.status) ?? "ok",
      happened: rec.happened !== false,
    });
  }
  return out;
}

export function parseHandoffRunDetail(row: unknown, findings: unknown): HandoffRunDetail | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const id = str(rec.id);
  if (!id) return null;
  const parsedFindings: HandoffRunFinding[] = [];
  if (Array.isArray(findings)) {
    for (const f of findings) {
      const fr = asRecord(f);
      const fid = fr ? str(fr.id) : null;
      if (!fr || !fid) continue;
      parsedFindings.push({
        id: fid,
        title: str(fr.title) ?? "Finding",
        detail: str(fr.detail),
        severity: str(fr.severity),
      });
    }
  }
  return {
    id,
    agent: str(rec.agent) ?? "",
    status: str(rec.status) ?? "queued",
    stopReason: str(rec.stop_reason),
    summary: str(rec.summary) ?? "",
    error: str(rec.error),
    queuedAt: str(rec.queued_at),
    startedAt: str(rec.started_at),
    finishedAt: str(rec.finished_at),
    trace: sanitizeHandoffTrace(rec.trace),
    findings: parsedFindings,
  };
}

/**
 * Queued → Started → one row per tool the bot used → Finished / Stopped.
 * A paused runner has no run row: it shows Handed to → Not started.
 */
export function handoffTimeline(input: {
  agentName: string;
  run: HandoffRunDetail | null;
  paused?: boolean;
  handedAt?: string | null;
}): TimelineStep[] {
  const { agentName, run } = input;
  if (!run) {
    if (input.paused) {
      return [
        {
          key: "handed",
          label: `Handed to ${agentName}`,
          state: "done",
          at: input.handedAt ?? null,
        },
        { key: "paused", label: `Not started: ${agentName} is paused`, state: "skipped" },
      ];
    }
    return [
      { key: "handed", label: `Handed to ${agentName}`, state: "done", at: input.handedAt ?? null },
    ];
  }
  const steps: TimelineStep[] = [];
  const failed = run.status === "failed" || run.status === "dead" || run.status === "cancelled";
  const finished = !handoffRunActive(run.status);
  steps.push({ key: "queued", label: `Handed to ${agentName}`, state: "done", at: run.queuedAt });
  if (run.status === "skipped") {
    steps.push({
      key: "skipped",
      label: `Not started: ${agentName} skipped this run`,
      state: "skipped",
    });
    return steps;
  }
  const started = Boolean(run.startedAt) || run.status === "running" || finished;
  steps.push({
    key: "started",
    label: started ? `${agentName} started` : `Waiting for ${agentName} to start`,
    state: started ? "done" : "active",
    at: run.startedAt,
  });
  run.trace.forEach((step, index) => {
    const bad = step.status === "error" || step.status === "refused";
    steps.push({
      key: `step-${index}`,
      label: humanizeAgentTool(step.tool, step.label),
      state: bad ? "failed" : step.happened ? "done" : "skipped",
      detail: bad ? (step.status === "refused" ? "Blocked" : "Did not work") : null,
    });
  });
  if (!finished) {
    if (started) steps.push({ key: "working", label: "Working", state: "active" });
    return steps;
  }
  if (failed) {
    steps.push({
      key: "end",
      label: run.status === "cancelled" ? "Cancelled" : `${agentName} could not finish`,
      state: "failed",
      at: run.finishedAt,
      detail: run.error ? run.error.slice(0, 160) : null,
    });
    return steps;
  }
  const stop = run.stopReason ? STOP_LABELS[run.stopReason] : null;
  const stoppedEarly = Boolean(
    run.stopReason &&
    run.stopReason !== "objective_complete" &&
    run.stopReason !== "no_further_action",
  );
  steps.push({
    key: "end",
    label: stop ?? "Finished",
    state: stoppedEarly ? "failed" : "done",
    at: run.finishedAt,
    detail: run.summary ? run.summary.slice(0, 240) : null,
  });
  return steps;
}

const PAUSED_PREFIX = "milon.handoffPaused:";

/** The runner flag is server-only, so a paused hand-off is remembered on this device. */
export function rememberHandoffPaused(
  actionItemId: string,
  agent: string,
  at = new Date().toISOString(),
): void {
  if (typeof localStorage === "undefined" || !actionItemId) return;
  try {
    localStorage.setItem(`${PAUSED_PREFIX}${actionItemId}`, JSON.stringify({ agent, at }));
  } catch {
    /* storage full or blocked */
  }
}

export function clearHandoffPaused(actionItemId: string): void {
  if (typeof localStorage === "undefined" || !actionItemId) return;
  try {
    localStorage.removeItem(`${PAUSED_PREFIX}${actionItemId}`);
  } catch {
    /* blocked */
  }
}

export function readHandoffPaused(
  actionItemId: string | null | undefined,
): { agent: string; at: string } | null {
  if (typeof localStorage === "undefined" || !actionItemId) return null;
  try {
    const raw = localStorage.getItem(`${PAUSED_PREFIX}${actionItemId}`);
    if (!raw) return null;
    const rec = asRecord(JSON.parse(raw));
    const agent = rec ? str(rec.agent) : null;
    const at = rec ? str(rec.at) : null;
    return agent && at ? { agent, at } : null;
  } catch {
    return null;
  }
}

export function pausedHandoffLine(agentName: string): string {
  return `Not started: ${agentName} is paused`;
}
