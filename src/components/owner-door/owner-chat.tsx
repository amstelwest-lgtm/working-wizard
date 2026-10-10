import { agentAriaLabel, agentDisplayName, agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import type { OwnerMotion } from "@/lib/owner-presence";
import { ChatIcon, OwnerAvatar, type AvatarVariant } from "./owner-avatar";

export type OwnerChatTurn = { role: "owner" | "agent"; text: string };

const MOTION_LABEL: Record<OwnerMotion, string> = {
  idle: "Idle",
  working: "Working…",
  found: "Found something",
  speaking: "Speaking",
  listening: "Listening",
};

export function OwnerChat({
  agent,
  variant,
  motion,
  sentence,
  messages,
  draft,
  listening,
  busy,
  error,
  onDraft,
  onSend,
  onListen,
  onBack,
}: {
  agent: AgentKey;
  variant: AvatarVariant;
  motion: OwnerMotion;
  sentence: string;
  messages: OwnerChatTurn[];
  draft: string;
  listening: boolean;
  busy: boolean;
  error: string | null;
  onDraft: (value: string) => void;
  onSend: () => void;
  onListen: () => void;
  onBack: () => void;
}) {
  const short = agentShortName(agent);
  return (
    <div className="owner-pane" data-owner-chat="true" data-agent={agent}>
      <div className="owner-chat-head">
        <button type="button" className="owner-back" onClick={onBack}>
          Home
        </button>
        <OwnerAvatar
          agent={agent}
          variant={variant}
          size="md"
          motion={motion}
          label={agentAriaLabel(agent, MOTION_LABEL[motion])}
        />
        <div>
          <h1 className="owner-title">{agentDisplayName(agent)}</h1>
          <p className="owner-lede">{sentence}</p>
        </div>
      </div>
      <ol className="owner-transcript">
        {messages.length === 0 ? (
          <li className="owner-turn is-agent">
            Ask about the books. Figures stay on what is already on file.
          </li>
        ) : null}
        {messages.map((turn, index) => (
          <li key={index} className={`owner-turn is-${turn.role}`}>
            {turn.text}
          </li>
        ))}
      </ol>
      {error ? <p className="owner-error">{error}</p> : null}
      <form
        className="owner-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <button
          type="button"
          className={`owner-icon-btn${listening ? " is-on" : ""}`}
          aria-pressed={listening}
          aria-label={listening ? "Stop listening" : "Speak"}
          onClick={onListen}
        >
          <MicIcon />
        </button>
        <textarea
          value={draft}
          placeholder={listening ? "Listening." : `Ask ${short}`}
          aria-label={`Ask ${short}`}
          rows={2}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <button type="submit" className="owner-ask" disabled={busy || !draft.trim()}>
          <ChatIcon />
          {busy ? "Working…" : `Ask ${short}`}
        </button>
      </form>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v3M8 20h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
