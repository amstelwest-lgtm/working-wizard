/**
 * Practice Home: three job cards, one sign-off line, agent rows under them.
 *
 * The firm sees jobs and outcomes. Agents appear as the people on each job,
 * with chat demoted to an "Ask" link. Counts and picker rows arrive from the
 * practice board. Opening Tax also reads drafts with the tax page's loader.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { AgentKey } from "@/lib/milon-team-feed";
import { agentShortName } from "@/lib/milon-team";
import {
  JOB_META,
  LIVE_JOB_KEYS,
  jobPickerRows,
  type JobKey,
  type JobPickerRow,
  type JobsBoardClient,
  type JobsBoardCount,
  type JobsBoardDraft,
} from "@/lib/milon-jobs";
import { clientNavSearch } from "@/lib/client-route-search";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import "@/components/owner-door/owner-door.css";
import "@/components/practice-jobs-board.css";
import { TAX_AGENT, stageAgentShortName, type StageAgentKey } from "@/lib/tax-specialist/agents";

export type JobsBoardAgentRow = {
  agent: StageAgentKey;
  status: { label: string; tone: string } | null;
  /** One line of what this agent did or found across the book. */
  finding: string;
};

function agentName(agent: StageAgentKey): string {
  return agent === TAX_AGENT ? stageAgentShortName(agent) : agentShortName(agent as AgentKey);
}

function emptyPickerLine(job: "collect" | "tax" | "advise"): string {
  if (job === "tax") return "No return is due.";
  if (job === "collect") return "Nothing outstanding.";
  return "No pack is ready.";
}

function JobCard({
  job,
  count,
  loading,
  showTax,
  onAsk,
  onOpen,
}: {
  job: JobKey;
  count: JobsBoardCount;
  loading: boolean;
  showTax: boolean;
  onAsk: (agent: StageAgentKey) => void;
  onOpen: () => void;
}) {
  const meta = JOB_META[job];
  const agents = meta.agents.filter((a) => showTax || a !== TAX_AGENT);
  const live = job !== "books";
  return (
    <section
      className="job-card flex flex-col gap-3 rounded-2xl border p-5 shadow-sm"
      data-job-card={job}
      aria-labelledby={`job-${job}-title`}
    >
      <header className="job-card-head flex min-w-0 flex-col items-start gap-2">
        <h2
          id={`job-${job}-title`}
          className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#3D5270]"
        >
          {meta.label}
        </h2>
        <span className="job-faces" data-job-faces={job}>
          <span className="job-face-stack -space-x-2">
            {agents.map((agent) => (
              <OwnerAvatar
                key={agent}
                agent={agent}
                variant="character"
                motion="idle"
                size="sm"
                label={agentName(agent)}
              />
            ))}
          </span>
          {agents.length === 1 ? (
            <span className="job-face-names text-[12px] text-[#5C7190]" data-job-names="">
              {agentName(agents[0])}
            </span>
          ) : null}
        </span>
      </header>
      <div className="flex items-end gap-3">
        <span
          className="text-[40px] font-bold leading-none text-[var(--milon-ink)] tabular-nums"
          data-job-count={job}
        >
          {loading ? "…" : live ? count.count : "—"}
        </span>
        <p className="m-0 pb-1 text-[14px] leading-snug text-[var(--milon-ink)]">
          {loading ? "Reading the book…" : count.line}
        </p>
      </div>
      <p className="m-0 text-[13px] leading-snug text-[var(--milon-ink-muted)]">{meta.outcome}</p>
      <div className="job-card-footer">
        {live ? (
          <button
            type="button"
            className="job-btn job-btn-primary"
            data-job-action={job}
            disabled={loading}
            onClick={onOpen}
          >
            {meta.action}
          </button>
        ) : (
          <span className="job-btn job-btn-idle" aria-disabled="true" data-job-action={job}>
            {meta.action}
          </span>
        )}
        {agents[0] ? (
          <button
            type="button"
            className="job-btn job-btn-secondary"
            onClick={() => onAsk(agents[0])}
            data-job-ask={job}
          >
            Ask {agentName(agents[0])}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function PracticeJobsBoard({
  counts,
  clients = [],
  drafts,
  loading,
  showTax,
  agentRows,
  signOffCount,
  onAsk,
}: {
  counts: Record<JobKey, JobsBoardCount>;
  /** Book already loaded for the board. The picker does not choose one of these itself. */
  clients?: readonly JobsBoardClient[];
  /** When set, Tax uses these drafts and does not read again. */
  drafts?: readonly JobsBoardDraft[];
  loading: boolean;
  /** ZA firms see the Tax card and the Tax Specialist row. */
  showTax: boolean;
  agentRows: readonly JobsBoardAgentRow[];
  /** Drafts waiting on a named person. Null until counted. */
  signOffCount: number | null;
  onAsk: (agent: StageAgentKey) => void;
}) {
  const jobs = LIVE_JOB_KEYS.filter((job) => showTax || job !== "tax");
  const [openJob, setOpenJob] = useState<"collect" | "tax" | "advise" | null>(null);
  const [readDrafts, setReadDrafts] = useState<readonly JobsBoardDraft[] | null>(null);
  const taxClientKey = clients
    .filter((client) => client.taxEnabled && client.id)
    .map((client) => client.id)
    .join("\n");
  useEffect(() => {
    if (openJob !== "tax" || drafts) return;
    const ids = taxClientKey ? taxClientKey.split("\n") : [];
    let cancel = false;
    // Same pattern as the tax page: the ZA form module stays out of the home bundle.
    void import("@/lib/tax-specialist/forms/drafts").then(async ({ isCurrentTaxDraft, loadTaxFormDrafts }) => {
      const groups = await Promise.all(
        ids.map(async (id) => {
          const rows = await loadTaxFormDrafts(id);
          const out: JobsBoardDraft[] = [];
          for (const row of rows) {
            if (!isCurrentTaxDraft(row)) continue;
            if (row.form_code !== "IRP6" && row.form_code !== "ITR14" && row.form_code !== "ITR12") continue;
            out.push({ clientId: id, form: row.form_code, period: row.period, status: row.status });
          }
          return out;
        }),
      );
      if (!cancel) setReadDrafts(groups.flat());
    });
    return () => {
      cancel = true;
    };
  }, [openJob, drafts, taxClientKey]);
  const pickerDraftList = drafts ?? readDrafts ?? [];
  const pickerRows: JobPickerRow[] =
    openJob == null ? [] : jobPickerRows(openJob, clients, new Date(), pickerDraftList);
  useEffect(() => {
    if (!openJob) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenJob(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openJob]);
  return (
    <div className="practice-jobs-board flex flex-col gap-6" data-practice-jobs-board="">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[22px] font-bold leading-tight text-[var(--milon-ink)]">
          Three jobs, done for every client
        </h1>
        <p className="m-0 text-[14px] text-[var(--milon-ink-muted)]">
          Milōn collects documents, drafts tax returns and prepares advisory packs. You review and
          send. Nothing reaches a ledger or SARS without a named person's approval.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3" data-job-cards="">
        {jobs.map((job) => (
          <JobCard
            key={job}
            job={job}
            count={counts[job]}
            loading={loading}
            showTax={showTax}
            onAsk={onAsk}
            onOpen={() => {
              if (job === "books") return;
              setReadDrafts(null);
              setOpenJob(job);
            }}
          />
        ))}
      </div>

      {openJob ? (
        <div className="job-picker-backdrop" onClick={() => setOpenJob(null)}>
          <div
            className="job-picker"
            role="dialog"
            aria-modal="true"
            aria-label={JOB_META[openJob].action}
            data-job-picker={openJob}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="job-picker-title">{JOB_META[openJob].action}</p>
            {pickerRows.length === 0 ? (
              <p className="job-picker-empty" data-job-picker-empty="">
                {emptyPickerLine(openJob)}
              </p>
            ) : (
              <ul className="job-picker-list">
                {pickerRows.map((row) => (
                  <li key={row.key}>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: row.clientId }}
                      search={clientNavSearch({}, row.headingId) as never}
                      className="job-picker-row"
                      data-job-picker-row={row.clientId}
                      data-job-picker-form={row.form}
                    >
                      <span className="job-picker-name">{row.name}</span>
                      {row.form ? <span className="job-picker-form">{row.form}</span> : null}
                      {row.due ? <span>{row.due}</span> : null}
                      {row.status ? <span>{row.status}</span> : null}
                      {row.detail ? <span>{row.detail}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="job-btn job-btn-secondary" onClick={() => setOpenJob(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--milon-border)] px-5 py-4"
        data-sign-off-line=""
        aria-label="Needs your sign-off"
      >
        <div className="flex items-baseline gap-3">
          <span className="text-[24px] font-bold leading-none tabular-nums text-[var(--milon-ink)]">
            {signOffCount == null ? "…" : signOffCount}
          </span>
          <span className="text-[14px] text-[var(--milon-ink)]">
            {signOffCount === 0
              ? "Nothing waiting on you."
              : "drafts waiting on your sign-off: emails, tax forms, figure proposals."}
          </span>
        </div>
        <Link
          to="/practice/needs-attention"
          className="text-[13px] font-semibold text-[var(--milon-cobalt)] no-underline hover:underline"
        >
          Open the queue
        </Link>
      </section>

      <section aria-label="Your agents" data-agent-rows="">
        <h2 className="m-0 mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--milon-ink-muted)]">
          Who is on it
        </h2>
        <ul className="m-0 flex list-none flex-col divide-y divide-[var(--milon-border)] p-0">
          {agentRows.map((row) => (
            <li
              key={row.agent}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              data-agent-row={row.agent}
            >
              <div className="flex min-w-0 items-center gap-3">
                <OwnerAvatar
                  agent={row.agent}
                  variant="character"
                  motion={
                    row.status?.tone === "attention" || row.status?.tone === "critical"
                      ? "found"
                      : "idle"
                  }
                  size="sm"
                  label={agentName(row.agent)}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-[14px] font-semibold text-[var(--milon-ink)]">
                    {agentName(row.agent)}
                  </span>
                  <span className="text-[13px] text-[var(--milon-ink-muted)]">
                    {row.finding || JOB_META[jobsFor(row.agent)].outcome}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {row.status ? (
                  <span
                    className="text-[12px] text-[var(--milon-ink-faint)]"
                    data-tone={row.status.tone}
                  >
                    {row.status.label}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="job-btn job-btn-secondary"
                  onClick={() => onAsk(row.agent)}
                >
                  Ask
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function jobsFor(agent: StageAgentKey): JobKey {
  if (agent === TAX_AGENT) return "tax";
  if (agent === "financial_manager") return "collect";
  return "advise";
}
