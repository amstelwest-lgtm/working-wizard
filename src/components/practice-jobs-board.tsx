/**
 * Practice Home: three job cards, one sign-off line, agent rows under them.
 *
 * The firm sees jobs and outcomes. Agents appear as the people on each job,
 * with chat demoted to an "Ask" link. All counts arrive from the practice
 * board; this component reads nothing from the database.
 */
import { Link } from "@tanstack/react-router";
import type { AgentKey } from "@/lib/milon-team-feed";
import { agentShortName } from "@/lib/milon-team";
import { JOB_META, LIVE_JOB_KEYS, type JobKey, type JobsBoardCount } from "@/lib/milon-jobs";
import { clientNavSearch } from "@/lib/client-route-search";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import "@/components/owner-door/owner-door.css";
import { TAX_AGENT, stageAgentShortName, type StageAgentKey } from "@/lib/tax-specialist/agents";

export type JobsBoardAgentRow = {
  agent: StageAgentKey;
  status: { label: string; tone: string } | null;
  /** One line of what this agent did or found across the book. */
  finding: string;
};

/** Where each job's button lands inside a client file. */
function jobSearch(job: JobKey): Record<string, unknown> {
  if (job === "collect") return clientNavSearch({}, "send-agent");
  if (job === "tax") return clientNavSearch({}, "tax");
  if (job === "advise") return clientNavSearch({}, "reports");
  return clientNavSearch({}, "books", "connections");
}

function agentName(agent: StageAgentKey): string {
  return agent === TAX_AGENT ? stageAgentShortName(agent) : agentShortName(agent as AgentKey);
}

function JobCard({
  job,
  count,
  loading,
  showTax,
  onAsk,
}: {
  job: JobKey;
  count: JobsBoardCount;
  loading: boolean;
  showTax: boolean;
  onAsk: (agent: StageAgentKey) => void;
}) {
  const meta = JOB_META[job];
  const agents = meta.agents.filter((a) => showTax || a !== TAX_AGENT);
  const live = job !== "books";
  const hasTarget = live && count.clientId != null;
  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-[var(--milon-border)] bg-[var(--milon-bg)] p-5 shadow-sm"
      data-job-card={job}
      aria-labelledby={`job-${job}-title`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2
          id={`job-${job}-title`}
          className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--milon-ink-muted)]"
        >
          {meta.label}
        </h2>
        <span className="flex items-center gap-1.5" data-job-faces={job}>
          <span className="flex -space-x-2">
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
          <span className="text-[12px] text-[var(--milon-ink-faint)]">
            {agents.map(agentName).join(" · ")}
          </span>
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
      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        {hasTarget ? (
          <Link
            to="/clients/$clientId"
            params={{ clientId: count.clientId as string }}
            search={jobSearch(job) as never}
            className="inline-flex items-center rounded-full bg-[var(--milon-cobalt)] px-4 py-2 text-[13px] font-semibold text-white no-underline hover:opacity-90"
            data-job-action={job}
          >
            {meta.action}
          </Link>
        ) : (
          <span
            className="inline-flex items-center rounded-full border border-[var(--milon-border)] px-4 py-2 text-[13px] font-semibold text-[var(--milon-ink-faint)]"
            aria-disabled="true"
            data-job-action={job}
          >
            {meta.action}
          </span>
        )}
        {agents[0] ? (
          <button
            type="button"
            className="bg-transparent p-0 text-[13px] text-[var(--milon-cobalt)] underline-offset-2 hover:underline"
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
  loading,
  showTax,
  agentRows,
  signOffCount,
  onAsk,
}: {
  counts: Record<JobKey, JobsBoardCount>;
  loading: boolean;
  /** ZA firms see the Tax card and the Tax Specialist row. */
  showTax: boolean;
  agentRows: readonly JobsBoardAgentRow[];
  /** Drafts waiting on a named person. Null until counted. */
  signOffCount: number | null;
  onAsk: (agent: StageAgentKey) => void;
}) {
  const jobs = LIVE_JOB_KEYS.filter((job) => showTax || job !== "tax");
  return (
    <div className="flex flex-col gap-6" data-practice-jobs-board="">
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
          />
        ))}
      </div>

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
                  className="bg-transparent p-0 text-[13px] text-[var(--milon-cobalt)] underline-offset-2 hover:underline"
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
