/**
 * Public sample. Gold is the Start free trial CTA only — every in-flow step
 * is cobalt. Avatars stay muted and silent.
 */
import { Fragment, lazy, Suspense, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  readTrialPublicConfig,
  runTrialAnalyst,
  startTrialSample,
  submitTrialLead,
} from "@/lib/trial-demo.functions";
import type { TrialBoard, TrialFinding } from "@/lib/trial-demo";
import type { MarketId } from "@/lib/market/types";

const TrySampleBoards = lazy(() =>
  import("@/components/try-sample-boards").then((mod) => ({ default: mod.TrySampleBoards })),
);
import { AGENT_DISPLAY_NAME } from "@/lib/milon-team-names";
import { SAMPLE_BUSINESS_NAME } from "@/lib/sample-business";
import {
  TRIAL_CTA_LABEL,
  TRIAL_DISCLAIMER,
  TRIAL_SIGNUP_HREF,
  TRIAL_SIGNUP_SENTENCE,
  TRIAL_VALUE_PROP,
  TRIAL_VALUE_PROP_SHORT,
  TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_TEST_TOKEN,
  turnstileSiteKey,
} from "@/lib/trial-public";

export type TryPhase = "start" | "gate" | "reveal" | "findings";

const FACES = [
  { folder: "fm", agent: "financial_manager", role: "Financial Manager" },
  { folder: "analyst", agent: "analyst", role: "Analyst" },
  { folder: "advisor", agent: "advisor", role: "Advisor" },
] as const;

/** Conversation topics the Financial Manager offers after the reveal. */
export type TryTopic = "profit" | "cash" | "advisory";

export const TRY_TOPICS: readonly TryTopic[] = ["profit", "cash", "advisory"] as const;

export const TRY_TOPIC_LABEL: Record<TryTopic, string> = {
  profit: "Profit report",
  cash: "Cash forecast",
  advisory: "Advisory pack",
};

const TOPIC_USER_LINE: Record<TryTopic, string> = {
  profit: "Show me the profit report.",
  cash: "Show me the cash forecast.",
  advisory: "Show me the advisory pack.",
};

const TOPIC_FM_REPLY: Record<TryTopic, string> = {
  profit: `Here it is — ${SAMPLE_BUSINESS_NAME}'s revenue walked down to net profit, step by step. I hold the profit bridge; the Analyst reads the margins.`,
  cash: `Here's the 13-week cash line. The sample has no bank balance, so it opens at zero and follows the monthly run-rate — an estimate, not a bank balance.`,
  advisory: `The Advisor is still turning this diagnosis into the advisory pack — it isn't ready on the sample yet. I'll only show you real work, so here's where it stands.`,
};

export const FM_INTRO = `We've diagnosed ${SAMPLE_BUSINESS_NAME}'s financials. The profitability report and the 13-week cash forecast are built and waiting for your sign-off. Where should we start — the profit report, the cash forecast, or the advisory pack based on this diagnosis?`;

const FM_CLOSING =
  "That's the sample end to end. On a live client, the team prepares all of this from the books — and you sign off.";

const TRY_OPENING =
  "This is Milōn's AI finance team: the Financial Manager, the Analyst and the Advisor. We've loaded a sample business's financial statements. The agents analyze them and give a health score, key ratios and next steps.";

export type TryScreenProps = {
  phase: TryPhase;
  busy?: boolean;
  error?: string | null;
  siteKey?: string | null;
  /** False when production has no Turnstile keys. The widget stays off. */
  turnstile?: boolean;
  board?: TrialBoard | null;
  findings?: TrialFinding[];
  findingsPending?: boolean;
  source?: "model" | "deterministic" | null;
  /** Topics the visitor has asked the Financial Manager for, in order. */
  picks?: TryTopic[];
  runsLeft?: number | null;
  onUseSample?: () => void;
  onSubmitGate?: (input: {
    name: string;
    email: string;
    consent: boolean;
    turnstileToken: string;
    milon_leave_blank: string;
  }) => void;
  onShowFindings?: () => void;
  onPickTopic?: (topic: TryTopic) => void;
};

function TeamRow({ thinking }: { thinking?: boolean }) {
  return (
    <ul className="try-faces" aria-label={thinking ? "Milōn team, thinking" : "Milōn team"}>
      {FACES.map((face) => (
        <Face
          key={face.folder}
          folder={face.folder}
          name={AGENT_DISPLAY_NAME[face.agent]}
          role={face.role}
          thinking={thinking}
        />
      ))}
    </ul>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduced;
}

function Face({
  folder,
  name,
  role,
  thinking,
}: {
  folder: string;
  name: string;
  role: string;
  thinking?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = usePrefersReducedMotion();
  const [live, setLive] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || reduced || !thinking) return;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    const onPlaying = () => setLive(true);
    video.addEventListener("playing", onPlaying);
    const start = () => {
      void video.play().catch(() => {
        /* Poster stays when autoplay is refused. */
      });
    };
    if (video.readyState >= 2) start();
    else video.addEventListener("canplay", start, { once: true });
    return () => video.removeEventListener("playing", onPlaying);
  }, [reduced, thinking]);
  const poster = `/avatars/${folder}/${folder}-poster.webp`;
  const showClip = Boolean(thinking) && !reduced;
  return (
    <li>
      <figure className="try-face">
        <div className="try-portrait">
          <img src={poster} alt="" width={512} height={512} />
          {showClip ? (
            <video
              ref={ref}
              className={live ? "is-live" : undefined}
              muted
              playsInline
              loop
              autoPlay
              preload="auto"
              poster={poster}
              width={512}
              height={512}
              aria-label={`${name}, thinking`}
            >
              <source src={`/avatars/${folder}/${folder}-thinking.webm`} type="video/webm" />
              <source src={`/avatars/${folder}/${folder}-thinking.mp4`} type="video/mp4" />
            </video>
          ) : null}
        </div>
        <figcaption>
          <span>Milōn</span>
          {role}
        </figcaption>
      </figure>
    </li>
  );
}

/** The Financial Manager's portrait. Silent — idle motion only, always muted. */
function FmPortrait({ large }: { large?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = usePrefersReducedMotion();
  const [live, setLive] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || reduced) return;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    const onPlaying = () => setLive(true);
    video.addEventListener("playing", onPlaying);
    const start = () => {
      void video.play().catch(() => {
        /* Poster stays when autoplay is refused. */
      });
    };
    if (video.readyState >= 2) start();
    else video.addEventListener("canplay", start, { once: true });
    return () => video.removeEventListener("playing", onPlaying);
  }, [reduced]);
  const poster = "/avatars/fm/fm-poster.webp";
  return (
    <div className={large ? "try-portrait try-portrait-lg" : "try-portrait try-portrait-sm"}>
      <img src={poster} alt="" width={512} height={512} />
      {!reduced ? (
        <video
          ref={ref}
          className={live ? "is-live" : undefined}
          muted
          playsInline
          loop
          autoPlay
          preload="auto"
          poster={poster}
          width={512}
          height={512}
          aria-label={`${AGENT_DISPLAY_NAME.financial_manager}, listening`}
        >
          <source src="/avatars/fm/fm-idle.webm" type="video/webm" />
          <source src="/avatars/fm/fm-idle.mp4" type="video/mp4" />
        </video>
      ) : null}
    </div>
  );
}

function TrialCta({ className }: { className?: string }) {
  return (
    <a className={className ? `try-cta ${className}` : "try-cta"} href={TRIAL_SIGNUP_HREF}>
      {TRIAL_CTA_LABEL}
    </a>
  );
}

function repliesPrompt(picked: number, remaining: TryTopic[]): string {
  if (picked === 0) return "Pick one — it opens right here in the conversation.";
  const labels = remaining.map((topic) => TRY_TOPIC_LABEL[topic].toLowerCase());
  if (labels.length === 2) return `Want the ${labels[0]} or the ${labels[1]} next?`;
  return `Want the ${labels[0]} too?`;
}

function FmBubble({ children, intro }: { children: React.ReactNode; intro?: boolean }) {
  return (
    <div className={intro ? "try-turn try-turn-fm try-turn-intro" : "try-turn try-turn-fm"}>
      <FmPortrait large={intro} />
      <div className="try-bubble try-bubble-fm">
        <p className="try-bubble-who">
          <span>Milōn</span> Financial Manager
        </p>
        <p className="try-bubble-text">{children}</p>
      </div>
    </div>
  );
}

function TryConversation({
  picks,
  market,
  onPick,
}: {
  picks: TryTopic[];
  market: MarketId;
  onPick?: (topic: TryTopic) => void;
}) {
  const remaining = TRY_TOPICS.filter((topic) => !picks.includes(topic));
  return (
    <section className="try-card try-chat" aria-label="Talk to the Milōn Financial Manager">
      <div className="try-chat-team" aria-label="The Milōn team on this sample">
        {FACES.map((face) => (
          <span key={face.folder} className="try-chat-team-member">
            <img
              src={`/avatars/${face.folder}/${face.folder}-poster.webp`}
              alt=""
              width={64}
              height={64}
            />
            {face.role}
          </span>
        ))}
        <span className="try-stamp">SAMPLE</span>
      </div>
      <div className="try-chat-thread">
        <FmBubble intro>{FM_INTRO}</FmBubble>
        {picks.map((topic) => (
          <Fragment key={topic}>
            <div className="try-turn try-turn-user">
              <div className="try-bubble try-bubble-user">
                <p className="try-bubble-who">You</p>
                <p className="try-bubble-text">{TOPIC_USER_LINE[topic]}</p>
              </div>
            </div>
            <FmBubble>{TOPIC_FM_REPLY[topic]}</FmBubble>
            {topic === "advisory" ? (
              <div className="try-pack-preparing" role="status">
                <p className="try-chat-board-who">
                  <span>Milōn</span> Advisor
                </p>
                <strong>Preparing your advisory pack — coming next.</strong>
                <p>
                  The Advisor turns this diagnosis into recommended moves. The pack isn't ready on
                  the sample yet, and we don't show a mock-up in its place.
                </p>
              </div>
            ) : (
              <div className="try-chat-board">
                <p className="try-chat-board-caption">
                  <span className="try-stamp">SAMPLE</span>
                  <span className="try-chat-board-who">
                    <span>Milōn</span> Financial Manager
                  </span>
                  {topic === "profit" ? "Profit report" : "13-week cash forecast"}
                </p>
                <Suspense fallback={<p className="try-status">Working from the sample figures.</p>}>
                  <TrySampleBoards
                    market={market}
                    profit={topic === "profit"}
                    cash={topic === "cash"}
                  />
                </Suspense>
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {remaining.length > 0 ? (
        <div className="try-replies">
          <p className="try-replies-prompt">{repliesPrompt(picks.length, remaining)}</p>
          <div className="try-replies-row">
            {remaining.map((topic) => (
              <button
                key={topic}
                type="button"
                className="try-reply"
                onClick={() => onPick?.(topic)}
              >
                {TRY_TOPIC_LABEL[topic]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="try-chat-close">
        {remaining.length === 0 ? <p className="try-chat-close-line">{FM_CLOSING}</p> : null}
        <p className="try-value">{TRIAL_VALUE_PROP}</p>
        <TrialCta className="try-cta-close" />
        <p className="try-trial-terms">{TRIAL_SIGNUP_SENTENCE}</p>
      </div>
    </section>
  );
}

function HealthRing({ score, label }: { score: number | null; label: string }) {
  const size = 156;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const shown = score == null ? 0 : Math.max(0, Math.min(100, score));
  const offset = circ * (1 - shown / 100);
  const center = size / 2;
  return (
    <div
      className="try-ring"
      data-band={label}
      style={{
        ["--try-ring-c" as string]: String(circ),
        ["--try-ring-off" as string]: String(offset),
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#dbeafe"
          strokeWidth={stroke}
        />
        {score == null ? null : (
          <circle
            className="try-ring-arc"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
        )}
      </svg>
      <b>{score == null ? "—" : Math.round(score)}</b>
    </div>
  );
}

function TurnstileBox({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    const render = () => {
      const turnstile = (
        window as Window & {
          turnstile?: {
            render: (el: HTMLElement, opts: Record<string, unknown>) => string;
            remove: (id: string) => void;
          };
        }
      ).turnstile;
      if (!turnstile || !host.current || widgetId) return false;
      widgetId = turnstile.render(host.current, {
        sitekey: siteKey,
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": () => onTokenRef.current(""),
      });
      return true;
    };
    const scriptId = "cf-turnstile-api";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const timer = window.setInterval(() => {
      if (render()) window.clearInterval(timer);
    }, 200);
    const fallback = window.setTimeout(() => {
      if (cancelled || siteKey !== TURNSTILE_TEST_SITE_KEY) return;
      onTokenRef.current(TURNSTILE_TEST_TOKEN);
    }, 2500);
    render();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(fallback);
      const turnstile = (window as Window & { turnstile?: { remove: (id: string) => void } })
        .turnstile;
      if (widgetId && turnstile) turnstile.remove(widgetId);
    };
  }, [siteKey]);
  return <div ref={host} className="try-turnstile" />;
}

function Frame({ phase, children }: { phase: TryPhase; children: React.ReactNode }) {
  return (
    <main className="try-page" data-try-phase={phase}>
      <div className="try-wrap">
        <div className="try-top">
          <a className="try-home" href="/">
            Milōn
          </a>
          <span className="try-stamp">SAMPLE</span>
        </div>
        {children}
        <p className="try-sign">The MILŌN Team</p>
      </div>
      <div className="try-ctabar" aria-label="Start a free trial">
        <p className="try-ctabar-copy">
          <strong>Milōn</strong>
          <span>{TRIAL_VALUE_PROP_SHORT}</span>
          <small>{TRIAL_SIGNUP_SENTENCE}</small>
        </p>
        <TrialCta className="try-ctabar-btn" />
      </div>
    </main>
  );
}

export function TryScreen(props: TryScreenProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");
  const [leaveBlank, setLeaveBlank] = useState("");
  const showTurnstile = props.turnstile !== false && Boolean(props.siteKey);

  if (props.phase === "start") {
    return (
      <Frame phase="start">
        <p className="try-kicker">Sample</p>
        <h1 className="try-title try-title-hero">See a health score on sample figures.</h1>
        <p className="try-lead">{TRY_OPENING}</p>
        <p className="try-value">{TRIAL_VALUE_PROP}</p>
        <div className="try-card try-start">
          <TeamRow thinking={props.busy} />
          <button
            type="button"
            className="try-step"
            disabled={props.busy}
            onClick={props.onUseSample}
          >
            Use sample
          </button>
          {props.error ? <p className="try-error">{props.error}</p> : null}
        </div>
      </Frame>
    );
  }

  if (props.phase === "gate") {
    return (
      <Frame phase="gate">
        <p className="try-kicker">Sample</p>
        <h1 className="try-title">Where should we send this?</h1>
        <p className="try-lead">
          Your name, email, and a yes. Then the sample health score. Nothing is sent to an
          accountant.
        </p>
        <form
          className="try-card try-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmitGate?.({
              name,
              email,
              consent,
              turnstileToken: token,
              milon_leave_blank: leaveBlank,
            });
          }}
        >
          <label className="try-field">
            Name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label className="try-field">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="try-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>I agree Milōn may email me about this sample.</span>
          </label>
          <div className="try-hp" aria-hidden="true">
            <label>
              Leave this blank
              <input
                type="text"
                name="milon_leave_blank"
                tabIndex={-1}
                autoComplete="off"
                value={leaveBlank}
                onChange={(event) => setLeaveBlank(event.target.value)}
              />
            </label>
          </div>
          {showTurnstile && props.siteKey ? (
            <TurnstileBox siteKey={props.siteKey} onToken={setToken} />
          ) : null}
          <button
            type="submit"
            className="try-step"
            disabled={props.busy || (props.turnstile !== false && !props.siteKey)}
          >
            Show the score
          </button>
          {props.error ? <p className="try-error">{props.error}</p> : null}
        </form>
      </Frame>
    );
  }

  const board = props.board;
  return (
    <Frame phase={props.phase}>
      <p className="try-kicker">Sample</p>
      <h1 className="try-title">Sample health score</h1>
      <p className="try-lead">{TRY_OPENING}</p>
      <section className="try-card try-reveal" aria-label="Health score">
        <div className="try-hero">
          <HealthRing score={board?.health.score ?? null} label={board?.health.label ?? ""} />
          <div className="try-hero-copy">
            <p className="try-band" data-band={board?.health.label ?? ""}>
              {board?.health.label ?? ""}
            </p>
            <p className="try-hero-note">
              The ratios below are what the Analyst reads. The ring is only the summary.
            </p>
          </div>
        </div>
        <h2 className="try-section">Pillars</h2>
        <ul className="try-pillars">
          {(board?.health.pillars ?? []).map((pillar) => {
            const width = pillar.score == null ? 0 : Math.max(0, Math.min(100, pillar.score));
            return (
              <li key={pillar.id}>
                <span className="try-metric-name">{pillar.label}</span>
                <span className="try-metric-value">
                  {pillar.score == null ? "—" : Math.round(pillar.score)} · {pillar.status}
                </span>
                <span className="try-meter" aria-hidden="true">
                  <span style={{ width: `${width}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
        <h2 className="try-section">Ratios</h2>
        <ul className="try-ratios">
          {(board?.ratios ?? []).map((ratio) => (
            <li key={ratio.name}>
              <span className="try-metric-name">{ratio.name}</span>
              <span className="try-metric-value">{ratio.display}</span>
            </li>
          ))}
        </ul>
        {props.phase === "reveal" ? (
          <div style={{ marginTop: 20 }}>
            <button
              type="button"
              className="try-step"
              disabled={props.busy}
              onClick={props.onShowFindings}
            >
              Show findings
            </button>
          </div>
        ) : null}
        {props.error && props.phase === "reveal" ? (
          <p className="try-error">{props.error}</p>
        ) : null}
      </section>

      {props.phase === "findings" ? (
        <section className="try-card" aria-label="Findings" data-try-findings="true">
          <h2 className="try-kicker">Findings</h2>
          <TeamRow thinking={props.findingsPending} />
          <p className="try-status" aria-live="polite">
            {props.findingsPending
              ? "Reading the sample figures."
              : props.source === "deterministic"
                ? "Three notes from the sample figures."
                : "Three notes from the Analyst."}
          </p>
          <div className="try-findings">
            {[0, 1, 2].map((slot) => {
              const finding = props.findingsPending ? undefined : props.findings?.[slot];
              return (
                <article className={finding ? "try-finding is-in" : "try-finding"} key={slot}>
                  {finding ? (
                    <>
                      <h3>{finding.title}</h3>
                      <p>{finding.detail}</p>
                    </>
                  ) : (
                    <div className="try-ghost" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <p className="try-disclaimer">
            {props.source === "deterministic"
              ? "Prepared from the sample ratios, margins, and cash line. Not reviewed by an accountant."
              : TRIAL_DISCLAIMER}
          </p>
          {props.error ? <p className="try-error">{props.error}</p> : null}
        </section>
      ) : null}

      <TryConversation
        picks={props.picks ?? []}
        market={(board?.market ?? "US") as MarketId}
        onPick={props.onPickTopic}
      />

      {props.runsLeft != null ? (
        <p className="try-runs">Sample runs left: {props.runsLeft}</p>
      ) : null}
    </Frame>
  );
}

function readUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}

export function TryDemo() {
  const start = useServerFn(startTrialSample);
  const submit = useServerFn(submitTrialLead);
  const analyst = useServerFn(runTrialAnalyst);
  const loadConfig = useServerFn(readTrialPublicConfig);
  const [phase, setPhase] = useState<TryPhase>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(() =>
    turnstileSiteKey(import.meta.env.VITE_TURNSTILE_SITE_KEY, import.meta.env.DEV),
  );
  const [turnstile, setTurnstile] = useState(
    () => turnstileSiteKey(import.meta.env.VITE_TURNSTILE_SITE_KEY, import.meta.env.DEV) != null,
  );
  const [board, setBoard] = useState<TrialBoard | null>(null);
  const [findings, setFindings] = useState<TrialFinding[]>([]);
  const [source, setSource] = useState<"model" | "deterministic" | null>(null);
  const [findingsPending, setFindingsPending] = useState(false);
  const [picks, setPicks] = useState<TryTopic[]>([]);
  const [runsLeft, setRunsLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadConfig()
      .then((config) => {
        if (cancelled) return;
        setTurnstile(config.turnstile);
        setSiteKey(config.turnstile ? config.siteKey : null);
      })
      .catch(() => {
        /* A failed config read keeps the baked decision. The page stays up. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TryScreen
      phase={phase}
      busy={busy}
      error={error}
      siteKey={siteKey}
      turnstile={turnstile}
      board={board}
      findings={findings}
      source={source}
      findingsPending={findingsPending}
      picks={picks}
      runsLeft={runsLeft}
      onUseSample={() => {
        setBusy(true);
        setError(null);
        void start()
          .then((result) => {
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setPhase("gate");
          })
          .catch(() => setError("The sample isn't available right now."))
          .finally(() => setBusy(false));
      }}
      onSubmitGate={(input) => {
        setBusy(true);
        setError(null);
        void submit({ data: { ...input, utm: readUtm() } })
          .then((result) => {
            if (!result.ok) {
              if ("silent" in result && result.silent) return;
              setError(result.error);
              return;
            }
            setBoard(result.board);
            setPhase("reveal");
          })
          .catch(() => setError("The sample isn't available right now."))
          .finally(() => setBusy(false));
      }}
      onShowFindings={() => {
        setPhase("findings");
        setFindingsPending(true);
        setError(null);
        void analyst()
          .then((result) => {
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setFindings(result.findings);
            setSource(result.mode);
            setRunsLeft(result.runsLeft);
          })
          .catch(() => setError("The sample isn't available right now."))
          .finally(() => setFindingsPending(false));
      }}
      onPickTopic={(topic) => {
        setPicks((current) => (current.includes(topic) ? current : [...current, topic]));
        setError(null);
      }}
    />
  );
}
