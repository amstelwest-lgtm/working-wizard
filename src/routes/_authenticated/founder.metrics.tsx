/**
 * Founder validated-learning instrument. Platform owner only — not Milōn IT.
 * Order: what to do → the number → five readings → calls → loop + activation
 * → commitment → conversations → hypotheses → signals → experiments.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, RefreshCw, Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  createExperiment,
  decideExperiment,
  getFounderInstrument,
  logCustomerSignal,
  refreshAnalyticsDerived,
  sendMetricsDigest,
  updateFounderQueueItem,
} from "@/lib/metrics.functions";
import { METRICS, PIVOT_TYPES, SITUATION_MIN_CHARS } from "@/lib/metrics/definitions";
import {
  HYPOTHESIS_PLAIN,
  MOVEMENT_INVENTORY,
  buildActivationPath,
  buildFunnel,
  buildNextMove,
  buildScorecard,
  formatValue,
  headlineTitle,
  latestUnaffiliatedActivation,
  mapCommitment,
  pickLoopReading,
  readingsFromBundle,
  stallTitle,
  stallWho,
  stallWhy,
  trafficWord,
  worstPlain,
} from "@/lib/metrics/instrument-view";
import { ThemeToggle } from "@/components/theme-toggle";
import "@/styles/ops-console.css";
import "@/styles/founder-metrics.css";

export const Route = createFileRoute("/_authenticated/founder/metrics")({
  component: FounderMetricsPage,
  head: () => ({
    meta: [{ title: "Founder instrument — Milōn" }],
  }),
});

type Bundle = Awaited<ReturnType<typeof getFounderInstrument>>;

function cellClass(value: number | null | undefined, healthy: number, watch: number): string {
  if (value == null) return "";
  if (value >= healthy) return "fm-traffic-healthy";
  if (value >= watch) return "fm-traffic-watch";
  return "fm-traffic-bad";
}

function FounderMetricsPage() {
  const { user, loading: authLoading } = useAuth();
  const load = useServerFn(getFounderInstrument);
  const refresh = useServerFn(refreshAnalyticsDerived);
  const updateQueue = useServerFn(updateFounderQueueItem);
  const logSignal = useServerFn(logCustomerSignal);
  const addExperiment = useServerFn(createExperiment);
  const closeExperiment = useServerFn(decideExperiment);
  const sendDigest = useServerFn(sendMetricsDigest);

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const reload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      setBundle(await load());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the instrument.");
      setBundle(null);
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    if (!authLoading && user) void reload();
  }, [authLoading, user, reload]);

  const instrument = bundle?.instrument;
  const readings = useMemo(
    () =>
      bundle
        ? readingsFromBundle({
            activation: bundle.activation,
            loop: bundle.loop,
            adoption: bundle.adoption,
            expansion: bundle.expansion,
            retention: bundle.retention,
            queue: bundle.queue,
          })
        : null,
    [bundle],
  );
  const scorecard = readings ? buildScorecard(readings) : [];
  const funnel = instrument ? buildFunnel(instrument.loopTotals) : [];
  const loopReading = instrument
    ? pickLoopReading(instrument.loopTotals, readings?.adoptionPct ?? null)
    : null;
  const activationPath = buildActivationPath(
    readings?.activationRow ?? latestUnaffiliatedActivation(bundle?.activation ?? []),
  );
  const next = instrument ? buildNextMove(bundle?.queue ?? [], instrument) : null;
  const commitment = mapCommitment(bundle?.commitment ?? []);
  const conversations = bundle?.conversations;

  const activationRows = useMemo(
    () =>
      [...(bundle?.activation ?? [])].sort(
        (a, b) => Date.parse(String(b.cohort_week)) - Date.parse(String(a.cohort_week)),
      ),
    [bundle],
  );
  const loopRows = useMemo(
    () =>
      [...(bundle?.loop ?? [])].sort(
        (a, b) => Date.parse(String(b.cohort_week)) - Date.parse(String(a.cohort_week)),
      ),
    [bundle],
  );

  if (authLoading || (user && !bundle && !err)) {
    return (
      <div className="milon-ops founder-metrics grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--ops-amber)]" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="milon-ops founder-metrics min-h-screen px-6 py-10">
        <p className="text-sm text-[var(--ops-danger-ink)]">{err}</p>
        <p className="mt-3 text-xs text-[var(--ops-ink-dim)]">
          If you already pasted SQL 3–6, you only need SQL 7 from <code>docs/metrics/README.md</code>{" "}
          (<code>analytics_founder_bundle</code>). The tables are in the <code>analytics</code> schema,
          which the API cannot read directly.
        </p>
        <Link to="/ops" className="mt-4 inline-block text-xs uppercase tracking-wider text-[var(--ops-amber)]">
          Back to Lighthouse
        </Link>
      </div>
    );
  }

  const headline = instrument?.headline;

  return (
    <div className="milon-ops founder-metrics">
      <div className="ops-glow" />
      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ops-line)] pb-4">
          <div>
            <p className="fm-kicker">Founder only · what people actually did</p>
            <h1 className="fm-title mt-1">This week&apos;s learning</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <Link
              to="/ops"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Lighthouse
            </Link>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)]"
              onClick={() =>
                void refresh()
                  .then(() => reload())
                  .catch((e) => toast.error(String(e)))
              }
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-amber-500/40 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-amber)]"
              onClick={() =>
                void sendDigest()
                  .then((r) =>
                    toast.success(r.sent.ok ? `Digest sent to ${r.recipients.length}` : r.sent.error),
                  )
                  .catch((e) => toast.error(String(e)))
              }
            >
              <Send className="h-3.5 w-3.5" /> Send digest
            </button>
          </div>
        </header>

        {next && (
          <section className="ops-panel fm-now mb-6 p-5">
            <p className="fm-kicker">Do this next</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--ops-ink)]">{next.title}</h2>
            <p className="mt-1 text-sm text-[var(--ops-ink-soft)]">{next.body}</p>
            {next.question ? (
              <p className="mt-3 text-sm text-[var(--ops-ink)]">Ask: {next.question}</p>
            ) : null}
          </section>
        )}

        <section className="ops-panel mb-6 p-5">
          <p className="fm-kicker">{trafficWord(headline?.traffic ?? "empty")}</p>
          <p className="mt-2 text-lg font-semibold text-[var(--ops-ink)]">
            {headline ? headlineTitle(headline) : "No closed cohort yet"}
          </p>
          <p
            className={`fm-number mt-3 ${headline ? `fm-traffic-${headline.traffic}` : "fm-traffic-empty"}`}
          >
            {headline?.value == null
              ? "—"
              : `${headline.value}${headline.unit === "percent" ? "%" : ""}`}
          </p>
          <p className="mt-2 text-sm text-[var(--ops-ink-soft)]">{headline?.question}</p>
          <p className="mt-1 text-xs text-[var(--ops-ink-dim)]">{headline?.cohortLabel}</p>
          {instrument?.worstLine ? (
            <p className="mt-4 text-sm text-[var(--ops-ink)]">
              Weakest line: {worstPlain(instrument.worstLine)}
            </p>
          ) : null}
        </section>

        <section className="mb-8">
          <h2 className="fm-section">Five readings · accountant vs owner</h2>
          <div className="fm-score">
            {scorecard.map((item) => (
              <article key={item.key} className="ops-panel">
                <p className="fm-who">{item.who}</p>
                <p className="mt-1 text-sm font-semibold text-[var(--ops-ink)]">{item.shortLabel}</p>
                <p className={`fm-score-val mt-2 fm-traffic-${item.traffic}`}>
                  {formatValue(item.value, item.unit)}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--ops-ink-dim)]">{item.meaning}</p>
                <p className="mt-1 text-[10px] text-[var(--ops-ink-faint)]">
                  Need {item.healthy}
                  {item.unit === "percent" ? "%" : ""}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="fm-section">Call these people</h2>
          {bundle?.queue.length ? (
            <div className="space-y-3">
              {bundle.queue.map((q) => (
                <article key={q.id} className="ops-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`fm-pill ${q.severity === "high" ? "fm-pill-bad" : ""}`}>
                      {q.severity}
                    </span>
                    <span className="fm-who">{stallWho(q.stall_type)}</span>
                    {q.is_founding_practice ? <span className="fm-pill">Founding</span> : null}
                  </div>
                  <p className="mt-2 text-base font-semibold text-[var(--ops-ink)]">
                    {q.practice_name || "Unnamed practice"}
                  </p>
                  <p className="text-sm text-[var(--ops-ink-soft)]">{stallTitle(q.stall_type)}</p>
                  <p className="mt-1 text-[11px] text-[var(--ops-ink-dim)]">{stallWhy(q.stall_type)}</p>
                  <p className="mt-3 text-sm text-[var(--ops-ink)]">Ask: {q.suggested_question}</p>
                  <textarea
                    className="ops-input mt-3"
                    rows={2}
                    placeholder="What they actually did last time — not whether they liked it"
                    value={notes[q.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [q.id]: e.target.value }))}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["contacted", "answered", "dismissed"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className="rounded-full border border-[var(--ops-line-strong)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-ink-soft)]"
                        onClick={() =>
                          void updateQueue({
                            data: { id: q.id, status, outcomeNotes: notes[q.id] },
                          })
                            .then(() => reload())
                            .catch((e) => toast.error(String(e)))
                        }
                      >
                        {status === "contacted"
                          ? "Called"
                          : status === "answered"
                            ? "Got an answer"
                            : "Not useful"}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--ops-ink-dim)]">
              No open stalls. That is not a win if the funnel is empty — refresh after SQL 4.
            </p>
          )}
        </section>

        <section className="mb-8 grid gap-4 lg:grid-cols-2">
          <div className="ops-panel p-4">
            <h2 className="fm-section">The loop</h2>
            <p className="mb-4 text-xs text-[var(--ops-ink-dim)]">
              Accountant assigns. Owner or staff must finish. GET on a magic link is not engagement.
            </p>
            <div className="space-y-3">
              {funnel.map((step) => (
                <div key={step.key}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium text-[var(--ops-ink)]">{step.label}</span>
                    <span className="text-[var(--ops-ink-dim)]">
                      {step.count} · {step.who}
                    </span>
                  </div>
                  <div className={`fm-bar ${step.key === "completed" ? "is-ok" : ""}`}>
                    <span style={{ width: `${Math.max(4, Math.min(100, step.pctOfFirst))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {loopReading ? (
              <p className="mt-4 text-sm text-[var(--ops-ink)]">
                {loopReading.reading}. {loopReading.meaning}
              </p>
            ) : instrument?.loopTotals.assigned ? (
              <p className="mt-4 text-sm text-[var(--ops-ink-dim)]">
                Not enough drop-off to call a reading yet.
              </p>
            ) : (
              <p className="mt-4 text-sm text-[var(--ops-ink-dim)]">
                No tasks assigned yet. The loop cannot be proven — high assignment + low completion
                is theatre.
              </p>
            )}
          </div>
          <div className="ops-panel p-4">
            <h2 className="fm-section">How a practice activates</h2>
            <p className="mb-4 text-xs text-[var(--ops-ink-dim)]">
              Latest unaffiliated signup week. Each bar is a share of those practices.
            </p>
            {activationPath.length ? (
              <div className="space-y-3">
                {activationPath.map((step) => {
                  const pct = step.of ? Math.round((step.count / step.of) * 100) : 0;
                  return (
                    <div key={step.key}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium text-[var(--ops-ink)]">{step.label}</span>
                        <span className="text-[var(--ops-ink-dim)]">
                          {step.count} of {step.of}
                        </span>
                      </div>
                      <div className="fm-bar">
                        <span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--ops-ink-dim)]">No unaffiliated activation cohort yet.</p>
            )}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="fm-section">How far each practice has gone</h2>
          {commitment.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {commitment.map((c) => (
                <article
                  key={c.practiceId}
                  className={`ops-panel p-3 ${c.founding ? "fm-founding" : ""}`}
                >
                  <p className="text-sm font-semibold text-[var(--ops-ink)]">{c.name}</p>
                  <p className="mt-0.5 text-xs text-[var(--ops-ink-soft)]">{c.rungLabel}</p>
                  <p className="mt-1 text-[11px] text-[var(--ops-ink-dim)]">{c.note}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--ops-ink-dim)]">
              Commitment ladder is empty until you refresh a snapshot.
            </p>
          )}
        </section>

        <section className="mb-8">
          <h2 className="fm-section">Conversations · Lighthouse</h2>
          <p className="mb-3 text-xs text-[var(--ops-ink-dim)]">
            Mom Test lives in replies, not in compliments. These numbers are from outbound — they
            do not move the headline.
          </p>
          {conversations?.available ? (
            <div className="fm-score">
              {(
                [
                  ["Sourced", conversations.sourced],
                  ["Contacted", conversations.contacted],
                  ["Replied", conversations.replied],
                  ["Met", conversations.meeting],
                  ["Trial", conversations.trial],
                  ["Won", conversations.won],
                ] as const
              ).map(([label, n]) => (
                <article key={label} className="ops-panel">
                  <p className="fm-who">Prospect</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ops-ink)]">{label}</p>
                  <p className="fm-score-val mt-2">{n}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--ops-ink-dim)]">Lighthouse lead table is not readable here.</p>
          )}
          {conversations?.replyRatePct != null ? (
            <p className="mt-3 text-sm text-[var(--ops-ink-soft)]">
              Reply rate {conversations.replyRatePct}% of contacted. A reply is a conversation. A
              send is not.
            </p>
          ) : null}
        </section>

        <section className="mb-8">
          <h2 className="fm-section">Cohorts</h2>
          <p className="mb-3 text-xs text-[var(--ops-ink-dim)]">
            Gold bar = founding practice. Never blended into the headline.
          </p>
          <div className="ops-panel mb-4 overflow-x-auto p-2">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th>Signup week</th>
                  <th>Split</th>
                  <th>n</th>
                  <th>Activation 14d</th>
                </tr>
              </thead>
              <tbody>
                {activationRows.map((row) => (
                  <tr
                    key={`${row.cohort_week}-${row.is_founding_practice}`}
                    className={row.is_founding_practice ? "fm-founding" : ""}
                  >
                    <td>{String(row.cohort_week).slice(0, 10)}</td>
                    <td>{row.is_founding_practice ? "Founding" : "Unaffiliated"}</td>
                    <td>{row.practices}</td>
                    <td
                      className={cellClass(
                        row.activation_14d_pct,
                        METRICS.ACTIVATION_RATE.healthy,
                        METRICS.ACTIVATION_RATE.watch,
                      )}
                    >
                      {formatValue(row.activation_14d_pct, "percent")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ops-panel overflow-x-auto p-2">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th>Assign week</th>
                  <th>Assigned</th>
                  <th>Emailed</th>
                  <th>Opened</th>
                  <th>Done 14d</th>
                </tr>
              </thead>
              <tbody>
                {loopRows.map((row) => (
                  <tr key={row.cohort_week}>
                    <td>{String(row.cohort_week).slice(0, 10)}</td>
                    <td>{row.tasks_assigned}</td>
                    <td>{row.emails_dispatched}</td>
                    <td>{row.links_engaged_by_human}</td>
                    <td
                      className={cellClass(
                        row.completion_14d_pct,
                        METRICS.LOOP_COMPLETION_RATE.healthy,
                        METRICS.LOOP_COMPLETION_RATE.watch,
                      )}
                    >
                      {formatValue(row.completion_14d_pct, "percent")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="fm-section">Hypotheses</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {(instrument?.hypotheses ?? []).map((h) => {
              const plain = HYPOTHESIS_PLAIN[h.id];
              return (
                <article
                  key={h.id}
                  className={`ops-panel p-4 ${h.status === "blocked" ? "fm-status-blocked" : ""}`}
                >
                  <p className="fm-who">
                    {h.id} · {h.status}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ops-ink)]">
                    {plain?.title ?? h.id}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ops-ink-soft)]">
                    {plain?.inOneLine ?? h.statement}
                  </p>
                  {h.blockedReason ? (
                    <p className="mt-2 text-xs text-[var(--ops-danger-ink)]">{h.blockedReason}</p>
                  ) : (
                    <ul className="mt-2 list-disc pl-4 text-xs text-[var(--ops-ink-dim)]">
                      {h.evidence.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="fm-section">What we watch — and what we still cannot</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <article className="ops-panel p-4">
              <p className="text-sm font-semibold text-[var(--ops-ink)]">In the number</p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--ops-ink-soft)]">
                {MOVEMENT_INVENTORY.shown.map((row) => (
                  <li key={row.event}>
                    <span className="fm-who">{row.who}</span> — {row.means}
                  </li>
                ))}
              </ul>
            </article>
            <article className="ops-panel p-4">
              <p className="text-sm font-semibold text-[var(--ops-ink)]">Tracked, not the headline</p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--ops-ink-soft)]">
                {MOVEMENT_INVENTORY.trackedHidden.map((row) => (
                  <li key={row.event}>
                    <span className="fm-who">{row.who}</span> — {row.means}
                  </li>
                ))}
              </ul>
            </article>
            <article className="ops-panel p-4">
              <p className="text-sm font-semibold text-[var(--ops-ink)]">Conversations</p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--ops-ink-soft)]">
                {MOVEMENT_INVENTORY.conversations.map((row) => (
                  <li key={row.event}>{row.means}</li>
                ))}
              </ul>
            </article>
            <article className="ops-panel p-4">
              <p className="text-sm font-semibold text-[var(--ops-ink)]">Still missing</p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--ops-ink-soft)]">
                {MOVEMENT_INVENTORY.missing.map((row) => (
                  <li key={row.event}>{row.means}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <SignalForm
          onSave={(data) =>
            logSignal({ data })
              .then(() => {
                toast.success("Signal saved");
                return reload();
              })
              .catch((e) => toast.error(String(e)))
          }
          rows={bundle?.signals ?? []}
        />

        <ExperimentForm
          rows={bundle?.experiments ?? []}
          onCreate={(data) =>
            addExperiment({ data })
              .then(() => {
                toast.success("Prediction locked");
                return reload();
              })
              .catch((e) => toast.error(String(e)))
          }
          onDecide={(data) =>
            closeExperiment({ data })
              .then(() => reload())
              .catch((e) => toast.error(String(e)))
          }
        />
      </div>
    </div>
  );
}

function SignalForm({
  onSave,
  rows,
}: {
  onSave: (data: {
    source: string;
    situation: string;
    literalAsk?: string;
    hypothesisId?: "H1" | "H2" | "H3" | "H4" | "H5";
  }) => void;
  rows: Array<{
    id: number;
    captured_at: string;
    source: string;
    situation: string;
    literal_ask?: string | null;
    hypothesis_id?: string | null;
  }>;
}) {
  const [situation, setSituation] = useState("");
  const [ask, setAsk] = useState("");
  const [source, setSource] = useState("call");
  const [hypothesis, setHypothesis] = useState<"H1" | "H2" | "H3" | "H4" | "H5" | "">("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (situation.trim().length < SITUATION_MIN_CHARS) {
      toast.error(`Write what they actually do today — more than ${SITUATION_MIN_CHARS - 1} characters.`);
      return;
    }
    onSave({
      source,
      situation: situation.trim(),
      literalAsk: ask.trim() || undefined,
      hypothesisId: hypothesis || undefined,
    });
    setSituation("");
    setAsk("");
  }

  return (
    <section className="mb-8">
      <h2 className="fm-section">Signals from conversations</h2>
      <form className="ops-panel mb-4 space-y-3 p-4" onSubmit={submit}>
        <p className="text-xs text-[var(--ops-ink-dim)]">
          Situation is required — what they did last time. Compliments do not count.
        </p>
        <textarea
          className="ops-input"
          rows={3}
          required
          minLength={SITUATION_MIN_CHARS}
          placeholder="Walk me through the last time you… (what they did, not whether they liked it)"
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
        />
        <input
          className="ops-input"
          placeholder="The ask they said out loud (optional)"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <select className="ops-input max-w-[10rem]" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="call">Call</option>
            <option value="lighthouse">Lighthouse reply</option>
            <option value="meeting">Meeting</option>
            <option value="email">Email</option>
          </select>
          <select
            className="ops-input max-w-[8rem]"
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value as typeof hypothesis)}
          >
            <option value="">Hypothesis</option>
            {(["H1", "H2", "H3", "H4", "H5"] as const).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full border border-amber-500/40 px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)]"
          >
            Log
          </button>
        </div>
      </form>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="ops-panel p-3 text-sm text-[var(--ops-ink-soft)]">
            <p className="text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">
              {row.source} · {String(row.captured_at).slice(0, 10)} · {row.hypothesis_id ?? "—"}
            </p>
            <p className="mt-1">{row.situation}</p>
            {row.literal_ask ? (
              <p className="mt-1 text-xs text-[var(--ops-ink-dim)]">Ask: {row.literal_ask}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExperimentForm({
  rows,
  onCreate,
  onDecide,
}: {
  rows: Array<{
    id: number;
    name: string;
    hypothesis_id: string;
    prediction: string;
    success_metric: string;
    success_threshold: number;
    result?: string | null;
    decision?: string | null;
  }>;
  onCreate: (data: {
    name: string;
    hypothesisId: "H1" | "H2" | "H3" | "H4" | "H5";
    prediction: string;
    successMetric: string;
    successThreshold: number;
  }) => void;
  onDecide: (data: {
    id: number;
    decision: "persevere" | "pivot" | "inconclusive" | "abandoned";
    result: string;
    pivotType?: (typeof PIVOT_TYPES)[number];
  }) => void;
}) {
  const [name, setName] = useState("");
  const [prediction, setPrediction] = useState("");
  const [metric, setMetric] = useState("ACTIVATION_RATE");
  const [threshold, setThreshold] = useState("40");
  const [hypothesis, setHypothesis] = useState<"H1" | "H2" | "H3" | "H4" | "H5">("H2");
  const [pivot, setPivot] = useState<(typeof PIVOT_TYPES)[number]>("channel");
  const [resultById, setResultById] = useState<Record<number, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    if (prediction.trim().length < 9) {
      toast.error("Write the prediction before you start. A result without a bet is rationalisation.");
      return;
    }
    onCreate({
      name: name.trim(),
      hypothesisId: hypothesis,
      prediction: prediction.trim(),
      successMetric: metric.trim(),
      successThreshold: Number(threshold),
    });
    setName("");
    setPrediction("");
  }

  return (
    <section className="mb-12">
      <h2 className="fm-section">Experiments</h2>
      <form className="ops-panel mb-4 space-y-3 p-4" onSubmit={submit}>
        <input
          className="ops-input"
          required
          placeholder="What you are changing"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="ops-input"
          required
          minLength={9}
          rows={3}
          placeholder="Prediction — write this before any result"
          value={prediction}
          onChange={(e) => setPrediction(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <select
            className="ops-input max-w-[6rem]"
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value as typeof hypothesis)}
          >
            {(["H1", "H2", "H3", "H4", "H5"] as const).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <select className="ops-input max-w-[14rem]" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {Object.keys(METRICS).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <input
            className="ops-input max-w-[6rem]"
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-full border border-amber-500/40 px-4 text-xs font-bold uppercase tracking-wider text-[var(--ops-amber)]"
          >
            Lock prediction
          </button>
        </div>
      </form>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="ops-panel p-4">
            <p className="fm-who">
              {row.hypothesis_id} · {row.decision ?? "running"}
            </p>
            <p className="mt-1 font-medium text-[var(--ops-ink)]">{row.name}</p>
            <p className="mt-1 text-sm text-[var(--ops-ink-soft)]">Bet: {row.prediction}</p>
            <p className="mt-1 text-xs text-[var(--ops-ink-dim)]">
              Win if {row.success_metric} ≥ {row.success_threshold}
            </p>
            {row.decision ? (
              <p className="mt-2 text-sm">{row.result}</p>
            ) : (
              <div className="mt-3 space-y-2">
                <textarea
                  className="ops-input"
                  rows={2}
                  placeholder="What happened (after the prediction was written)"
                  value={resultById[row.id] ?? ""}
                  onChange={(e) => setResultById((m) => ({ ...m, [row.id]: e.target.value }))}
                />
                <select
                  className="ops-input max-w-[12rem]"
                  value={pivot}
                  onChange={(e) => setPivot(e.target.value as typeof pivot)}
                >
                  {PIVOT_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  {(["persevere", "pivot", "inconclusive", "abandoned"] as const).map((decision) => (
                    <button
                      key={decision}
                      type="button"
                      className="rounded-full border border-[var(--ops-line-strong)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
                      onClick={() => {
                        const result = (resultById[row.id] ?? "").trim();
                        if (result.length < 3) {
                          toast.error("Write the result before deciding.");
                          return;
                        }
                        if (decision === "pivot") {
                          onDecide({ id: row.id, decision, result, pivotType: pivot });
                          return;
                        }
                        onDecide({ id: row.id, decision, result });
                      }}
                    >
                      {decision}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
