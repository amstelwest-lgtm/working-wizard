/**
 * Full-screen one-agent conversation. The greeting is already on screen.
 * Name and email come after three useful replies. The chat stays open
 * after the form. Schedule a call is an optional disclosure.
 */
import { useEffect, useState, type FormEvent } from "react";
import { SilentAgentPortrait } from "@/components/silent-agent-portrait";
import { TrySchedule, type TryCallResult } from "@/components/try-schedule";
import { postProspectTalk } from "@/lib/prospect-talk-client";
import {
  PROSPECT_FM_SLUG,
  prospectAgentsFor,
  resolveTalkSlug,
  sanitizeRef,
  type ProspectAgentCopy,
  type TalkCopyPack,
} from "@/lib/prospect-talk";

export type TalkMessage = { role: "agent" | "you"; text: string };

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
}: {
  refCode: string | null;
  copyPack?: TalkCopyPack;
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
      <AgentList refCode={refCode} agents={agents} />
    </main>
  );
}

export function TaxSpecialistElsewhere({ refCode }: { refCode: string | null }) {
  const query = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";
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
      <a className="talk-next" href={`/talk/${PROSPECT_FM_SLUG}${query}`}>
        Talk to the Financial Manager
      </a>
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
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const thread: TalkMessage[] = [{ role: "agent", text: agent.greeting }, ...messages];
  const clip = busy ? "thinking" : askLead ? "waiting" : "idle";

  return (
    <main className="talk-page" data-talk-view="agent" data-talk-agent={agent.slug}>
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
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onLead?.({ name, email, consent, honeypot });
          }}
        >
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
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            onSend?.(text);
          }}
        >
          <div className="talk-chips">
            {agent.questions.map((question) => (
              <button
                key={question}
                type="button"
                className="talk-chip"
                disabled={busy}
                onClick={() => onSend?.(question)}
              >
                {question}
              </button>
            ))}
          </div>
          <textarea
            aria-label="Message"
            rows={3}
            maxLength={500}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="talk-send" type="submit" disabled={busy}>
            Send
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
}) {
  const [refCode, setRefCode] = useState<string | null>(null);
  const [messages, setMessages] = useState<TalkMessage[]>([]);
  const [askLead, setAskLead] = useState(false);
  const [leadReady, setLeadReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    setRefCode(pageRef());
    setMessages([]);
    setAskLead(false);
    setLeadReady(false);
    setError(null);
    setToken(window.sessionStorage.getItem(`milon-talk:${slug}`) ?? "");
  }, [slug]);

  function remember(next: string) {
    setToken(next);
    window.sessionStorage.setItem(`milon-talk:${slug}`, next);
  }

  return (
    <TalkPageView
      slug={slug}
      copyPack={copyPack}
      taxAgent={taxAgent}
      refCode={refCode}
      messages={messages}
      askLead={askLead}
      leadReady={leadReady}
      busy={busy}
      error={error}
      onBookCall={onBookCall}
      onSend={(text) => {
        setBusy(true);
        setError(null);
        setMessages((current) => [...current, { role: "you", text }]);
        void postProspectTalk({
          action: "turn",
          agent: slug,
          message: text,
          sessionToken: token,
          ref: refCode,
          market: pageMarket(),
          utm: pageUtm(),
        })
          .then((result) => {
            if (!result.ok) {
              setError(result.error ?? "The conversation isn't available right now.");
              return;
            }
            if (result.sessionToken) remember(result.sessionToken);
            if (result.reply) {
              setMessages((current) => [...current, { role: "agent", text: result.reply ?? "" }]);
            }
            setAskLead(result.askLead === true);
          })
          .catch(() => setError("The conversation isn't available right now."))
          .finally(() => setBusy(false));
      }}
      onLead={(input) => {
        setBusy(true);
        setError(null);
        void postProspectTalk({
          action: "lead",
          agent: slug,
          sessionToken: token,
          name: input.name,
          email: input.email,
          consent: input.consent,
          milon_leave_blank: input.honeypot,
          ref: refCode,
          market: pageMarket(),
          utm: pageUtm(),
        })
          .then((result) => {
            if (!result.ok) {
              if (result.silent) return;
              setError(result.error ?? "The sample isn't available right now.");
              return;
            }
            setAskLead(false);
            setLeadReady(true);
            if (result.reply) {
              setMessages((current) => [...current, { role: "agent", text: result.reply ?? "" }]);
            }
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
      onSend={onSend}
      onLead={onLead}
      onBookCall={onBookCall}
    />
  );
}
