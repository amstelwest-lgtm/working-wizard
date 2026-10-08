/**
 * Phase 1 mockup of the Milōn Bot desk. The live ask pane does not mount this.
 * Approve and the composer stay local: they show a draft confirmation or the
 * existing pre-card card. They do not call ask-ai or milon-bot.
 */
import { useState } from "react";
import { PrecardCapCard } from "@/components/precard-cap-card";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import {
  deskBriefingActionLabel,
  deskBriefingPrecardKind,
  deskCoverageChips,
  deskJobSentence,
  deskSignoffLine,
  deskSyncedStatus,
  type MilonDeskBriefingItem,
  type MilonDeskJob,
  type MilonDeskModel,
  type MilonDeskPrecardKind,
} from "./contract";
import "./milon-bot-desk.css";

const DRAFT_CONFIRM = "Draft only. Nothing was sent. Sign-off stays with you.";

function Mark() {
  return (
    <span className="milon-desk-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      </svg>
    </span>
  );
}

function capBlocks(model: MilonDeskModel, kind: MilonDeskPrecardKind): boolean {
  return model.precard.applies && model.precard.blocked[kind];
}

export function MilonBotDesk({ model }: { model: MilonDeskModel }) {
  const [blockedKind, setBlockedKind] = useState<MilonDeskPrecardKind | null>(null);
  const [approved, setApproved] = useState<Record<string, "draft" | "cap">>({});
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [briefingDone, setBriefingDone] = useState<Record<string, "draft" | "cap">>({});
  const [draftText, setDraftText] = useState("");
  const [held, setHeld] = useState(false);

  const signoffLine = deskSignoffLine(model.signoff);
  const status = deskSyncedStatus(model.syncedAt, model.now);
  const booksOnFile = status !== "No books on file yet";
  const briefing = model.briefing.filter((item) => item.figure.trim());
  const jobs = model.jobs.flatMap((job) => {
    const sentence = deskJobSentence(job, model.currency);
    return sentence ? [{ job, sentence }] : [];
  }).filter((row) => !dismissed[row.job.id]);
  const activity = model.activity.filter((event) => event.line.trim());
  const noPack = model.signoff.state.version == null;

  const take = (id: string, kind: MilonDeskPrecardKind, sink: "job" | "brief") => {
    const outcome = capBlocks(model, kind) ? "cap" : "draft";
    if (outcome === "cap") setBlockedKind(kind);
    if (sink === "job") setApproved((prev) => ({ ...prev, [id]: outcome }));
    else setBriefingDone((prev) => ({ ...prev, [id]: outcome }));
  };

  return (
    <section className="milon-desk" aria-label="Milōn Bot" data-milon-desk="true">
      <header className="milon-desk-card milon-desk-identity">
        <Mark />
        <div>
          <h1>
            Milōn Bot <span className="milon-desk-role">· Finance analyst</span>
          </h1>
          <p className={`milon-desk-status${booksOnFile ? "" : " is-empty"}`}>
            <i />
            <span>{status}</span>
          </p>
          <div className="milon-desk-chips">
            {deskCoverageChips(model.coverage).map((chip) => (
              <span key={chip.label} className={`milon-desk-chip${chip.active ? "" : " is-off"}`}>
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="milon-desk-signoff" data-desk-signoff="true">
        <p>
          <strong>{signoffLine}</strong>
          <span>{noPack ? "No pack on file yet." : "Sign-off stays with you."}</span>
        </p>
      </div>

      <section className="milon-desk-card" aria-labelledby="milon-desk-today">
        <h2 id="milon-desk-today" className="milon-desk-kicker">
          Today
        </h2>
        {briefing.length === 0 ? (
          <p className="milon-desk-empty">Nothing to diagnose until the figures are on file.</p>
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
          <p className="milon-desk-empty">No jobs until collections or a budget variance is on file.</p>
        ) : (
          <ul className="milon-desk-jobs">
            {jobs.map(({ job, sentence }) => (
              <li key={job.id} data-job={job.id}>
                <article className="milon-desk-job">
                  <p>{sentence}</p>
                  {approved[job.id] === "draft" ? (
                    <p className="milon-desk-confirm" role="status">
                      {DRAFT_CONFIRM}
                    </p>
                  ) : null}
                  {approved[job.id] === "cap" ? <PrecardCapCard /> : null}
                  {approved[job.id] ? null : (
                    <div className="milon-desk-actions">
                      <button
                        type="button"
                        className="milon-desk-btn gold"
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
          <p className="milon-desk-empty">No activity on this file yet.</p>
        ) : (
          <ul className="milon-desk-activity">
            {activity.map((event) => (
              <li key={event.id}>{event.line}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="milon-desk-composer-wrap" data-desk-composer="true">
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
          <button type="submit" className="milon-desk-btn gold">
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
        <div className="milon-desk-meta">
          {chip ? <span className="milon-desk-source">{chip}</span> : null}
          {outcome === "draft" ? (
            <span className="milon-desk-confirm" role="status">
              {DRAFT_CONFIRM}
            </span>
          ) : null}
        </div>
        {outcome === "cap" ? <PrecardCapCard /> : null}
      </div>
      {outcome ? null : (
        <div className="milon-desk-actions">
          <button type="button" className="milon-desk-btn gold" onClick={onAct}>
            {deskBriefingActionLabel(item.action)}
          </button>
        </div>
      )}
    </div>
  );
}
