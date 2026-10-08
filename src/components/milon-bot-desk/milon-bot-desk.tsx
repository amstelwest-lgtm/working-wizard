/**
 * Phase 1 mockup of the Milōn Bot desk. The live ask pane does not mount this.
 * Approve and the composer stay local: they show a draft confirmation or the
 * existing pre-card card. They do not call ask-ai or milon-bot.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PrecardCapCard } from "@/components/precard-cap-card";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import {
  DESK_AGENTS,
  deskAgentLastRun,
  deskAgentName,
  deskBriefingActionLabel,
  deskBriefingPrecardKind,
  deskJobSentence,
  deskSignoffAction,
  deskSignoffLine,
  type MilonDeskAgent,
  type MilonDeskAgentId,
  type MilonDeskBriefingItem,
  type MilonDeskModel,
  type MilonDeskPrecardKind,
} from "./contract";
import "./milon-bot-desk.css";

const DRAFT_READY = "Draft ready. Nothing was sent.";

type AgentFilter = "all" | MilonDeskAgentId;

const FILTERS: AgentFilter[] = ["all", "accountant", "analyst", "advisor"];

function AgentMark({ id }: { id: MilonDeskAgentId }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <span className="milon-desk-mark" aria-hidden="true">
      {id === "accountant" ? (
        <svg {...common}>
          <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H18v16H7.5A2.5 2.5 0 0 0 5 21.5z" />
          <path d="M5 5.5A2.5 2.5 0 0 1 7.5 8H18" />
          <path d="M9 12h5M9 15.5h3" />
        </svg>
      ) : null}
      {id === "analyst" ? (
        <svg {...common}>
          <path d="M4 19h16" />
          <path d="M7 19V11" />
          <path d="M12 19V6" />
          <path d="M17 19v-5" />
        </svg>
      ) : null}
      {id === "advisor" ? (
        <svg {...common}>
          <path d="M2.5 12S6.5 6.5 12 6.5 21.5 12 21.5 12 17.5 17.5 12 17.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="2.25" />
        </svg>
      ) : null}
    </span>
  );
}

function AgentTag({ id }: { id: MilonDeskAgentId }) {
  return <span className="milon-desk-tag">{deskAgentName(id)}</span>;
}

function capBlocks(model: MilonDeskModel, kind: MilonDeskPrecardKind): boolean {
  return model.precard.applies && model.precard.blocked[kind];
}

export function MilonBotDesk({ model }: { model: MilonDeskModel }) {
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(108);
  const [blockedKind, setBlockedKind] = useState<MilonDeskPrecardKind | null>(null);
  const [approved, setApproved] = useState<Record<string, "draft" | "cap">>({});
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [briefingDone, setBriefingDone] = useState<Record<string, "draft" | "cap">>({});
  const [draftText, setDraftText] = useState("");
  const [held, setHeld] = useState(false);
  const [filter, setFilter] = useState<AgentFilter>("all");
  const filterRefs = useRef<Partial<Record<AgentFilter, HTMLButtonElement | null>>>({});

  useEffect(() => {
    const measure = () => {
      const dock = dockRef.current;
      if (!dock) return;
      const next = Math.ceil(dock.getBoundingClientRect().height);
      setDockHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [held, blockedKind]);

  const signoffLine = deskSignoffLine(model.signoff);
  const signoffAction = deskSignoffAction(model.signoff);
  const show = (agent: MilonDeskAgentId) => filter === "all" || filter === agent;
  const agents = DESK_AGENTS.map((meta) => {
    const live = model.agents.find((agent) => agent.id === meta.id);
    return {
      ...meta,
      status: live?.status?.trim() || "Not run yet",
      lastRun: deskAgentLastRun(live?.lastRunAt ?? null, model.now),
      tone: live?.tone ?? "idle",
    };
  });
  const briefing = model.briefing.filter((item) => item.figure.trim() && show(item.agent));
  const jobs = model.jobs.flatMap((job) => {
    const sentence = deskJobSentence(job, model.currency);
    return sentence ? [{ job, sentence }] : [];
  }).filter((row) => !dismissed[row.job.id] && show(row.job.agent));
  const activity = model.activity.filter((event) => event.line.trim() && show(event.agent));
  const noPack = model.signoff.state.version == null;
  const filterName = filter === "all" ? null : deskAgentName(filter);

  const moveFilter = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = FILTERS.indexOf(filter);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % FILTERS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + FILTERS.length - 1) % FILTERS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FILTERS.length - 1;
    else return;
    event.preventDefault();
    const id = FILTERS[next] ?? "all";
    setFilter(id);
    filterRefs.current[id]?.focus();
  };

  const take = (id: string, kind: MilonDeskPrecardKind, sink: "job" | "brief") => {
    const outcome = capBlocks(model, kind) ? "cap" : "draft";
    if (outcome === "cap") setBlockedKind(kind);
    if (sink === "job") setApproved((prev) => ({ ...prev, [id]: outcome }));
    else setBriefingDone((prev) => ({ ...prev, [id]: outcome }));
  };

  return (
    <section
      className="milon-desk"
      aria-label="Milōn Bot"
      data-milon-desk="true"
      style={{ ["--desk-dock" as string]: `${dockHeight}px` }}
    >
      <div className="milon-desk-scroll" data-desk-scroll="true">
      <div
        className="milon-desk-team"
        role="radiogroup"
        aria-label="Show work from"
        onKeyDown={moveFilter}
      >
        <div className="milon-desk-team-bar">
          <h2 id="milon-desk-team" className="milon-desk-kicker">
            Team
          </h2>
          <button
            type="button"
            role="radio"
            aria-checked={filter === "all"}
            tabIndex={filter === "all" ? 0 : -1}
            className="milon-desk-all"
            data-agent-filter="all"
            ref={(node) => {
              filterRefs.current.all = node;
            }}
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
        <div className="milon-desk-agents">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={filter === agent.id}
              tabIndex={filter === agent.id ? 0 : -1}
              buttonRef={(node) => {
                filterRefs.current[agent.id] = node;
              }}
              onSelect={() => setFilter(agent.id)}
            />
          ))}
        </div>
      </div>

      <div className="milon-desk-signoff" data-desk-signoff="true">
        <p>
          <strong>{signoffLine}</strong>
          <span>{noPack ? "No pack on file yet." : "Sign-off stays with you."}</span>
        </p>
        {signoffAction ? (
          <button type="button" className="milon-desk-btn primary">
            {signoffAction}
          </button>
        ) : null}
      </div>

      <section className="milon-desk-card" aria-labelledby="milon-desk-today">
        <h2 id="milon-desk-today" className="milon-desk-kicker">
          Today
        </h2>
        {briefing.length === 0 ? (
          <p className="milon-desk-empty">
            {filterName ? `Nothing from ${filterName} in today's briefing.` : "Nothing to diagnose until the figures are on file."}
          </p>
        ) : (
          <ul className="milon-desk-briefing">
            {briefing.map((item) => (
              <li key={item.id}>
                <BriefingRow
                  item={item}
                  outcome={briefingDone[item.id]}
                  onAct={() => take(item.id, deskBriefingPrecardKind(item.action), "brief")}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="milon-desk-card" aria-labelledby="milon-desk-jobs" data-desk-jobs="true">
        <h2 id="milon-desk-jobs" className="milon-desk-kicker">
          Offered
        </h2>
        {jobs.length === 0 ? (
          <p className="milon-desk-empty">
            {filterName ? `No jobs from ${filterName}.` : "No jobs until collections or a budget variance is on file."}
          </p>
        ) : (
          <ul className="milon-desk-jobs">
            {jobs.map(({ job, sentence }) => (
              <li key={job.id} data-job={job.id}>
                <article className={`milon-desk-job${approved[job.id] === "draft" ? " is-ready" : ""}`}>
                  {approved[job.id] === "draft" ? (
                    <p className="milon-desk-ready" role="status">
                      {DRAFT_READY}{" "}
                      <a className="milon-desk-draft-link" href="#desk-draft" onClick={(event) => event.preventDefault()}>
                        Open draft
                      </a>
                    </p>
                  ) : (
                    <>
                      <div className="milon-desk-job-line">
                        <div className="milon-desk-job-copy">
                          <AgentTag id={job.agent} />
                          <p>{sentence}</p>
                        </div>
                        {approved[job.id] ? null : (
                          <div className="milon-desk-actions">
                            <button
                              type="button"
                              className="milon-desk-btn approve"
                              data-approve={job.id}
                              onClick={() => take(job.id, job.precardKind, "job")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="milon-desk-btn ghost"
                              onClick={() => setDismissed((prev) => ({ ...prev, [job.id]: true }))}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                      {approved[job.id] === "cap" ? <PrecardCapCard /> : null}
                    </>
                  )}
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="milon-desk-card" aria-labelledby="milon-desk-activity">
        <h2 id="milon-desk-activity" className="milon-desk-kicker">
          Activity
        </h2>
        {activity.length === 0 ? (
          <p className="milon-desk-empty">
            {filterName ? `No activity from ${filterName} yet.` : "No activity on this file yet."}
          </p>
        ) : (
          <ul className="milon-desk-activity">
            {activity.map((event) => (
              <li key={event.id} data-activity-agent={event.agent}>
                <AgentTag id={event.agent} />
                <span>{event.line}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>

      <div className="milon-desk-dock" ref={dockRef} data-desk-composer="true">
        <p className="milon-desk-hint">Drafts stay on the file until you sign off.</p>
        <form
          className="milon-desk-composer"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draftText.trim();
            if (!text) return;
            if (capBlocks(model, "bot")) {
              setBlockedKind("bot");
              setHeld(false);
              return;
            }
            setHeld(true);
            setDraftText("");
          }}
        >
          <label className="milon-desk-visually-hidden" htmlFor="milon-desk-ask">
            Ask or assign a task
          </label>
          <input
            id="milon-desk-ask"
            value={draftText}
            placeholder="Ask or assign a task…"
            onChange={(event) => setDraftText(event.target.value)}
          />
          <button type="submit" className="milon-desk-btn outline">
            Ask
          </button>
        </form>
        {held ? (
          <p className="milon-desk-held" role="status">
            Held as a task. Nothing was sent.
          </p>
        ) : null}
        {blockedKind === "bot" ? <PrecardCapCard /> : null}
      </div>
    </section>
  );
}

function AgentCard({
  agent,
  selected,
  tabIndex,
  buttonRef,
  onSelect,
}: {
  agent: { id: MilonDeskAgentId; name: string; status: string; lastRun: string; tone: MilonDeskAgent["tone"] };
  selected: boolean;
  tabIndex: number;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${agent.name}. ${agent.status}. ${agent.lastRun}`}
      tabIndex={tabIndex}
      className="milon-desk-agent"
      data-agent-filter={agent.id}
      ref={buttonRef}
      onClick={onSelect}
    >
      <AgentMark id={agent.id} />
      <span className="milon-desk-agent-copy">
        <strong>{agent.name}</strong>
        <span className={`milon-desk-status is-${agent.tone}`}>
          <i />
          <span>{agent.status}</span>
        </span>
        <span className="milon-desk-ran">{agent.lastRun}</span>
      </span>
    </button>
  );
}

function BriefingRow({
  item,
  outcome,
  onAct,
}: {
  item: MilonDeskBriefingItem;
  outcome: "draft" | "cap" | undefined;
  onAct: () => void;
}) {
  const chip = figureSourceChipLabel(item.source);
  return (
    <div className="milon-desk-row">
      <div>
        <p className="milon-desk-figure">
          {item.figure} <b>· {item.label}</b>
        </p>
        {item.why.trim() ? <p className="milon-desk-why">{item.why}</p> : null}
        <div className="milon-desk-meta">
          <AgentTag id={item.agent} />
          {chip ? <span className="milon-desk-source">{chip}</span> : null}
          {outcome === "draft" ? (
            <span className="milon-desk-ready" role="status">
              {DRAFT_READY}
            </span>
          ) : null}
        </div>
        {outcome === "cap" ? <PrecardCapCard /> : null}
      </div>
      {outcome ? null : (
        <div className="milon-desk-actions">
          <button type="button" className="milon-desk-btn outline" onClick={onAct}>
            {deskBriefingActionLabel(item)}
          </button>
        </div>
      )}
    </div>
  );
}
