/**
 * Static, clickable owner door. The harness passes the screen in.
 * Production routes do not import this module.
 */
import { useEffect, useState } from "react";
import { ClientRailButton } from "@/components/client-studio-chrome";
import { SettingsNavButton } from "@/components/settings-nav-button";
import { formatAsOf } from "@/lib/milon-team";
import {
  AVATAR_MOTION_LABEL,
  AVATAR_MOTIONS,
  OwnerAvatar,
  type AvatarMotion,
  type AvatarVariant,
} from "./owner-avatars";
import {
  BOOKS_LINE,
  DO_THIS_NOW,
  FORWARD_LINE,
  HARBOUR,
  HARBOUR_ACCOUNTANT,
  HARBOUR_STAFF,
  MOVES_STATUS_LINE,
  OWNER_ACTIONS,
  OWNER_CHAT,
  OWNER_DELIVERABLES,
  OWNER_NOW,
  OWNER_PLAN,
  OWNER_PRESENCES,
  OWNER_PROMISES,
  OWNER_SIGNOFF_LINE,
  OWNER_TRANSCRIPT,
  OWNER_UPLOADS,
  ownerPlanIncluded,
  staffById,
  type OwnerAction,
  type StaffId,
} from "./owner-sample";
import {
  OWNER_PRESENCE_LABEL,
  OWNER_TEAM,
  OWNER_TEAM_ORDER,
  type OwnerBotKey,
  type OwnerPresence,
} from "./owner-team";
import "./owner-avatars.css";
import "./owner-door.css";

export type OwnerScreen =
  | "home"
  | "bot"
  | "actions"
  | "accountant"
  | "deliverables"
  | "first"
  | "plan"
  | "settings"
  | "profile"
  | "states";

export type OwnerTalk = "open" | "recording" | "transcript";

const RAIL: readonly { id: string; label: string; screen: OwnerScreen }[] = [
  { id: "home", label: "Team", screen: "home" },
  { id: "actions", label: "Actions", screen: "actions" },
  { id: "accountant", label: "Accountant", screen: "accountant" },
  { id: "deliverables", label: "Deliverables", screen: "deliverables" },
];

function presenceMotion(presence: OwnerPresence): AvatarMotion {
  if (presence === "working") return "working";
  if (presence === "found") return "found";
  return "idle";
}

function actionStatus(action: OwnerAction, assignee: StaffId | null): string {
  if (!assignee) return "Needs you";
  if (action.status === "in_progress" && assignee === action.assignee) return "In progress";
  return `With ${staffById(assignee).name}`;
}

export function OwnerDoor({
  screen,
  bot,
  avatars,
  talk,
  onNavigate,
}: {
  screen: OwnerScreen;
  bot: OwnerBotKey;
  avatars: AvatarVariant;
  talk: OwnerTalk;
  onNavigate: (screen: OwnerScreen, bot?: OwnerBotKey, talk?: OwnerTalk) => void;
}) {
  const [assignees, setAssignees] = useState<Record<string, StaffId | null>>(() =>
    Object.fromEntries(OWNER_ACTIONS.map((action) => [action.id, action.assignee])),
  );
  const [openAssign, setOpenAssign] = useState<string | null>(OWNER_ACTIONS[0].id);
  const [uploads, setUploads] = useState<Record<string, boolean>>({});
  const [ledger, setLedger] = useState<"quickbooks" | "xero" | null>(null);
  const [email, setEmail] = useState("");
  const [invited, setInvited] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountantJoined] = useState(screen !== "first");

  function assign(actionId: string, staffId: StaffId) {
    setAssignees((current) => ({ ...current, [actionId]: staffId }));
    setOpenAssign(null);
  }

  function openMenuItem(next: OwnerScreen) {
    setMenuOpen(false);
    onNavigate(next);
  }

  return (
    <div
      className="owner-door accountant-portal"
      data-owner-ready="true"
      data-screen={screen}
      data-avatars={avatars}
      data-accountant={accountantJoined ? "on" : "off"}
    >
      <header className="topbar">
        <div className="owner-brand">
          <span className="gold-text owner-word">MILŌN</span>
          <span className="owner-biz">
            <b>{HARBOUR.name}</b>
            <span className="owner-place"> · {HARBOUR.place}</span>
          </span>
        </div>
        <span className="spacer" />
        <div className="owner-account">
          <button
            type="button"
            className="profile-chip"
            aria-label="Owner menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="av">HG</span>
            Owner
          </button>
          {menuOpen ? (
            <div className="owner-menu" role="menu" aria-label="Settings, plan, and profile">
              <SettingsNavButton
                role="menuitem"
                className="owner-menu-item"
                onClick={() => openMenuItem("settings")}
              />
              <button
                type="button"
                role="menuitem"
                className="owner-menu-item"
                onClick={() => openMenuItem("plan")}
              >
                Plan
              </button>
              <button
                type="button"
                role="menuitem"
                className="owner-menu-item"
                onClick={() => openMenuItem("profile")}
              >
                Profile
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="client-workspace">
        <nav className="deliverable-rail" aria-label="Owner">
          {RAIL.map((item) => (
            <ClientRailButton
              key={item.id}
              id={item.id}
              label={item.label}
              active={screen === item.screen || (item.screen === "home" && screen === "bot")}
              primary={item.id === "home"}
              onSelect={() => onNavigate(item.screen)}
            />
          ))}
        </nav>
        <div className="deliverable-main">
          {screen === "home" ? (
            <Home
              avatars={avatars}
              joined={accountantJoined}
              onOpen={(next, nextBot) => onNavigate(next, nextBot)}
              onAssign={() => {
                assign(DO_THIS_NOW.actionId, DO_THIS_NOW.staffId);
                onNavigate("actions");
              }}
            />
          ) : null}
          {screen === "bot" ? (
            <AgentChat
              bot={bot}
              avatars={avatars}
              talk={talk}
              onTalk={(next) => onNavigate("bot", bot, next)}
              onStep={() => onNavigate(bot === "financial_manager" ? "actions" : "deliverables")}
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
              joined={accountantJoined}
              uploads={uploads}
              onUpload={(id) => setUploads((current) => ({ ...current, [id]: true }))}
              onInvite={() => onNavigate("first")}
            />
          ) : null}
          {screen === "deliverables" ? <Deliverables /> : null}
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
          {screen === "plan" ? <PlanView joined={accountantJoined} /> : null}
          {screen === "settings" ? <Settings onPlan={() => onNavigate("plan")} /> : null}
          {screen === "profile" ? <Profile /> : null}
          {screen === "states" ? <AvatarStates variant={avatars} /> : null}
        </div>
      </div>
    </div>
  );
}

function Home({
  avatars,
  joined,
  onOpen,
  onAssign,
}: {
  avatars: AvatarVariant;
  joined: boolean;
  onOpen: (screen: OwnerScreen, bot?: OwnerBotKey) => void;
  onAssign: () => void;
}) {
  const promises = joined
    ? OWNER_PROMISES
    : OWNER_PROMISES.map((item) =>
        item.id === "signed"
          ? {
              ...item,
              heading: "Invite your accountant",
              sentence: OWNER_PLAN.freeLine,
              source: "No accountant on Milōn yet",
              step: "Invite your accountant",
              go: "first" as const,
              signed: false,
            }
          : item,
      );
  return (
    <div className="owner-pane">
      <div className="owner-head">
        <div>
          <h1 className="owner-title">Your finance team</h1>
          <p className="owner-lede">Plain answers from the books. One thing for you.</p>
        </div>
      </div>
      <div className="owner-promises">
        {promises.map((item) => (
          <article key={item.id} className="answer-strip" data-promise={item.id}>
            <div className="answer-strip__lead">
              <h2 className="answer-strip__heading">{item.heading}</h2>
              <p
                className={
                  item.id === "signed" && !joined ? "owner-free" : "answer-strip__sentence"
                }
              >
                {item.sentence}
              </p>
            </div>
            <div className="answer-strip__actions">
              {item.signed ? <span className="owner-badge">Signed off ✓</span> : null}
              <button
                type="button"
                className="owner-btn owner-btn-gold"
                onClick={() => {
                  if (item.id === "answer" || item.step === "Assign to Johan") onAssign();
                  else if (item.go === "actions" && item.id === "owes") onOpen("actions");
                  else onOpen(item.go, item.bot ?? undefined);
                }}
              >
                {item.step}
              </button>
            </div>
            <div className="answer-strip__meta">
              <p className="answer-strip__chip">{item.source}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="owner-honesty">
        {BOOKS_LINE} {FORWARD_LINE}
      </p>
      <p className="owner-handoff">
        Analyst → Advisor: September made less than August, so two moves are being drafted.
      </p>
      <div className="owner-agents">
        {OWNER_PRESENCES.map((card) => {
          const team = OWNER_TEAM[card.bot];
          const lookAt = avatars === "character" && card.bot === "analyst" ? "advisor" : null;
          return (
            <button
              key={card.bot}
              type="button"
              className="owner-agent"
              onClick={() => onOpen("bot", card.bot)}
            >
              <OwnerAvatar
                bot={card.bot}
                variant={avatars}
                motion={presenceMotion(card.presence)}
                lookAt={lookAt}
              />
              <span className="owner-agent-copy">
                <span className="owner-kicker">{team.kicker}</span>
                <span className="owner-name-full" data-full-label>
                  {team.name}
                </span>
                <span className="owner-name-short" data-short-label>
                  {team.short}
                </span>
                <span className="owner-voice">{card.sentence}</span>
                <span className="owner-ask">
                  <span className="owner-ask-full">Ask {team.voice}…</span>
                  <span className="owner-ask-short">Ask {team.short}…</span>
                </span>
              </span>
              <span className="owner-state">
                <i />
                {OWNER_PRESENCE_LABEL[card.presence]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function chatCopy(bot: OwnerBotKey): {
  question: string;
  answer: string;
  source: string;
  step: string;
} {
  if (bot === "advisor") {
    return {
      question: "What should I do next?",
      answer:
        "Confirm Atlantic Fit-out will pay, and ask the workshop what changed in cullet and energy. Your accountant has not signed these moves.",
      source: "Advisory",
      step: "Invite your accountant to sign off",
    };
  }
  return OWNER_CHAT;
}

function AgentChat({
  bot,
  avatars,
  talk,
  onTalk,
  onStep,
}: {
  bot: OwnerBotKey;
  avatars: AvatarVariant;
  talk: OwnerTalk;
  onTalk: (talk: OwnerTalk) => void;
  onStep: () => void;
}) {
  const team = OWNER_TEAM[bot];
  const thread = bot === "analyst" ? analystThread() : chatCopy(bot);
  const [draft, setDraft] = useState(talk === "transcript" ? OWNER_TRANSCRIPT : "");
  const motion: AvatarMotion =
    talk === "recording" ? "listening" : talk === "transcript" ? "idle" : "speaking";

  useEffect(() => {
    setDraft(talk === "transcript" ? OWNER_TRANSCRIPT : "");
  }, [talk, bot]);

  return (
    <div className="owner-chat" data-talk={talk}>
      <div className="owner-chat-head">
        <OwnerAvatar bot={bot} variant={avatars} motion={motion} label={team.name} />
        <div>
          <h1 className="owner-title">{team.name}</h1>
          <p className="owner-lede">{team.role}</p>
        </div>
      </div>
      <ol className="owner-thread">
        <li className="owner-msg is-you">
          <p>{thread.question}</p>
        </li>
        <li className="owner-msg is-agent">
          <p>{thread.answer}</p>
          <p className="answer-strip__chip">{thread.source}</p>
          <button type="button" className="owner-btn owner-btn-gold" onClick={onStep}>
            {thread.step}
          </button>
        </li>
      </ol>
      <form
        className="owner-composer"
        data-recording={talk === "recording" ? "true" : undefined}
        data-transcript={talk === "transcript" ? "true" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        {talk === "recording" ? (
          <div className="owner-wave" aria-hidden="true">
            {Array.from({ length: 14 }, (_, index) => (
              <i key={index} style={{ animationDelay: `${index * 0.07}s` }} />
            ))}
          </div>
        ) : null}
        <label className="owner-sr" htmlFor="owner-composer">
          Message {team.voice}
        </label>
        <textarea
          id="owner-composer"
          rows={2}
          value={draft}
          readOnly={talk === "recording"}
          placeholder={talk === "recording" ? "Listening…" : `Ask ${team.voice}…`}
          onChange={(event) => setDraft(event.target.value)}
        />
        {talk === "transcript" ? (
          <p className="owner-transcript-note">Edit this, then send.</p>
        ) : null}
        <div className="owner-composer-actions">
          {talk === "recording" ? (
            <button
              type="button"
              className="owner-btn owner-btn-gold"
              onClick={() => onTalk("transcript")}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="owner-mic"
              aria-label="Record"
              onClick={() => onTalk("recording")}
            >
              <MicIcon />
            </button>
          )}
          <button
            type="submit"
            className="owner-btn owner-btn-line"
            disabled={talk === "recording" || !draft.trim()}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function analystThread() {
  const profit = OWNER_PROMISES.find((item) => item.id === "profit");
  return {
    question: "Am I making money?",
    answer: profit?.sentence ?? "September made money, and less than August.",
    source: "From the books, September",
    step: "See the September diagnosis",
  };
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
    </svg>
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
    <div className="owner-pane">
      <div className="owner-head">
        <div>
          <h1 className="owner-title">Action points</h1>
          <p className="owner-lede">You choose who on your team does each one.</p>
        </div>
      </div>
      {OWNER_ACTIONS.map((action) => {
        const assignee = assignees[action.id] ?? null;
        const open = openAssign === action.id || !assignee;
        const due = formatAsOf(action.due, OWNER_NOW);
        return (
          <article key={action.id} className={assignee ? "owner-action" : "owner-action is-open"}>
            <div className="owner-meta">
              <span className="owner-tag">
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
  joined,
  uploads,
  onUpload,
  onInvite,
}: {
  joined: boolean;
  uploads: Record<string, boolean>;
  onUpload: (id: string) => void;
  onInvite: () => void;
}) {
  if (!joined) {
    return (
      <div className="owner-pane">
        <h1 className="owner-title">Your accountant</h1>
        <section className="owner-block owner-invite" aria-label="Invite your accountant">
          <h2>Invite your accountant</h2>
          <p className="owner-free">{OWNER_PLAN.freeLine}</p>
          <button type="button" className="owner-btn owner-btn-gold" onClick={onInvite}>
            Invite your accountant
          </button>
        </section>
      </div>
    );
  }
  return (
    <div className="owner-pane">
      <h1 className="owner-title">Your accountant</h1>
      <p className="owner-lede">
        Who they are, what they signed, and what they still need from you.
      </p>
      <section className="owner-block">
        <strong>{HARBOUR_ACCOUNTANT.name}</strong>
        <p className="owner-quiet">
          {HARBOUR_ACCOUNTANT.firm} · {HARBOUR_ACCOUNTANT.place}
        </p>
        <p className="owner-support">
          Signed the September pack on {HARBOUR_ACCOUNTANT.signedOn}. Two uploads are still open.
        </p>
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

function Deliverables() {
  return (
    <div className="owner-pane">
      <h1 className="owner-title">Deliverables</h1>
      <p className="owner-lede">What your accountant signed, and what is still yours.</p>
      {OWNER_DELIVERABLES.map((item) => (
        <article key={item.id} className="owner-block owner-deliverable">
          <div className="owner-meta">
            <span className="owner-tag">{OWNER_TEAM[item.by].voice}</span>
            {item.signed ? (
              <span className="owner-badge">Signed off ✓</span>
            ) : (
              <span className="answer-strip__status">{MOVES_STATUS_LINE}</span>
            )}
          </div>
          <h2>{item.title}</h2>
          <p className="owner-support">{item.sentence}</p>
          <p className="answer-strip__chip">{item.chip}</p>
          {item.signed ? <p className="owner-signed-line">{OWNER_SIGNOFF_LINE}</p> : null}
        </article>
      ))}
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
    <div className="owner-pane">
      <p className="owner-step">Step 1</p>
      <h1 className="owner-title">Connect the books</h1>
      <p className="owner-lede">
        {HARBOUR.name} · {HARBOUR.place}. Then invite your accountant.
      </p>
      <div className="owner-connect">
        <button
          type="button"
          className="owner-ledger"
          aria-pressed={ledger === "quickbooks"}
          onClick={() => onLedger("quickbooks")}
        >
          <strong>QuickBooks</strong>
          <span>Read the books</span>
        </button>
        <button
          type="button"
          className="owner-ledger"
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
        <label htmlFor="owner-accountant-email">Their work email</label>
        <input
          id="owner-accountant-email"
          type="email"
          value={email}
          disabled={!ledger}
          placeholder="name@kloof.example"
          onChange={(event) => onEmail(event.target.value)}
        />
        <button
          type="button"
          className="owner-btn owner-btn-gold"
          disabled={!canInvite || invited}
          onClick={onInvite}
        >
          {invited ? "Invite noted" : "Send invite"}
        </button>
        {invited ? (
          <p className="owner-staged">Invite noted. Nothing was sent from this mockup.</p>
        ) : null}
      </section>
    </div>
  );
}

function PlanView({ joined }: { joined: boolean }) {
  const status = joined ? ownerPlanIncluded(HARBOUR_ACCOUNTANT.firm) : OWNER_PLAN.priceLine;
  return (
    <div className="owner-pane owner-plan-view" data-accountant={joined ? "on" : "off"}>
      <p className="owner-kicker">Settings</p>
      <h1 className="owner-title">Plan</h1>
      <p className="owner-lede">
        {HARBOUR.name} · {HARBOUR.place}
      </p>
      <section className="owner-block" aria-label="Owner plan">
        <p className="owner-plan-status">{status}</p>
        <p className="owner-support">
          {joined
            ? `${HARBOUR_ACCOUNTANT.name} is your accountant at ${HARBOUR_ACCOUNTANT.firm}.`
            : "South Africa. The price is in rand."}
        </p>
      </section>
    </div>
  );
}

function Settings({ onPlan }: { onPlan: () => void }) {
  return (
    <div className="owner-pane">
      <h1 className="owner-title">Settings</h1>
      <p className="owner-honesty">
        {BOOKS_LINE} {FORWARD_LINE}
      </p>
      <button type="button" className="owner-btn owner-btn-line" onClick={onPlan}>
        Open plan
      </button>
    </div>
  );
}

function Profile() {
  return (
    <div className="owner-pane">
      <h1 className="owner-title">Profile</h1>
      <p className="owner-lede">
        Owner · {HARBOUR.name} · {HARBOUR.place}
      </p>
      <p className="owner-support">Books in {HARBOUR.books}.</p>
    </div>
  );
}

function AvatarStates({ variant }: { variant: AvatarVariant }) {
  return (
    <div className="owner-pane owner-states" data-states={variant}>
      <h1 className="owner-title">What each agent is doing</h1>
      <p className="owner-lede">
        {variant === "orb" ? "Orb" : "Character"} · idle, working, found something, speaking,
        listening.
      </p>
      {AVATAR_MOTIONS.map((motion) => (
        <div key={motion} className="owner-state-row" data-state-row={motion}>
          <p className="owner-kicker">{AVATAR_MOTION_LABEL[motion]}</p>
          {OWNER_TEAM_ORDER.map((bot) => (
            <div key={bot} className="owner-state-cell">
              <OwnerAvatar
                bot={bot}
                variant={variant}
                motion={motion}
                label={OWNER_TEAM[bot].short}
              />
              <span className="owner-name-short">{OWNER_TEAM[bot].short}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="owner-state-row" data-state-row="handoff">
        <p className="owner-kicker">Hand-off</p>
        <div className="owner-state-cell">
          <OwnerAvatar
            bot="analyst"
            variant={variant}
            motion="found"
            lookAt="advisor"
            label="Analyst looks toward Advisor"
          />
          <span>Analyst</span>
        </div>
        <p className="owner-handoff">Analyst looks toward Advisor.</p>
        <div className="owner-state-cell">
          <OwnerAvatar bot="advisor" variant={variant} motion="working" label="Advisor" />
          <span>Advisor</span>
        </div>
      </div>
    </div>
  );
}

export const OWNER_BOT_KEYS = OWNER_TEAM_ORDER;
