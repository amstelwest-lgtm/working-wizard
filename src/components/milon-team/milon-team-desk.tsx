import { useState, type KeyboardEvent } from "react";
import { PrecardCapCard } from "@/components/precard-cap-card";
import {
  AGENT_ORDER,
  agentAriaLabel,
  agentDisplayName,
  agentInitial,
  agentJobLine,
  agentMarkPath,
  agentShortName,
  formatAgo,
  formatAsOf,
  teamAgentHeaderStatus,
} from "@/lib/milon-team";
import type { MilonTeamFeedApi } from "@/hooks/use-milon-team-feed";
import type { AgentKey, TeamJob } from "@/lib/milon-team-feed";
import "./milon-team-desk.css";

type FilterKey = "all" | AgentKey;

const FILTERS: readonly FilterKey[] = ["all", ...AGENT_ORDER];

function AgentMark({ agent }: { agent: AgentKey }) {
  return (
    <span className="milon-desk-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={agentMarkPath(agent)} />
      </svg>
    </span>
  );
}

function matches(agent: AgentKey, filter: FilterKey): boolean {
  return filter === "all" || filter === agent;
}

export function MilonTeamDesk({
  feed,
  now,
  initialFilter = "all",
}: {
  feed: MilonTeamFeedApi;
  now?: Date;
  initialFilter?: FilterKey;
}) {
  const clock = now ?? new Date();
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [blocked, setBlocked] = useState<Record<string, "precard_cap">>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState<Record<string, string>>({});
  const [dropped, setDropped] = useState<Record<string, true>>({});

  function onFilterKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = FILTERS.indexOf(filter);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % FILTERS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FILTERS.length - 1;
    else return;
    event.preventDefault();
    const value = FILTERS[next];
    setFilter(value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-agent-filter="${value}"]`)?.focus();
  }

  async function approve(job: TeamJob) {
    setFailures((current) => {
      if (!current[job.id]) return current;
      const next = { ...current };
      delete next[job.id];
      return next;
    });
    const result = await feed.approveJob(job.id);
    if (result.ok) {
      setOpened((current) => ({ ...current, [job.id]: result.href ?? "" }));
      return;
    }
    if (result.reason === "precard_cap") {
      setBlocked((current) => ({ ...current, [job.id]: "precard_cap" }));
      return;
    }
    setFailures((current) => ({ ...current, [job.id]: result.message }));
  }

  async function dismiss(job: TeamJob) {
    const result = await feed.dismissJob(job.id);
    if (result.ok) {
      setDropped((current) => ({ ...current, [job.id]: true }));
      return;
    }
    if (result.message) setFailures((current) => ({ ...current, [job.id]: result.message as string }));
  }

  const briefing = feed.briefing.filter((item) => matches(item.agent, filter));
  const jobs = feed.jobs.filter(
    (job) => job.status !== "dismissed" && !dropped[job.id] && matches(job.agent, filter),
  );
  const activity = feed.activity.filter((event) => matches(event.agent, filter));
  const emptyFeed = briefing.length === 0 && jobs.length === 0 && activity.length === 0 && !feed.signoffLine;
  const waiting = feed.loading && !feed.error && emptyFeed;
  const quietError = Boolean(feed.error) && emptyFeed;

  return (
    <div className="milon-desk" data-desk-ready="true" aria-busy={feed.loading || undefined}>
      <div className="milon-desk-scroll">
        {feed.error ? (
          <section className="milon-desk-card" role="alert">
            <p className="milon-desk-error">{feed.error}</p>
            <div className="milon-desk-actions">
              <button type="button" className="milon-desk-btn outline" onClick={() => feed.refresh()}>
                Retry
              </button>
            </div>
          </section>
        ) : null}
        {waiting ? (
          <div className="milon-desk-briefing" aria-hidden="true">
            <div className="milon-desk-skel" />
            <div className="milon-desk-skel" />
            <div className="milon-desk-skel" />
          </div>
        ) : quietError ? null : (
          <>
            <div className="milon-desk-team" role="radiogroup" aria-label="Team" onKeyDown={onFilterKey}>
              <div className="milon-desk-team-bar">
                <p className="milon-desk-kicker">Team</p>
                <button
                  type="button"
                  className="milon-desk-all"
                  role="radio"
                  aria-checked={filter === "all"}
                  tabIndex={filter === "all" ? 0 : -1}
                  data-agent-filter="all"
                  onClick={() => setFilter("all")}
                >
                  All
                </button>
              </div>
              <div className="milon-desk-agents">
                {AGENT_ORDER.map((agent) => {
                  const header = teamAgentHeaderStatus(agent, feed.agents[agent], feed.briefing, clock);
                  const selected = filter === agent;
                  const name = agentDisplayName(agent);
                  return (
                    <button
                      key={agent}
                      type="button"
                      className="milon-desk-agent"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      data-agent-filter={agent}
                      title={agentJobLine(agent)}
                      aria-label={agentAriaLabel(agent, header.label)}
                      data-agent-initial={agentInitial(agent)}
                      onClick={() => setFilter(agent)}
                    >
                      <AgentMark agent={agent} />
                      <span className="milon-desk-agent-copy">
                        <strong className="milon-desk-agent-name">{name}</strong>
                        <span className="milon-desk-agent-short">{agentShortName(agent)}</span>
                        <span className="milon-desk-visually-hidden">{agentJobLine(agent)}</span>
                        {header.lastRun ? <span className="milon-desk-ran">{header.lastRun}</span> : null}
                        <span className={`milon-desk-status is-${header.tone}`}>
                          <i />
                          <span>{header.label}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {feed.signoffLine ? (
              <section className="milon-desk-signoff" aria-label="Sign-off">
                <p>{feed.signoffLine}</p>
              </section>
            ) : null}

            {briefing.length > 0 ? (
              <section className="milon-desk-card" aria-label="Today">
                <p className="milon-desk-kicker">Today</p>
                <ul className="milon-desk-briefing">
                  {briefing.map((item) => (
                    <li key={item.id} className="milon-desk-row" data-severity={item.severity}>
                      <div className="milon-desk-job-copy">
                        <span className="milon-desk-tag">{agentShortName(item.agent)}</span>
                        <p className="milon-desk-figure">{item.title}</p>
                        {item.detail ? <p className="milon-desk-why">{item.detail}</p> : null}
                        <div className="milon-desk-meta">
                          <span className="milon-desk-source">{item.source.label}</span>
                          {item.source.asOf ? (
                            <span className="milon-desk-why">as of {formatAsOf(item.source.asOf, clock)}</span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {jobs.length > 0 ? (
              <section className="milon-desk-card" aria-label="Offered" data-desk-jobs="true">
                <p className="milon-desk-kicker">Offered</p>
                <ul className="milon-desk-jobs">
                  {jobs.map((job) => {
                    const readyHref = opened[job.id];
                    const ready = job.status === "draft_ready" || readyHref !== undefined;
                    const href = job.href || readyHref || undefined;
                    const jobCapped =
                      blocked[job.id] === "precard_cap" ||
                      (job.status === "proposed" && !job.canApprove && job.blockedReason === "precard_cap");
                    const showApprove =
                      !ready && job.status === "proposed" && job.canApprove && !blocked[job.id] && !feed.precard.capped;
                    const showCap =
                      !ready && (jobCapped || (feed.precard.capped && job.status === "proposed" && job.canApprove));
                    const noData = !ready && job.status === "proposed" && !job.canApprove && job.blockedReason === "no_data";
                    return (
                      <li key={job.id} className="milon-desk-job" data-job={job.id} data-job-status={job.status}>
                        <div className="milon-desk-job-line">
                          <div className="milon-desk-job-copy">
                            <span className="milon-desk-tag">{agentShortName(job.agent)}</span>
                            <p>{job.title}</p>
                            {job.summary ? <p className="milon-desk-why">{job.summary}</p> : null}
                          </div>
                          {job.status === "drafting" ? <span className="milon-desk-spinner" role="status" aria-label="Drafting" /> : null}
                        </div>
                        {showApprove ? (
                          <div className="milon-desk-actions">
                            <button type="button" className="milon-desk-btn approve" data-approve={job.id} onClick={() => void approve(job)}>
                              Approve
                            </button>
                            <button type="button" className="milon-desk-btn ghost" data-dismiss={job.id} onClick={() => void dismiss(job)}>
                              Dismiss
                            </button>
                          </div>
                        ) : null}
                        {showCap ? <PrecardCapCard /> : null}
                        {noData ? <p className="milon-desk-muted">Not enough on file to draft this.</p> : null}
                        {ready ? (
                          <p className="milon-desk-ready">
                            Draft ready. Nothing was sent.
                            {href ? (
                              <a className="milon-desk-draft-link" href={href}>
                                Open
                              </a>
                            ) : null}
                          </p>
                        ) : null}
                        {(job.status === "awaiting_signoff" || job.status === "signed_off") && feed.signoffLine ? (
                          <p className="milon-desk-confirm">{feed.signoffLine}</p>
                        ) : null}
                        {job.status === "failed" ? (
                          <div className="milon-desk-actions">
                            <p className="milon-desk-error" role="alert">
                              {failures[job.id] || "This draft failed."}
                            </p>
                            <button type="button" className="milon-desk-btn outline" onClick={() => void approve(job)}>
                              Retry
                            </button>
                          </div>
                        ) : failures[job.id] ? (
                          <p className="milon-desk-error" role="alert">
                            {failures[job.id]}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {activity.length > 0 ? (
              <section className="milon-desk-card" aria-label="Activity">
                <p className="milon-desk-kicker">Activity</p>
                <ul className="milon-desk-activity">
                  {activity.map((event) => {
                    const ago = formatAgo(event.at, clock);
                    return (
                      <li key={event.id}>
                        <span className="milon-desk-tag">{agentShortName(event.agent)}</span>
                        {event.href ? <a href={event.href}>{event.text}</a> : <span>{event.text}</span>}
                        {ago ? <time dateTime={event.at}>{ago}</time> : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
