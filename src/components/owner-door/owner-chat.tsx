import { useEffect, useRef, useState } from "react";
import { agentAriaLabel, agentDisplayName, agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import { formatOwnerReply, ownerReplyPlainText } from "@/lib/owner-reply-format";
import type { FmAvatarClip } from "@/lib/fm-avatar-state";
import type { OwnerMotion } from "@/lib/owner-presence";
import { browserSpeechPort, createReplySpeech, type ReplySpeech } from "@/lib/owner-reply-speech";
import { ChatIcon, OwnerAvatar, type AvatarVariant } from "./owner-avatar";
import { OwnerReply } from "./owner-reply";

export type OwnerChatTurn = { role: "owner" | "agent"; text: string };

const MOTION_LABEL: Record<OwnerMotion, string> = {
  idle: "Idle",
  working: "Working…",
  found: "Found something",
  speaking: "Speaking",
  listening: "Listening",
};

const INTRO: Record<AgentKey, string> = {
  financial_manager: "Ask about cash, the books, and what is due.",
  analyst: "Ask about health, margins, and what changed.",
  advisor: "Ask about the next move and what to do this week.",
};

export function OwnerChat({
  agent,
  variant,
  motion,
  fmClip = null,
  sentence,
  messages,
  draft,
  listening,
  busy,
  error,
  onDraft,
  onSend,
  onListen,
  onSpeech,
  onBack,
}: {
  agent: AgentKey;
  variant: AvatarVariant;
  motion: OwnerMotion;
  fmClip?: FmAvatarClip | null;
  sentence: string;
  messages: OwnerChatTurn[];
  draft: string;
  listening: boolean;
  busy: boolean;
  error: string | null;
  onDraft: (value: string) => void;
  onSend: () => void;
  onListen: () => void;
  onSpeech?: (speaking: boolean) => void;
  onBack: () => void;
}) {
  const short = agentShortName(agent);
  const speechRef = useRef<ReplySpeech | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const onSpeechRef = useRef(onSpeech);
  onSpeechRef.current = onSpeech;

  function speech() {
    if (!speechRef.current) speechRef.current = createReplySpeech(browserSpeechPort());
    return speechRef.current;
  }

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "agent") speech().noteReply();
  }, [messages]);

  useEffect(() => {
    return () => {
      speech().stop();
      setPlayingId(null);
      onSpeechRef.current?.(false);
    };
  }, [agent]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  function listenTo(messageId: string, text: string) {
    speech().tap(messageId, ownerReplyPlainText(formatOwnerReply(text)), {
      onPlay: () => {
        setPlayingId(messageId);
        onSpeechRef.current?.(true);
      },
      onStop: () => {
        setPlayingId((current) => (current === messageId ? null : current));
        onSpeechRef.current?.(false);
      },
    });
  }

  return (
    <div className="owner-pane" data-owner-chat="true" data-agent={agent} data-bot-stage="true">
      <div className="owner-chat-stage">
        <button type="button" className="owner-close" aria-label="Close" onClick={onBack}>
          <CloseIcon />
        </button>
        <OwnerAvatar
          agent={agent}
          variant={variant}
          size="stage"
          share
          motion={motion}
          fmClip={fmClip}
          label={agentAriaLabel(agent, MOTION_LABEL[motion])}
        />
        <h1 className="owner-title">{agentDisplayName(agent)}</h1>
        <p className="owner-lede">{sentence}</p>
        <span className="owner-motion-label">{MOTION_LABEL[motion]}</span>
      </div>
      <ol className="owner-transcript">
        {messages.length === 0 ? (
          <li className="owner-turn is-agent" data-owner-intro={agent}>
            {INTRO[agent]}
          </li>
        ) : null}
        {messages.map((turn, index) => {
          const messageId = `${agent}:${index}`;
          const playing = playingId === messageId;
          return (
            <li key={messageId} className={`owner-turn is-${turn.role}`}>
              {turn.role === "agent" ? (
                <>
                  <OwnerReply model={formatOwnerReply(turn.text)} />
                  <button
                    type="button"
                    className="owner-listen"
                    aria-pressed={playing}
                    aria-label={playing ? "Stop listening to this reply" : "Listen to this reply"}
                    onClick={() => listenTo(messageId, turn.text)}
                  >
                    {playing ? "Stop" : "Listen"}
                  </button>
                </>
              ) : (
                turn.text
              )}
            </li>
          );
        })}
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
          className={`owner-icon-btn btn${listening ? " is-on" : ""}`}
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
        <button type="submit" className="btn gold owner-ask" disabled={busy || !draft.trim()}>
          <ChatIcon />
          {busy ? "Working…" : `Ask ${short}`}
        </button>
      </form>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
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
