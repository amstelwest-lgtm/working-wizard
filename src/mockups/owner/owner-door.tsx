/**
 * Static, clickable owner door. No router of its own: the harness passes
 * the screen in. Production routes do not import this module.
 */
import { useState, type ReactNode } from "react";
import { formatAgo, formatAsOf } from "@/lib/milon-team";
import {
  ANALYST_FINDINGS,
  BOOKS_LINE,
  DO_THIS_NOW,
  FORWARD_LINE,
  HARBOUR,
  HARBOUR_ACCOUNTANT,
  HARBOUR_BOOKS,
  HARBOUR_STAFF,
  HARBOUR_WEEK_OF,
  MOVES_STATUS_LINE,
  OWNER_ACTIONS,
  OWNER_DELIVERABLES,
  OWNER_FEED,
  OWNER_NOW,
  OWNER_PLAN,
  OWNER_PRESENCES,
  OWNER_SIGNOFF_LINE,
  OWNER_UPLOADS,
  staffById,
  zar,
  type OwnerAction,
  type OwnerFeedItem,
  type StaffId,
} from "./owner-sample";
import {
  OWNER_PRESENCE_LABEL,
  OWNER_TEAM,
  OWNER_TEAM_ORDER,
  type OwnerBotKey,
  type OwnerPresence,
} from "./owner-team";
import "./owner-door.css";

export type OwnerScreen = "home" | "bot" | "actions" | "accountant" | "first";

const NAV: readonly { screen: OwnerScreen; label: string }[] = [
  { screen: "home", label: "Team" },
  { screen: "actions", label: "Actions" },
  { screen: "accountant", label: "Accountant" },
];

function Mark({ bot }: { bot: OwnerBotKey }) {
  return (
    <span className="owner-orb" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={OWNER_TEAM[bot].mark} />
      </svg>
      <i className="owner-pulse" />
    </span>
  );
}

function Names({ bot }: { bot: OwnerBotKey }) {
  const team = OWNER_TEAM[bot];
  return (
    <>
      <span className="owner-name-full" data-full-label>
        {team.name}
      </span>
      <span className="owner-name-short" data-short-label>
        {team.short}
      </span>
    </>
  );
}

function Badge() {
  return <span className="owner-badge">Signed off ✓</span>;
}

function FeedLine({ item }: { item: OwnerFeedItem }) {
  const ago = formatAgo(item.at, OWNER_NOW) ?? "";
  const hand = item.text.includes(" → ");
  let body: ReactNode = item.text;
  if (hand) {
    const [from, rest] = item.text.split(" → ");
    const splitAt = rest.indexOf(": ");
    const to = splitAt === -1 ? rest : rest.slice(0, splitAt);
    const what = splitAt === -1 ? "" : rest.slice(splitAt + 2);
    body = (
      <>
        <b>{from}</b>
        <span className="owner-arrow" aria-hidden="true">
          {" → "}
        </span>
        <b>{to}</b>
        {what ? <span>: {what}</span> : null}
      </>
    );
  }
  return (
    <li className={hand ? "is-hand" : undefined}>
      <span className="owner-when">{ago}</span>
      <p>{body}</p>
    </li>
  );
}

function Feed({ items }: { items: readonly OwnerFeedItem[] }) {
  return (
    <section className="owner-feed" aria-label="Live" aria-live="polite">
      <div className="owner-feed-head">
        <i className="owner-live" aria-hidden="true" />
        <p className="owner-kicker">Live</p>
      </div>
      <ol>
        {items.map((item) => (
          <FeedLine key={item.id} item={item} />
        ))}
      </ol>
    </section>
  );
}

function CashWeeks() {
  const min = Math.min(...HARBOUR_BOOKS.closings);
  const max = Math.max(...HARBOUR_BOOKS.closings);
  return (
    <div className="owner-weeks" aria-hidden="true">
      {HARBOUR_BOOKS.closings.map((closing, index) => {
        const height = 18 + ((closing - min) / (max - min)) * 28;
        const low = index + 1 === HARBOUR_BOOKS.lowWeek;
        return (
          <span key={HARBOUR_WEEK_OF[index]} className={low ? "owner-week is-low" : "owner-week"}>
            <i style={{ height }} />
            <em>{low ? "Low" : index + 1}</em>
          </span>
        );
      })}
    </div>
  );
}

function CashStrip() {
  const closings = HARBOUR_BOOKS.closings;
  const floor = HARBOUR_BOOKS.floor;
  const width = 640;
  const height = 72;
  const min = Math.min(floor, ...closings) * 0.9;
  const max = Math.max(...closings);
  const x = (index: number) => 8 + (index / (closings.length - 1)) * (width - 16);
  const y = (value: number) => height - 10 - ((value - min) / (max - min)) * (height - 18);
  const path = closings
    .map(
      (value, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`,
    )
    .join(" ");
  const low = HARBOUR_BOOKS.lowWeek - 1;
  return (
    <svg
      className="owner-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`13-week cash. Low point ${zar(HARBOUR_BOOKS.lowClosing)} in week ${HARBOUR_BOOKS.lowWeek}. Floor ${zar(floor)}.`}
    >
      <line
        x1="8"
        x2={width - 8}
        y1={y(floor)}
        y2={y(floor)}
        stroke="#d4af37"
        strokeDasharray="3 4"
        strokeWidth="1"
      />
      <path d={path} fill="none" stroke="#f2ecdc" strokeWidth="2" />
      <circle cx={x(low)} cy={y(closings[low])} r="3.5" fill="#d4af37" />
    </svg>
  );
}

function actionStatus(action: OwnerAction, assignee: StaffId | null): string {
  if (!assignee) return "Needs you";
  if (action.status === "in_progress" && assignee === action.assignee) return "In progress";
  return `With ${staffById(assignee).name}`;
}

export function OwnerDoor({
  screen,
  bot,
  onNavigate,
}: {
  screen: OwnerScreen;
  bot: OwnerBotKey;
  onNavigate: (screen: OwnerScreen, bot?: OwnerBotKey) => void;
}) {
  const [assignees, setAssignees] = useState<Record<string, StaffId | null>>(() =>
    Object.fromEntries(OWNER_ACTIONS.map((action) => [action.id, action.assignee])),
  );
  const [openAssign, setOpenAssign] = useState<string | null>(OWNER_ACTIONS[0].id);
  const [uploads, setUploads] = useState<Record<string, boolean>>({});
  const [ledger, setLedger] = useState<"quickbooks" | "xero" | null>(null);
  const [email, setEmail] = useState("");
  const [invited, setInvited] = useState(false);

  function assign(actionId: string, staffId: StaffId) {
    setAssignees((current) => ({ ...current, [actionId]: staffId }));
    setOpenAssign(null);
  }

  function goAssignJohan() {
    assign(DO_THIS_NOW.actionId, DO_THIS_NOW.staffId);
    onNavigate("actions");
  }

  const presence = OWNER_PRESENCES.find((card) => card.bot === bot) ?? OWNER_PRESENCES[1];

  return (
    <div className="owner-door" data-owner-ready="true" data-screen={screen}>
      <header className="owner-top">
        <div className="owner-brand">
          <span className="owner-word">MILŌN</span>
          <span className="owner-biz">
            <b>{HARBOUR.name}</b>
            {screen === "first" ? "" : ` · ${HARBOUR.place}`}
          </span>
        </div>
        {screen === "first" ? (
          <p className="owner-quiet">First visit</p>
        ) : (
          <nav className="owner-nav" aria-label="Owner">
            {NAV.map((item) => (
              <button
                key={item.screen}
                type="button"
                aria-current={
                  screen === item.screen || (item.screen === "home" && screen === "bot")
                    ? "page"
                    : undefined
                }
                onClick={() => onNavigate(item.screen)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <div className="owner-scroll">
        {screen === "home" ? (
          <div className="owner-home">
            <div className="owner-head">
              <div>
                <h1 className="owner-title">Your finance team</h1>
                <p className="owner-lede">Three of them. One thing for you.</p>
              </div>
              <p className="owner-source">
                Books to {HARBOUR.asOfLabel} · {HARBOUR.books}
              </p>
            </div>
            <p className="owner-plan">{OWNER_PLAN.planLine}</p>

            <div className="owner-presences">
              {OWNER_PRESENCES.map((card) => {
                const team = OWNER_TEAM[card.bot];
                return (
                  <button
                    key={card.bot}
                    type="button"
                    className={`owner-presence is-${card.presence} ${card.bot === "financial_manager" ? "is-lead" : ""}`}
                    data-bot={card.bot}
                    data-presence={card.presence}
                    aria-label={`${team.name}. ${OWNER_PRESENCE_LABEL[card.presence]}. ${card.sentence}`}
                    onClick={() => onNavigate("bot", card.bot)}
                  >
                    <Mark bot={card.bot} />
                    <span className="owner-presence-copy">
                      <span className="owner-kicker">{team.kicker}</span>
                      <Names bot={card.bot} />
                      <span className="owner-state">
                        <i />
                        {OWNER_PRESENCE_LABEL[card.presence]}
                      </span>
                      <span className="owner-voice">{card.sentence}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <ul className="owner-voice-list">
              {OWNER_PRESENCES.map((card) => (
                <li key={card.bot}>
                  <b>{OWNER_TEAM[card.bot].short}</b>
                  <span> {card.sentence}</span>
                </li>
              ))}
            </ul>

            <div className="owner-split">
              <section className="owner-panel is-now" aria-label="Do this now">
                <p className="owner-kicker">Do this now</p>
                <h2>{DO_THIS_NOW.title}</h2>
                <p className="owner-voice">{DO_THIS_NOW.sentence}</p>
                <CashStrip />
                <p className="owner-support">{DO_THIS_NOW.support}</p>
                <div className="owner-actions-row">
                  <button
                    type="button"
                    className="owner-btn owner-btn-gold"
                    data-do-now="atlantic"
                    onClick={goAssignJohan}
                  >
                    Assign to Johan
                  </button>
                </div>
              </section>

              <button type="button" className="owner-seat" onClick={() => onNavigate("accountant")}>
                <p className="owner-kicker">Your accountant</p>
                <span className="owner-who">
                  <span className="owner-avatar" aria-hidden="true">
                    TK
                  </span>
                  <span>
                    <strong>{HARBOUR_ACCOUNTANT.name}</strong>
                    <span>
                      {HARBOUR_ACCOUNTANT.firm} · {HARBOUR_ACCOUNTANT.place}
                    </span>
                  </span>
                </span>
                <span className="owner-quiet">
                  Signed the September pack on {HARBOUR_ACCOUNTANT.signedOn}.
                </span>
                <Badge />
                <span className="owner-btn owner-btn-line">See what they signed</span>
              </button>
            </div>

            <Feed items={OWNER_FEED} />
          </div>
        ) : null}

        {screen === "bot" ? (
          <BotDetail
            bot={bot}
            presence={presence.presence}
            sentence={presence.sentence}
            onBack={() => onNavigate("home")}
          />
        ) : null}

        {screen === "actions" ? (
          <Actions
            assignees={assignees}
            openAssign={openAssign}
            onToggle={(id) => setOpenAssign((current) => (current === id ? null : id))}
            onAssign={assign}
          />
        ) : null}

        {screen === "accountant" ? (
          <Accountant
            uploads={uploads}
            onUpload={(id) => setUploads((current) => ({ ...current, [id]: true }))}
          />
        ) : null}

        {screen === "first" ? (
          <FirstRun
            ledger={ledger}
            email={email}
            invited={invited}
            onLedger={setLedger}
            onEmail={setEmail}
            onInvite={() => setInvited(true)}
          />
        ) : null}
      </div>
    </div>
  );
}

function BotDetail({
  bot,
  presence,
  sentence,
  onBack,
}: {
  bot: OwnerBotKey;
  presence: OwnerPresence;
  sentence: string;
  onBack: () => void;
}) {
  const team = OWNER_TEAM[bot];
  const feed = OWNER_FEED.filter(
    (item) =>
      item.agent === bot ||
      item.text.startsWith(`${team.voice} →`) ||
      item.text.includes(`→ ${team.voice}:`),
  );
  return (
    <div data-bot-detail={bot}>
      <button type="button" className="owner-back" onClick={onBack}>
        ← Your finance team
      </button>
      <div
        className={`owner-detail-head owner-presence is-${presence} ${bot === "financial_manager" ? "is-lead" : ""}`}
      >
        <Mark bot={bot} />
        <div>
          <p className="owner-kicker">{team.kicker}</p>
          <Names bot={bot} />
          <p className="owner-state">
            <i />
            {OWNER_PRESENCE_LABEL[presence]}
          </p>
          <p className="owner-voice">{sentence}</p>
          <p className="owner-role">{team.role}</p>
        </div>
      </div>

      {bot === "analyst" ? <AnalystBody /> : null}
      {bot === "financial_manager" ? <ManagerBody /> : null}
      {bot === "advisor" ? <AdvisorBody /> : null}

      <div className="owner-block">
        <p className="owner-kicker">Its feed</p>
        <ol
          className="owner-feed"
          style={{ border: 0, background: "transparent", padding: 0, overflow: "visible" }}
        >
          {feed.map((item) => (
            <FeedLine key={item.id} item={item} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function AnalystBody() {
  const diagnosis = OWNER_DELIVERABLES[0];
  return (
    <>
      <div className="owner-findings" aria-label="What the Analyst found">
        {ANALYST_FINDINGS.map((finding) => (
          <div key={finding.id} className="owner-stat">
            <p className="owner-kicker">{finding.label}</p>
            <b>{finding.value}</b>
            <span>{finding.note}</span>
          </div>
        ))}
      </div>
      <section className="owner-block answer-strip" data-answer-strip aria-label={diagnosis.title}>
        <div className="answer-strip__lead">
          <h2 className="answer-strip__heading">{diagnosis.title}</h2>
          <p className="answer-strip__sentence">{diagnosis.sentence}</p>
        </div>
        <div className="answer-strip__actions">
          <Badge />
        </div>
        <div className="answer-strip__meta">
          <span className="answer-strip__chip" data-source-chip>
            {diagnosis.chip}
          </span>
          <p className="answer-strip__status">{OWNER_SIGNOFF_LINE}</p>
        </div>
      </section>
      <p className="owner-honesty">
        Cullet and energy on the float line. Data quality of the books sits with{" "}
        {OWNER_TEAM.financial_manager.voice}.
      </p>
    </>
  );
}

function ManagerBody() {
  return (
    <section className="owner-block" aria-label="13-week cash forecast">
      <p className="owner-kicker">13-week cash</p>
      <h2>
        {zar(HARBOUR_BOOKS.lowClosing)} in the week of{" "}
        {formatAsOf(HARBOUR_BOOKS.lowWeekOf, OWNER_NOW)}
      </h2>
      <p className="owner-support">
        {zar(HARBOUR_BOOKS.underFloor)} under the {zar(HARBOUR_BOOKS.floor)} floor. Cash on the
        books at {HARBOUR.asOfLabel} is {zar(HARBOUR_BOOKS.openingCash)}. The budget rides with this
        line.
      </p>
      <CashStrip />
      <CashWeeks />
      <p className="owner-honesty">
        {BOOKS_LINE} {FORWARD_LINE}
      </p>
      <p className="owner-honesty">
        Two gaps in the books: the September glass delivery notes, and the float-line overtime
        sheet. Both are with {HARBOUR_ACCOUNTANT.firm}.
      </p>
    </section>
  );
}

function AdvisorBody() {
  return (
    <section className="owner-block" aria-label="Two moves">
      <p className="owner-kicker">Two moves</p>
      <h2>What to do with the dip</h2>
      <ol className="owner-support" style={{ paddingLeft: 18 }}>
        <li>Confirm Atlantic Fit-out will pay {zar(HARBOUR_BOOKS.atlantic)} by 16 November.</li>
        <li>Ask the workshop what changed in cullet and energy between August and September.</li>
      </ol>
      <div className="owner-meta" style={{ marginTop: 8 }}>
        <span className="answer-strip__status">{MOVES_STATUS_LINE}</span>
      </div>
      <p className="owner-honesty">
        {OWNER_TEAM.advisor.voice} drafts the moves. {OWNER_TEAM.financial_manager.voice} assigns
        them and keeps the accountant in the loop.
      </p>
    </section>
  );
}

function Actions({
  assignees,
  openAssign,
  onToggle,
  onAssign,
}: {
  assignees: Record<string, StaffId | null>;
  openAssign: string | null;
  onToggle: (id: string) => void;
  onAssign: (actionId: string, staffId: StaffId) => void;
}) {
  return (
    <div>
      <div className="owner-head">
        <div>
          <h1 className="owner-title">Action points</h1>
          <p className="owner-lede">
            {OWNER_TEAM.financial_manager.voice} holds the list. You choose who on your team does
            each one.
          </p>
        </div>
      </div>
      <div style={{ height: 12 }} />
      {OWNER_ACTIONS.map((action) => {
        const assignee = assignees[action.id] ?? null;
        const open = openAssign === action.id || !assignee;
        const due = formatAsOf(action.due, OWNER_NOW);
        return (
          <article
            key={action.id}
            className={assignee ? "owner-action" : "owner-action is-open"}
            data-action={action.id}
          >
            <div className="owner-meta">
              <span className="owner-tag" data-raised-by={action.raisedBy}>
                <span className="owner-name-full" data-full-label>
                  {OWNER_TEAM[action.raisedBy].voice}
                </span>
                <span className="owner-name-short" data-short-label>
                  {OWNER_TEAM[action.raisedBy].short}
                </span>
              </span>
              <span>{actionStatus(action, assignee)}</span>
              {due ? <span>Due {due}</span> : null}
            </div>
            <h3>{action.title}</h3>
            <p className="owner-support">{action.detail}</p>
            {open ? (
              <div className="owner-people" aria-label={`Assign ${action.title}`}>
                {HARBOUR_STAFF.map((person) => {
                  const on = assignee === person.id;
                  const suggested = action.suggested === person.id && !on;
                  return (
                    <button
                      key={person.id}
                      type="button"
                      className={`owner-person ${on ? "is-on" : ""} ${suggested ? "is-suggested" : ""}`}
                      aria-pressed={on}
                      onClick={() => onAssign(action.id, person.id)}
                    >
                      <b>{person.name}</b>
                      <span>{suggested ? `Suggested · ${person.role}` : person.role}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                className="owner-btn owner-btn-quiet"
                onClick={() => onToggle(action.id)}
              >
                Change who
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Accountant({
  uploads,
  onUpload,
}: {
  uploads: Record<string, boolean>;
  onUpload: (id: string) => void;
}) {
  return (
    <div>
      <div className="owner-head">
        <div>
          <h1 className="owner-title">Your accountant</h1>
          <p className="owner-lede">What they signed, and what they still need from you.</p>
        </div>
      </div>
      <div style={{ height: 12 }} />
      <section className="owner-block">
        <div className="owner-who">
          <span className="owner-avatar" aria-hidden="true">
            TK
          </span>
          <div>
            <strong>{HARBOUR_ACCOUNTANT.name}</strong>
            <div className="owner-quiet">
              {HARBOUR_ACCOUNTANT.firm} · {HARBOUR_ACCOUNTANT.place}
            </div>
          </div>
        </div>
        <p className="owner-support" style={{ marginTop: 8 }}>
          Signed the September pack on {HARBOUR_ACCOUNTANT.signedOn}. Two uploads are still open.
        </p>
      </section>

      <section className="owner-block" aria-label="Deliverables">
        <p className="owner-kicker">Deliverables</p>
        {OWNER_DELIVERABLES.map((item) => (
          <article key={item.id} className="owner-deliverable">
            <div className="owner-meta">
              <span className="owner-tag">{OWNER_TEAM[item.by].voice}</span>
              {item.signed ? (
                <Badge />
              ) : (
                <span className="answer-strip__status">{MOVES_STATUS_LINE}</span>
              )}
            </div>
            <h2 className="owner-deliverable-title">{item.title}</h2>
            <p className="owner-support">{item.sentence}</p>
            <div className="owner-meta" style={{ marginTop: 6 }}>
              <span className="answer-strip__chip">{item.chip}</span>
              {item.signed ? (
                <p className="answer-strip__status owner-signed-line">{OWNER_SIGNOFF_LINE}</p>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      <section className="owner-block" aria-label="Uploads they asked for">
        <p className="owner-kicker">They asked you to upload</p>
        {OWNER_UPLOADS.map((item) => (
          <div key={item.id} className="owner-upload">
            <div>
              <h3>{item.title}</h3>
              <p className="owner-quiet">{item.detail}</p>
              {uploads[item.id] ? <p className="owner-staged">Ready · {item.fileName}</p> : null}
            </div>
            {uploads[item.id] ? null : (
              <button
                type="button"
                className="owner-btn owner-btn-gold"
                data-upload={item.id}
                onClick={() => onUpload(item.id)}
              >
                Upload
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function FirstRun({
  ledger,
  email,
  invited,
  onLedger,
  onEmail,
  onInvite,
}: {
  ledger: "quickbooks" | "xero" | null;
  email: string;
  invited: boolean;
  onLedger: (ledger: "quickbooks" | "xero") => void;
  onEmail: (email: string) => void;
  onInvite: () => void;
}) {
  const canInvite = Boolean(ledger) && email.includes("@");
  return (
    <div>
      <p className="owner-step">Step 1</p>
      <h1 className="owner-title">Connect the books</h1>
      <p className="owner-lede" style={{ display: "block" }}>
        {HARBOUR.name} · {HARBOUR.place} · {HARBOUR.trade}. Then invite your accountant.
      </p>
      <div className="owner-connect">
        <button
          type="button"
          className="owner-ledger"
          data-ledger="quickbooks"
          aria-pressed={ledger === "quickbooks"}
          onClick={() => onLedger("quickbooks")}
        >
          <strong>QuickBooks</strong>
          <span>Read the books</span>
        </button>
        <button
          type="button"
          className="owner-ledger"
          data-ledger="xero"
          aria-pressed={ledger === "xero"}
          onClick={() => onLedger("xero")}
        >
          <strong>Xero</strong>
          <span>Read the books</span>
        </button>
      </div>
      <p className="owner-honesty">
        {ledger
          ? `${ledger === "quickbooks" ? "QuickBooks" : "Xero"} connected for ${HARBOUR.name}. `
          : null}
        {BOOKS_LINE} {FORWARD_LINE}
      </p>

      <section className="owner-block owner-invite" aria-label="Invite your accountant">
        <p className="owner-step">Step 2</p>
        <h2>Invite your accountant</h2>
        <p className="owner-free">{OWNER_PLAN.freeLine}</p>
        {ledger ? null : (
          <p className="owner-support">Connect the books first. The invite waits here.</p>
        )}
        <label htmlFor="owner-accountant-email">Their work email</label>
        <input
          id="owner-accountant-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="name@kloof.example"
          value={email}
          disabled={!ledger}
          onChange={(event) => onEmail(event.target.value)}
        />
        <div className="owner-actions-row">
          <button
            type="button"
            className="owner-btn owner-btn-gold"
            disabled={!canInvite || invited}
            onClick={onInvite}
          >
            {invited ? "Invite noted" : "Send invite"}
          </button>
        </div>
        {invited ? (
          <p className="owner-staged">Invite noted. Nothing was sent from this mockup.</p>
        ) : null}
        <p className="owner-plan">{OWNER_PLAN.planLine}</p>
      </section>
    </div>
  );
}

export const OWNER_BOT_KEYS = OWNER_TEAM_ORDER;
