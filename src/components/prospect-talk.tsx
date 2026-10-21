/**
 * Full-screen one-agent conversation. The greeting is already on screen.
 * Name and email come after three useful replies. The chat stays open
 * after the form. Schedule a call is an optional disclosure.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { SilentAgentPortrait } from "@/components/silent-agent-portrait";
import { TrySchedule, type TryCallResult } from "@/components/try-schedule";
import { postProspectTalk, type ProspectTalkResponse } from "@/lib/prospect-talk-client";
import {
  prospectAgentsFor,
  resolveTalkSlug,
  sanitizeRef,
  type ProspectAgentCopy,
  type TalkCopyPack,
} from "@/lib/prospect-talk";
import { TALK_DRAFT_STORAGE_KEY } from "@/lib/prospect-talk-draft";
import { initialTalkSession, openTalkSession, queueTalkMessage } from "@/lib/prospect-talk-session";

export type TalkMessage = { role: "agent" | "you"; text: string };

type TalkSnapshot = {
  messages: TalkMessage[];
  askLead: boolean;
  leadReady: boolean;
  /** Messages shown but not posted yet, because the session token was still loading. */
  queued: string[];
};

const talkSnapshots = new Map<string, TalkSnapshot>();
const talkListeners = new Map<string, Set<(snapshot: TalkSnapshot) => void>>();

function emptySnapshot(): TalkSnapshot {
  return { messages: [], askLead: false, leadReady: false, queued: [] };
}

function threadStorageKey(slug: string): string {
  return `milon-talk-thread:${slug}`;
}

function readSnapshot(slug: string): TalkSnapshot {
  return talkSnapshots.get(slug) ?? emptySnapshot();
}

function isTalkMessage(value: unknown): value is TalkMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as TalkMessage;
  return (message.role === "you" || message.role === "agent") && typeof message.text === "string";
}

/** Same-tab copy of the thread. The module map is what a remount reads synchronously. */
function rememberStoredThread(slug: string): TalkSnapshot | null {
  const cached = talkSnapshots.get(slug);
  if (cached) return cached;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(threadStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TalkSnapshot>;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    const snapshot: TalkSnapshot = {
      messages: parsed.messages.filter(isTalkMessage),
      askLead: parsed.askLead === true,
      leadReady: parsed.leadReady === true,
      queued: Array.isArray(parsed.queued)
        ? parsed.queued.filter((text): text is string => typeof text === "string" && text.trim().length > 0)
        : [],
    };
    talkSnapshots.set(slug, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

function publishSnapshot(slug: string, recipe: (current: TalkSnapshot) => TalkSnapshot) {
  const next = recipe(readSnapshot(slug));
  talkSnapshots.set(slug, next);
  try {
    const empty =
      next.messages.length === 0 && next.queued.length === 0 && !next.askLead && !next.leadReady;
    if (empty) window.sessionStorage.removeItem(threadStorageKey(slug));
    else window.sessionStorage.setItem(threadStorageKey(slug), JSON.stringify(next));
  } catch {
    /* private mode */
  }
  for (const listener of talkListeners.get(slug) ?? []) listener(next);
}

function packOf(copyPack: TalkCopyPack): "za" | "us" {
  return copyPack === "za" ? "za" : "us";
}

function AgentList({
  refCode,
  agents,
}: {
  refCode: string | null;
  agents: readonly ProspectAgentCopy[];
}) {
  const query = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";
  return (
    <ul className="talk-picks">
      {agents.map((agent) => (
        <li className="talk-pick" key={agent.slug}>
          <a href={`/talk/${agent.slug}${query}`}>{agent.role}</a>
        </li>
      ))}
    </ul>
  );
}

export function TalkIndex({
  refCode,
  copyPack,
  priceLine,
}: {
  refCode: string | null;
  copyPack?: TalkCopyPack;
  priceLine?: string;
}) {
  const agents = prospectAgentsFor(copyPack);
  const count = agents.length === 4 ? "Four" : "Three";
  return (
    <main className="talk-page" data-talk-view="index" data-talk-pack={packOf(copyPack)}>
      <div className="talk-top">
        <a className="talk-wordmark" href="/">
          MILŌN
        </a>
        <span className="talk-stamp">SAMPLE</span>
      </div>
      <h1 className="talk-title">Talk to an agent</h1>
      <p className="talk-note">
        {count} agents. Each one walks a labelled SAMPLE. No account and no password.
      </p>
      {priceLine ? (
        <div data-talk-price="true">
          {priceLine
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => (
              <p className="talk-note" key={line}>
                {line}
              </p>
            ))}
        </div>
      ) : null}
      <AgentList refCode={refCode} agents={agents} />
    </main>
  );
}

export function TaxSpecialistElsewhere({ refCode }: { refCode: string | null }) {
  const query = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";
  const others = prospectAgentsFor("us");
  return (
    <main className="talk-page" data-talk-view="tax-elsewhere">
      <div className="talk-top">
        <a className="talk-wordmark" href="/">
          MILŌN
        </a>
        <span className="talk-stamp">SAMPLE</span>
      </div>
      <h1 className="talk-title">Tax Specialist</h1>
      <p className="talk-note">The Tax Specialist covers South African tax.</p>
      <ul className="talk-picks">
        {others.map((agent) => (
          <li className="talk-pick" key={agent.slug}>
            <a href={`/talk/${agent.slug}${query}`}>Talk to the {agent.role}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function AgentPicker({
  refCode,
  copyPack,
  reason,
}: {
  refCode: string | null;
  copyPack?: TalkCopyPack;
  reason: "unknown" | "unavailable";
}) {
  return (
    <main className="talk-page" data-talk-view="picker" data-talk-reason={reason}>
      <div className="talk-top">
        <a className="talk-wordmark" href="/">
          MILŌN
        </a>
        <span className="talk-stamp">SAMPLE</span>
      </div>
      <h1 className="talk-title">Pick an agent</h1>
      <p className="talk-note">
        {reason === "unknown"
          ? "That link doesn't match an agent. Choose who you want to talk to."
          : "This conversation isn't available here. Choose another agent."}
      </p>
      <AgentList refCode={refCode} agents={prospectAgentsFor(copyPack)} />
    </main>
  );
}

export function ProspectTalkScreen({
  agent,
  messages,
  askLead,
  busy,
  error,
  leadReady = false,
  sessionReady = true,
  onSend,
  onLead,
  onBookCall,
}: {
  agent: ProspectAgentCopy;
  messages: TalkMessage[];
  askLead: boolean;
  busy?: boolean;
  error?: string | null;
  leadReady?: boolean;
  sessionReady?: boolean;
  onSend?: (text: string) => void;
  onLead?: (input: { name: string; email: string; consent: boolean; honeypot: string }) => void;
  onBookCall?: (input: {
    name: string;
    email: string;
    consent: boolean;
    honeypot: string;
    start: string;
    timeZone: string;
  }) => Promise<TryCallResult>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [live, setLive] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const thread: TalkMessage[] = [{ role: "agent", text: agent.greeting }, ...messages];
  const clip = busy ? "thinking" : askLead ? "waiting" : "idle";

  function sendDraft(text = areaRef.current?.value ?? "") {
    if (!live || busy) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (areaRef.current) areaRef.current.value = "";
    try {
      window.sessionStorage.removeItem(TALK_DRAFT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    onSend?.(trimmed);
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!live) return;
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendDraft(event.currentTarget.value);
  }

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (area && !area.value) {
      try {
        const saved = window.sessionStorage.getItem(TALK_DRAFT_STORAGE_KEY) ?? "";
        if (saved) area.value = saved;
      } catch {
        /* ignore */
      }
    }
    setLive(true);
  }, []);

  return (
    <main
      className="talk-page"
      data-talk-view="agent"
      data-talk-agent={agent.slug}
      data-talk-session={sessionReady ? "ready" : "pending"}
    >
      <div className="talk-top">
        <a className="talk-wordmark" href="/">
          MILŌN
        </a>
        <span className="talk-stamp">SAMPLE</span>
      </div>
      <div className="talk-stage">
        <SilentAgentPortrait face={agent.face} label={agent.role} large clip={clip} />
        <div>
          <p className="talk-kicker">Milōn</p>
          <h1 className="talk-title">{agent.role}</h1>
          <p className="talk-note">No account and no password.</p>
        </div>
      </div>
      <div className="talk-thread" aria-live="polite">
        {thread.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={
              message.role === "you"
                ? "talk-bubble talk-bubble-you"
                : "talk-bubble talk-bubble-agent"
            }
          >
            <span className="talk-who">{message.role === "you" ? "You" : agent.role}</span>
            <p>{message.text}</p>
            {index === 0 && message.role === "agent" ? (
              <ol className="talk-questions">
                {agent.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ))}
      </div>
      {askLead ? (
        <form
          className="talk-form"
          data-talk-lead="true"
          aria-labelledby="talk-lead-label"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onLead?.({ name, email, consent, honeypot });
          }}
        >
          <p className="talk-lead-label" id="talk-lead-label">
            Your name and email
          </p>
          <p className="talk-note">No password. This continues the sample.</p>
          <label className="talk-field" htmlFor="talk-name">
            Name
            <input
              id="talk-name"
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="talk-field" htmlFor="talk-email">
            Email
            <input
              id="talk-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="talk-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>I agree Milōn may email me about this sample.</span>
          </label>
          <div className="talk-hp" aria-hidden="true">
            <label>
              Leave this blank
              <input
                type="text"
                name="milon_leave_blank"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </label>
          </div>
          <button className="talk-step" type="submit" disabled={busy}>
            Continue to the sample
          </button>
          {error ? <p className="talk-error">{error}</p> : null}
        </form>
      ) : (
        <form
          className="talk-composer"
          data-talk-live={live ? "1" : undefined}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            sendDraft();
          }}
        >
          <div className="talk-chips">
            {agent.questions.map((question) => (
              <button
                key={question}
                type="button"
                className="talk-chip"
                disabled={!live || busy}
                onClick={() => {
                  if (!live || busy) return;
                  onSend?.(question);
                }}
              >
                {question}
              </button>
            ))}
          </div>
          <textarea
            ref={areaRef}
            aria-label="Message"
            rows={3}
            maxLength={500}
            defaultValue=""
            onKeyDown={onComposerKey}
          />
          <button
            className={live ? "talk-send" : "talk-send is-connecting"}
            type="button"
            disabled={!live || busy}
            onClick={() => sendDraft()}
          >
            {live ? "Send" : "Connecting…"}
          </button>
          {error ? <p className="talk-error">{error}</p> : null}
        </form>
      )}
      {leadReady ? (
        <details className="talk-schedule" data-talk-schedule="optional">
          <summary>Schedule a call</summary>
          <TrySchedule onBook={onBookCall} />
        </details>
      ) : null}
    </main>
  );
}

function pageRef(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeRef(new URLSearchParams(window.location.search).get("ref"));
}

function pageMarket(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("market");
}

function pageUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}

export function ProspectTalkLive({
  slug,
  copyPack,
  taxAgent = null,
  onBookCall,
  readStoredToken,
  sendTurn = postProspectTalk,
}: {
  slug: string;
  copyPack: "za" | "us";
  taxAgent?: ProspectAgentCopy | null;
  onBookCall?: (input: {
    name: string;
    email: string;
    consent: boolean;
    honeypot: string;
    start: string;
    timeZone: string;
  }) => Promise<TryCallResult>;
  /** Test seam. Production reads sessionStorage after paint. */
  readStoredToken?: () => Promise<string | null>;
  /** Test seam. Production posts to the prospect-talk edge function. */
  sendTurn?: (body: Record<string, unknown>) => Promise<ProspectTalkResponse>;
}) {
  const [refCode, setRefCode] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<TalkSnapshot>(() => readSnapshot(slug));
  const { messages, askLead, leadReady } = snapshot;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const gateRef = useRef(initialTalkSession());
  const slugSeen = useRef<string | null>(null);
  const postRef = useRef<(text: string, sessionToken: string) => void>(() => {});

  function updateSnapshot(recipe: (current: TalkSnapshot) => TalkSnapshot) {
    publishSnapshot(slug, recipe);
  }

  useLayoutEffect(() => {
    const stored = rememberStoredThread(slug);
    if (stored) setSnapshot(stored);
  }, [slug]);

  useEffect(() => {
    const listener = (next: TalkSnapshot) => setSnapshot(next);
    const listeners = talkListeners.get(slug) ?? new Set<(snapshot: TalkSnapshot) => void>();
    talkListeners.set(slug, listeners);
    listeners.add(listener);
    const stored = rememberStoredThread(slug);
    if (stored) setSnapshot(stored);
    return () => {
      listeners.delete(listener);
    };
  }, [slug]);

  function remember(next: string) {
    setToken(next);
    gateRef.current = { ...gateRef.current, token: next };
    window.sessionStorage.setItem(`milon-talk:${slug}`, next);
  }

  function applyResult(result: ProspectTalkResponse | null) {
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error ?? "The conversation isn't available right now.");
      return;
    }
    if (result.sessionToken) remember(result.sessionToken);
    const reply = result.reply;
    updateSnapshot((current) => {
      const messages = reply
        ? current.messages.some((message) => message.role === "agent" && message.text === reply)
          ? current.messages
          : [...current.messages, { role: "agent", text: reply }]
        : current.messages;
      return { ...current, messages, askLead: result.askLead === true };
    });
  }

  postRef.current = (text, sessionToken) => {
    setBusy(true);
    setError(null);
    void sendTurn({
      action: "turn",
      agent: slug,
      message: text,
      sessionToken,
      ref: pageRef(),
      market: pageMarket(),
      utm: pageUtm(),
    })
      .then((result) => applyResult(result))
      .catch(() => applyResult(null));
  };

  useEffect(() => {
    let cancelled = false;
    const switched = slugSeen.current !== null && slugSeen.current !== slug;
    slugSeen.current = slug;
    if (switched) {
      gateRef.current = initialTalkSession();
      setError(null);
      setSessionReady(false);
    }
    setRefCode(pageRef());
    const apply = (stored: string) => {
      if (cancelled) return;
      if (!gateRef.current.ready && gateRef.current.queued.length === 0) {
        const queued = readSnapshot(slug).queued;
        if (queued.length > 0) gateRef.current = { ...gateRef.current, queued: [...queued] };
      }
      const opened = openTalkSession(gateRef.current, stored);
      gateRef.current = opened.gate;
      setToken(stored);
      setSessionReady(true);
      if (readSnapshot(slug).queued.length > 0) {
        updateSnapshot((current) => ({ ...current, queued: [] }));
      }
      for (const text of opened.deliver) postRef.current(text, stored);
    };
    if (readStoredToken) {
      void readStoredToken().then((stored) => {
        if (!cancelled) apply(stored ?? "");
      });
      return () => {
        cancelled = true;
      };
    }
    apply(window.sessionStorage.getItem(`milon-talk:${slug}`) ?? "");
    return () => {
      cancelled = true;
    };
  }, [slug, readStoredToken]);

  return (
    <TalkPageView
      slug={slug}
      copyPack={copyPack}
      taxAgent={taxAgent}
      refCode={refCode}
      messages={messages}
      askLead={askLead}
      leadReady={leadReady}
      sessionReady={sessionReady}
      busy={busy}
      error={error}
      onBookCall={onBookCall}
      onSend={(text) => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;
        setError(null);
        updateSnapshot((current) => ({
          ...current,
          messages: [...current.messages, { role: "you", text: trimmed }],
        }));
        const gate = gateRef.current;
        if (!gate.ready) {
          gateRef.current = queueTalkMessage(gate, trimmed);
          const queued = gateRef.current.queued;
          updateSnapshot((current) => ({ ...current, queued }));
          return;
        }
        postRef.current(trimmed, gate.token);
      }}
      onLead={(input) => {
        setBusy(true);
        setError(null);
        void sendTurn({
          action: "lead",
          agent: slug,
          sessionToken: token,
          name: input.name,
          email: input.email,
          consent: input.consent,
          milon_leave_blank: input.honeypot,
          ref: pageRef(),
          market: pageMarket(),
          utm: pageUtm(),
        })
          .then((result) => {
            if (!result.ok) {
              if (result.silent) return;
              setError(result.error ?? "The sample isn't available right now.");
              return;
            }
            const reply = result.reply;
            updateSnapshot((current) => ({
              ...current,
              askLead: false,
              leadReady: true,
              messages: reply
                ? [...current.messages, { role: "agent", text: reply }]
                : current.messages,
            }));
          })
          .catch(() => setError("The sample isn't available right now."))
          .finally(() => setBusy(false));
      }}
    />
  );
}

export function TalkPageView({
  slug,
  copyPack,
  taxAgent = null,
  refCode = null,
  messages,
  askLead = false,
  busy,
  error,
  leadReady = false,
  sessionReady = true,
  onSend,
  onLead,
  onBookCall,
}: {
  slug: string;
  copyPack: TalkCopyPack;
  taxAgent?: ProspectAgentCopy | null;
  refCode?: string | null;
  messages?: TalkMessage[];
  askLead?: boolean;
  busy?: boolean;
  error?: string | null;
  leadReady?: boolean;
  sessionReady?: boolean;
  onSend?: (text: string) => void;
  onLead?: (input: { name: string; email: string; consent: boolean; honeypot: string }) => void;
  onBookCall?: (input: {
    name: string;
    email: string;
    consent: boolean;
    honeypot: string;
    start: string;
    timeZone: string;
  }) => Promise<TryCallResult>;
}) {
  const view = resolveTalkSlug(slug, copyPack);
  if (view.kind === "tax-elsewhere") {
    return <TaxSpecialistElsewhere refCode={refCode} />;
  }
  if (view.kind === "picker") {
    return <AgentPicker refCode={refCode} copyPack={copyPack} reason={view.reason} />;
  }
  const agent = view.agent.slug === "tax-specialist" && taxAgent ? taxAgent : view.agent;
  return (
    <ProspectTalkScreen
      agent={agent}
      messages={messages ?? []}
      askLead={askLead}
      busy={busy}
      error={error}
      leadReady={leadReady}
      sessionReady={sessionReady}
      onSend={onSend}
      onLead={onLead}
      onBookCall={onBookCall}
    />
  );
}
