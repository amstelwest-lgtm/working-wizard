/**
 * Public sample. One gold control per screen. Avatars stay muted.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  readTrialPublicConfig,
  runTrialAnalyst,
  runTrialChip,
  startTrialSample,
  submitTrialLead,
} from "@/lib/trial-demo.functions";
import type { TrialBoard, TrialCash, TrialFinding, TrialProfit } from "@/lib/trial-demo";
import {
  TRIAL_DISCLAIMER,
  TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_TEST_TOKEN,
  turnstileSiteKey,
} from "@/lib/trial-public";

export type TryPhase = "start" | "gate" | "reveal" | "findings";

const FACES = [
  { folder: "fm", name: "Milōn Financial Manager" },
  { folder: "analyst", name: "Milōn Analyst" },
  { folder: "advisor", name: "Milōn Advisor" },
] as const;

type ChipId = "profit" | "cash" | null;

export type TryScreenProps = {
  phase: TryPhase;
  busy?: boolean;
  error?: string | null;
  siteKey?: string | null;
  board?: TrialBoard | null;
  findings?: TrialFinding[];
  findingsPending?: boolean;
  chip?: ChipId;
  chipPending?: boolean;
  profit?: TrialProfit | null;
  cash?: TrialCash | null;
  runsLeft?: number | null;
  onUseSample?: () => void;
  onSubmitGate?: (input: {
    name: string;
    email: string;
    consent: boolean;
    turnstileToken: string;
  }) => void;
  onShowFindings?: () => void;
  onChip?: (chip: "profit" | "cash") => void;
};

function ThinkingFaces() {
  return (
    <ul className="try-faces" aria-label="Milōn team, thinking">
      {FACES.map((face) => (
        <Face key={face.folder} folder={face.folder} name={face.name} />
      ))}
    </ul>
  );
}

function Face({ folder, name }: { folder: string; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    const video = ref.current;
    if (!video || reduced) return;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    void video.play().catch(() => {
      /* Poster stays when autoplay is refused. */
    });
  }, [reduced]);
  const poster = `/avatars/${folder}/${folder}-poster.webp`;
  return (
    <li>
      <figure className="try-face">
        {reduced ? (
          <img src={poster} alt="" width={104} height={104} />
        ) : (
          <video
            ref={ref}
            muted
            playsInline
            loop
            autoPlay
            preload="metadata"
            poster={poster}
            width={104}
            height={104}
            aria-label={`${name}, thinking`}
          >
            <source src={`/avatars/${folder}/${folder}-thinking.webm`} type="video/webm" />
            <source src={`/avatars/${folder}/${folder}-thinking.mp4`} type="video/mp4" />
          </video>
        )}
        <figcaption>{name}</figcaption>
      </figure>
    </li>
  );
}

function TurnstileBox({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
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
      const turnstile = (
        window as Window & { turnstile?: { remove: (id: string) => void } }
      ).turnstile;
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
    </main>
  );
}

export function TryScreen(props: TryScreenProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState("");

  if (props.phase === "start") {
    return (
      <Frame phase="start">
        <p className="try-kicker">Sample</p>
        <h1 className="try-title">See a health score on sample figures.</h1>
        <p className="try-lead">
          One services business, in your market. No books to connect. The board stays marked SAMPLE.
        </p>
        <div className="try-card">
          <button type="button" className="try-cta" disabled={props.busy} onClick={props.onUseSample}>
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
          Your name, email, and a yes. Then the sample health score. Nothing is sent to an accountant.
        </p>
        <form
          className="try-card try-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmitGate?.({ name, email, consent, turnstileToken: token });
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
          {props.siteKey ? <TurnstileBox siteKey={props.siteKey} onToken={setToken} /> : null}
          <button type="submit" className="try-cta" disabled={props.busy || !props.siteKey}>
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
      {board ? <p className="try-lead">{board.blurb}</p> : null}
      <section className="try-card" aria-label="Health score">
        <div className="try-score-row">
          <div>
            <p className="try-score">{board?.health.score ?? "—"}</p>
            <p className="try-band" data-band={board?.health.label ?? ""}>
              {board?.health.label ?? ""}
            </p>
          </div>
          <span className="try-stamp">SAMPLE</span>
        </div>
        <ul className="try-pillars">
          {(board?.health.pillars ?? []).map((pillar) => (
            <li key={pillar.id}>
              <span>{pillar.label}</span>
              <span>
                {pillar.score == null ? "—" : Math.round(pillar.score)} · {pillar.status}
              </span>
            </li>
          ))}
        </ul>
        <ul className="try-ratios">
          {(board?.ratios ?? []).map((ratio) => (
            <li key={ratio.name}>
              <span>{ratio.name}</span>
              <span>{ratio.display}</span>
            </li>
          ))}
        </ul>
        {props.phase === "reveal" ? (
          <div style={{ marginTop: 16 }}>
            <button type="button" className="try-cta" disabled={props.busy} onClick={props.onShowFindings}>
              Show findings
            </button>
          </div>
        ) : null}
        {props.error && props.phase === "reveal" ? <p className="try-error">{props.error}</p> : null}
      </section>

      {props.phase === "findings" ? (
        <section className="try-card" aria-label="Findings" data-try-findings="true">
          <h2 className="try-kicker">Findings</h2>
          {props.findingsPending ? <p className="try-lead">Reading the sample figures.</p> : null}
          <ThinkingFaces />
          {props.findings && props.findings.length > 0 ? (
            <div className="try-findings">
              {props.findings.slice(0, 3).map((finding) => (
                <article className="try-finding" key={finding.title}>
                  <h3>{finding.title}</h3>
                  <p>{finding.detail}</p>
                </article>
              ))}
            </div>
          ) : null}
          <p className="try-disclaimer">{TRIAL_DISCLAIMER}</p>
          <div className="try-chips">
            <button
              type="button"
              className="try-chip"
              aria-pressed={props.chip === "profit"}
              onClick={() => props.onChip?.("profit")}
            >
              Profitability
            </button>
            <button
              type="button"
              className="try-chip"
              aria-pressed={props.chip === "cash"}
              onClick={() => props.onChip?.("cash")}
            >
              13-week cash
            </button>
            <button type="button" className="try-chip" disabled>
              Budget <span className="try-soon">Coming soon</span>
            </button>
            <button type="button" className="try-chip" disabled>
              Advisor pack <span className="try-soon">Coming soon</span>
            </button>
            <button type="button" className="try-chip" disabled>
              Reports <span className="try-soon">Coming soon</span>
            </button>
          </div>
          {props.chipPending ? <p className="try-muted">Working from the sample figures.</p> : null}
          {props.chip === "profit" && props.profit ? (
            <div data-try-chip="profit">
              <ul className="try-steps">
                {props.profit.steps.map((step) => (
                  <li key={step.label}>
                    <span>{step.label}</span>
                    <span>{step.display}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {props.chip === "cash" && props.cash ? (
            <div data-try-chip="cash">
              <p className="try-muted">
                Opens at {props.cash.openingDisplay}. Low point {props.cash.lowDisplay}. {props.cash.note}
              </p>
              <ul className="try-weeks">
                {props.cash.weeks.map((week) => (
                  <li key={week.week}>
                    <span>
                      Week {week.week} · {week.date}
                    </span>
                    <span>{week.closeDisplay}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {props.error ? <p className="try-error">{props.error}</p> : null}
          {props.runsLeft != null ? <p className="try-muted">Sample runs left: {props.runsLeft}</p> : null}
        </section>
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
  const chipFn = useServerFn(runTrialChip);
  const loadConfig = useServerFn(readTrialPublicConfig);
  const [phase, setPhase] = useState<TryPhase>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(() =>
    turnstileSiteKey(import.meta.env.VITE_TURNSTILE_SITE_KEY, import.meta.env.DEV),
  );
  const [board, setBoard] = useState<TrialBoard | null>(null);
  const [findings, setFindings] = useState<TrialFinding[]>([]);
  const [findingsPending, setFindingsPending] = useState(false);
  const [chip, setChip] = useState<ChipId>(null);
  const [chipPending, setChipPending] = useState(false);
  const [profit, setProfit] = useState<TrialProfit | null>(null);
  const [cash, setCash] = useState<TrialCash | null>(null);
  const [runsLeft, setRunsLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((config) => {
      if (!cancelled && config.siteKey) setSiteKey(config.siteKey);
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
      board={board}
      findings={findings}
      findingsPending={findingsPending}
      chip={chip}
      chipPending={chipPending}
      profit={profit}
      cash={cash}
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
            setRunsLeft(result.runsLeft);
          })
          .catch(() => setError("The sample isn't available right now."))
          .finally(() => setFindingsPending(false));
      }}
      onChip={(next) => {
        setChip(next);
        setChipPending(true);
        setError(null);
        void chipFn({ data: { chip: next } })
          .then((result) => {
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setRunsLeft(result.runsLeft);
            if (result.chip === "profit") setProfit(result.profit);
            if (result.chip === "cash") setCash(result.cash);
          })
          .catch(() => setError("The sample isn't available right now."))
          .finally(() => setChipPending(false));
      }}
    />
  );
}
