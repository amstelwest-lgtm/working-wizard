import { useState, type KeyboardEvent, type ReactNode } from "react";
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
  formatLastRun,
  teamAgentHeaderStatus,
} from "@/lib/milon-team";
import {
  TODAY_RATIO_CAP,
  activitySentence,
  checkedStamp,
  dedupeFindings,
  deskSignoffInvite,
  deskSignoffText,
  deskSourceLabel,
  figuresCheckedLine,
  findingFigureEntries,
  findingPeriod,
  findingSentence,
  handoffParts,
  handoffSentence,
  headerFromRun,
  isVisibleAgentFinding,
  latestRunByAgent,
  ratioSentence,
  splitTodayBriefing,
  type AgentActivitySnapshot,
} from "@/lib/milon-team-activity";
import type { MilonTeamFeedApi } from "@/hooks/use-milon-team-feed";
import { draftFindingLabel, ownerRunPhase, ownerRunPhaseLabel, ownerRunPhaseMuted } from "@/hooks/owner-agent-ui";
import { OwnerDraftCard, type ApprovedDraftTarget } from "@/components/owner-draft-card";
import { HealthNarrativeLine } from "@/components/health-narrative-line";
import { renderHealthNarrative } from "@/lib/health-snapshot";
import type { AgentKey, TeamBriefingItem, TeamJob } from "@/lib/milon-team-feed";
import { marketForClient } from "@/lib/market";
import { TaxSpecialistSlot } from "@/components/tax-specialist/tax-specialist-slot";
import { ACTIVITY_CAP, NOTICED_CAP, NOTICED_EMPTY } from "@/lib/agent-section-copy";
import { findingTitleKey } from "@/lib/finding-title-key";
import { AgentSection } from "./agent-section";
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

/** Team desk keeps its kicker cards. An open agent gets titled sections. */
function DeskSection({
  agentView,
  section,
  label,
  jobs = false,
  children,
}: {
  agentView: boolean;
  section: "offered" | "activity";
  label: string;
  jobs?: boolean;
  children: ReactNode;
}) {
  if (agentView) {
    return (
      <AgentSection section={section} data-desk-jobs={jobs ? "true" : undefined}>
        {children}
      </AgentSection>
    );
  }
  return (
    <section className="milon-desk-card" aria-label={label} data-desk-jobs={jobs ? "true" : undefined}>
      <p className="milon-desk-kicker">{label}</p>
      {children}
    </section>
  );
}

function matches(agent: AgentKey, filter: FilterKey): boolean {
  return filter === "all" || filter === agent;
}

export function MilonTeamDesk({
  feed,
  now,
  initialFilter = "all",
  live = null,
  onOpenApproved,
  onInvite,
  onRefreshDrafts,
  onOpenAgent,
  presentation = "team",
  marketCountry = null,
  audience = "accountant",
  sampleClient = false,
  canonicalRatios = null,
  heroFinding = null,
}: {
  feed: MilonTeamFeedApi;
  now?: Date;
  initialFilter?: FilterKey;
  /** Latest agent_runs, findings, and hand-offs. Null keeps the feed fallback. */
  live?: AgentActivitySnapshot | null;
  onOpenApproved?: (target: ApprovedDraftTarget) => void;
  onInvite?: () => void;
  onRefreshDrafts?: () => void;
  /** A team chip opens that agent's view. The local filter still applies until then. */
  onOpenAgent?: (agent: AgentKey) => void;
  /** Agent view hides the last-run chip strip. The stage switcher owns that click. */
  presentation?: "team" | "agent";
  marketCountry?: string | null;
  audience?: "owner" | "accountant";
  /** clients.is_demo. A demo keeps the sample chip. A real client gets the preview chip. */
  sampleClient?: boolean;
  /** Live scorecard ratios. Draft sentences quote these. */
  canonicalRatios?: Record<string, number> | null;
  /** What the agent hero already says. What I noticed leaves it out. */
  heroFinding?: { id: string | null; text: string | null } | null;
}) {
  const clock = now ?? new Date();
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [todayOpen, setTodayOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
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

  const agentView = presentation === "agent";
  const briefing = feed.briefing.filter((item) => matches(item.agent, filter));
  const jobs = feed.jobs.filter(
    (job) => job.status !== "dismissed" && !dropped[job.id] && matches(job.agent, filter),
  );
  const activity = feed.activity.filter((event) => matches(event.agent, filter));
  const latest = latestRunByAgent(live?.runs ?? []);
  const visibleFindings = (live?.findings ?? []).filter(
    (row) => isVisibleAgentFinding(row) && matches(row.agent, filter) && row.created_at,
  );
  const handoffs = (live?.messages ?? [])
    .map((row) => {
      const parts = handoffParts(row);
      if (!parts || !matches(parts.from, filter)) return null;
      return { id: row.id, at: row.created_at, ...parts };
    })
    .filter((row): row is { id: string; at: string; from: AgentKey; to: AgentKey; text: string } =>
      Boolean(row),
    )
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const signoffText = deskSignoffText(feed.signoffLine, feed.signoffOwner === true);
  const signoffInvite = deskSignoffInvite(feed.signoffOwner === true);
  const liveSentence = feed.healthQuote ? renderHealthNarrative(feed.healthQuote) : null;

  // The agent page shows each finding once, newest first, and leaves out what the hero already says.
  const heroKey = agentView && heroFinding?.text ? findingTitleKey(heroFinding.text) : "";
  const echoesHero = (text: string) => {
    const key = findingTitleKey(text);
    return Boolean(heroKey && key && heroKey.includes(key));
  };
  const findings = (
    agentView
      ? dedupeFindings(visibleFindings)
      : [...visibleFindings].sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
        )
  )
    .map((row) => ({
      row,
      sentence: findingSentence({
        title: row.title,
        detail: row.detail,
        figures: findingFigureEntries(row.evidence),
        market: live?.market,
        canonicalRatios,
        liveHealth: feed.healthQuote,
        evidence: row.evidence,
        writtenAt: row.created_at,
        figuresUpdatedAt: feed.figuresUpdatedAt,
      }),
    }))
    .filter(
      ({ row, sentence }) => !agentView || (row.id !== heroFinding?.id && !echoesHero(sentence)),
    );
  const findingKeys = new Set(
    findings.flatMap(({ row, sentence }) => [
      findingTitleKey(row.title),
      findingTitleKey(sentence),
    ]),
  );
  const repeatsFinding = (item: TeamBriefingItem) =>
    agentView &&
    [item.title, ratioSentence(item.title, item.detail)].some(
      (text) => findingKeys.has(findingTitleKey(text)) || echoesHero(text),
    );
  const split = splitTodayBriefing(briefing);
  const lead = split.lead.filter((item) => !repeatsFinding(item));
  const ratios = split.ratios.filter((item) => !repeatsFinding(item));
  const todayCount = findings.length + handoffs.length + lead.length + ratios.length;
  const emptyFeed = todayCount === 0 && jobs.length === 0 && activity.length === 0 && !signoffText;

  function checkedLine(item: TeamBriefingItem): string | null {
    const stamp = checkedStamp(latest[item.agent], feed.agents[item.agent]?.lastRunAt ?? null);
    const period =
      item.id === "health" && feed.healthQuote?.periodLabel
        ? feed.healthQuote.periodLabel
        : item.source.asOf;
    return figuresCheckedLine(
      period,
      stamp ?? item.source.asOf,
      clock,
      live?.market ?? marketForClient(null),
    );
  }
  const visibleActivity = agentView && !activityOpen ? activity.slice(0, ACTIVITY_CAP) : activity;
  const waiting = feed.loading && !feed.error && emptyFeed && presentation !== "agent";
  const quietError = Boolean(feed.error) && emptyFeed;

  // On the agent page every row is the same agent, so the agent tag and source chip would only repeat.
  const tag = (agent: AgentKey) =>
    agentView ? null : <span className="milon-desk-tag">{agentShortName(agent)}</span>;
  const findingRows = findings.map(({ row, sentence }) => {
    const draft = draftFindingLabel(row);
    const checked = figuresCheckedLine(
      feed.healthQuote?.periodLabel ?? findingPeriod(row),
      row.created_at,
      clock,
      live?.market ?? marketForClient(null),
    );
    const when = formatAsOf(row.created_at, clock, live?.market ?? marketForClient(null));
    const meta = (
      <div className="milon-desk-meta">
        {checked ? (
          <span className="milon-desk-why">{checked}</span>
        ) : when ? (
          <time dateTime={row.created_at}>{when}</time>
        ) : null}
      </div>
    );
    if (draft || row.status === "approved") {
      return (
        <OwnerDraftCard
          key={row.id}
          layout="desk"
          row={row}
          sentence={sentence}
          liveSentence={liveSentence}
          canonicalRatios={canonicalRatios}
          figuresUpdatedAt={feed.figuresUpdatedAt}
          market={live?.market}
          meta={meta}
          onOpen={onOpenApproved}
          onInvite={onInvite}
          onRefresh={onRefreshDrafts}
        />
      );
    }
    return (
      <li
        key={row.id}
        className="milon-desk-row"
        data-finding={row.id}
        data-finding-agent={row.agent}
      >
        <div className="milon-desk-job-copy">
          {tag(row.agent)}
          <HealthNarrativeLine
            text={sentence}
            liveSentence={liveSentence}
            className="milon-desk-figure"
          />
          {meta}
        </div>
      </li>
    );
  });
  const ratioRows = (items: readonly TeamBriefingItem[]) =>
    items.map((item) => {
      const checked = checkedLine(item);
      return (
        <li
          key={item.id}
          className="milon-desk-row"
          data-severity={item.severity}
          data-ratio={item.id}
        >
          <div className="milon-desk-job-copy">
            {tag(item.agent)}
            <p className="milon-desk-figure">{ratioSentence(item.title, item.detail)}</p>
            <div className="milon-desk-meta">
              {agentView ? null : (
                <span className="milon-desk-source">{deskSourceLabel(item)}</span>
              )}
              {checked ? <span className="milon-desk-why">{checked}</span> : null}
            </div>
          </div>
        </li>
      );
    });
  const handoffRows = handoffs.map((row) => {
    const when = formatAgo(row.at, clock);
    return (
      <li key={row.id} className="milon-desk-handoff" data-handoff={row.id}>
        <p className="milon-desk-handoff-text">
          {handoffSentence(agentShortName(row.from), agentShortName(row.to), row.text)}
        </p>
        {when ? <time dateTime={row.at}>{when}</time> : null}
      </li>
    );
  });
  const leadRows = lead.map((item) => {
    const checked = checkedLine(item);
    return (
      <li
        key={item.id}
        className="milon-desk-row"
        data-severity={item.severity}
        data-lead={item.id}
      >
        <div className="milon-desk-job-copy">
          {tag(item.agent)}
          <p className="milon-desk-figure">{item.title}</p>
          {item.detail ? <p className="milon-desk-hint">{item.detail}</p> : null}
          <div className="milon-desk-meta">
            {agentView ? null : <span className="milon-desk-source">{deskSourceLabel(item)}</span>}
            {checked ? <span className="milon-desk-why">{checked}</span> : null}
          </div>
        </div>
      </li>
    );
  });
  const noticedRows = [...findingRows, ...leadRows, ...ratioRows(ratios), ...handoffRows];
  const todayRows = agentView
    ? todayOpen
      ? noticedRows
      : noticedRows.slice(0, NOTICED_CAP)
    : [
        ...findingRows,
        ...ratioRows(todayOpen ? ratios : ratios.slice(0, TODAY_RATIO_CAP)),
        ...handoffRows,
        ...leadRows,
      ];
  const todayMore = agentView ? noticedRows.length > NOTICED_CAP : ratios.length > TODAY_RATIO_CAP;

  const todayList = (
    <>
      <ul className="milon-desk-briefing">{todayRows}</ul>
      {todayMore ? (
        <button
          type="button"
          className="milon-desk-more"
          aria-expanded={todayOpen}
          data-noticed-more=""
          onClick={() => setTodayOpen((open) => !open)}
        >
          {todayOpen ? "Show less" : "Show all"}
        </button>
      ) : null}
    </>
  );

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
            {presentation === "agent" ? null : (
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
                  const run = latest[agent];
                  const phase = ownerRunPhase(run, live?.findings ?? []);
                  const fromRun = run ? headerFromRun(run, clock) : null;
                  const fallback = teamAgentHeaderStatus(agent, feed.agents[agent], feed.briefing, clock);
                  const header = phase
                    ? {
                        label: ownerRunPhaseLabel(phase),
                        tone: ownerRunPhaseMuted(phase) ? ("idle" as const) : ("clear" as const),
                        lastRun:
                          phase === "done" || phase === "found"
                            ? formatLastRun(run?.finished_at || run?.started_at || run?.queued_at || null, clock)
                            : null,
                        pulse: phase === "queued" || phase === "working",
                        muted: ownerRunPhaseMuted(phase),
                      }
                    : (fromRun ?? fallback);
                  const ranText =
                    header.lastRun ??
                    (header.label.startsWith("Last run") ||
                    header.label === "Not run yet" ||
                    header.pulse ||
                    header.muted
                      ? null
                      : "Not run yet");
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
                      onClick={() => {
                        setFilter(agent);
                        onOpenAgent?.(agent);
                      }}
                    >
                      <AgentMark agent={agent} />
                      <span className="milon-desk-agent-copy">
                        <strong className="milon-desk-agent-name">{name}</strong>
                        <span className="milon-desk-agent-short">{agentShortName(agent)}</span>
                        <span className="milon-desk-visually-hidden">{agentJobLine(agent)}</span>
                        {ranText ? <span className="milon-desk-ran">{ranText}</span> : null}
                        <span
                          className={`milon-desk-status is-${header.tone}${header.pulse ? " is-live" : ""}${header.muted ? " is-muted" : ""}`}
                          data-run-state={phase ?? undefined}
                        >
                          <i />
                          <span>{header.label}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
                <TaxSpecialistSlot
                  country={marketCountry}
                  variant="desk"
                  audience={audience}
                  sampleClient={sampleClient}
                />
              </div>
            </div>
            )}

            {signoffText ? (
              <section className="milon-desk-signoff" aria-label="Sign-off">
                <p>{signoffText}</p>
                {signoffInvite ? <p className="milon-desk-invite">{signoffInvite}</p> : null}
              </section>
            ) : null}

            {agentView ? (
              <AgentSection section="noticed">
                {todayCount > 0 ? todayList : <p className="agent-section-empty">{NOTICED_EMPTY}</p>}
              </AgentSection>
            ) : todayCount > 0 ? (
              <section className="milon-desk-card" aria-label="Today">
                <p className="milon-desk-kicker">Today</p>
                {todayList}
              </section>
            ) : null}

            {jobs.length > 0 ? (
              <DeskSection agentView={agentView} section="offered" label="Offered" jobs>
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
                        {(job.status === "awaiting_signoff" || job.status === "signed_off") && signoffText ? (
                          <p className="milon-desk-confirm">
                            {signoffText}
                            {signoffInvite ? ` ${signoffInvite}` : ""}
                          </p>
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
              </DeskSection>
            ) : null}

            {activity.length > 0 ? (
              <DeskSection agentView={agentView} section="activity" label="Activity">
                <ul className="milon-desk-activity">
                  {visibleActivity.map((event) => {
                    const ago = formatAgo(event.at, clock);
                    const text = agentView ? activitySentence(event) : event.text;
                    return (
                      <li key={event.id} data-activity={event.id}>
                        <span className="milon-desk-tag">{agentShortName(event.agent)}</span>
                        {event.href ? <a href={event.href}>{text}</a> : <span>{text}</span>}
                        {ago ? <time dateTime={event.at}>{ago}</time> : null}
                      </li>
                    );
                  })}
                </ul>
                {agentView && activity.length > ACTIVITY_CAP ? (
                  <button
                    type="button"
                    className="milon-desk-more"
                    aria-expanded={activityOpen}
                    data-activity-more=""
                    onClick={() => setActivityOpen((open) => !open)}
                  >
                    {activityOpen ? "Show less" : "Show all"}
                  </button>
                ) : null}
              </DeskSection>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
