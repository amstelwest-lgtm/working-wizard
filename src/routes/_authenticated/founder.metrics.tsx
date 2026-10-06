/**
 * Founder validated-learning instrument. Platform owner only — not Milōn IT.
 * Glance first: one window, one funnel, one next call.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { BackLink } from "@/components/back-link";
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
  buildGlance,
  cohortRowsForDisplay,
  compactHypothesisLabels,
  dedupePracticeCalls,
  nextCallCopy,
  pickNextCall,
} from "@/lib/metrics/glance";
import { HYPOTHESIS_PLAIN, formatValue, stallTitle, stallWho, stallWhy } from "@/lib/metrics/instrument-view";
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
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [experimentsOpen, setExperimentsOpen] = useState(false);

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

  const exclusion = useMemo(
    () => ({ internalEmails: bundle?.internalEmails ?? [] }),
    [bundle],
  );
  const glance = useMemo(() => {
    if (!bundle) return null;
    const loop = (bundle.loop ?? []).reduce(
      (acc, row) => ({
        assigned: acc.assigned + Number(row.tasks_assigned || 0),
        completed: acc.completed + Number(row.completed || 0),
      }),
      { assigned: 0, completed: 0 },
    );
    return buildGlance({
      activation: bundle.activation,
      loop,
      brain: bundle.brain,
      contacted: bundle.conversations?.contacted ?? 0,
      replied: bundle.conversations?.replied ?? 0,
      signups7d: bundle.signups7d,
      revenueLabel: bundle.revenueLabel,
      reviewInbox: bundle.review?.inbox ?? 0,
      reviewDueNow: bundle.review?.dueNow ?? 0,
    });
  }, [bundle]);
  const calls = useMemo(
    () =>
      dedupePracticeCalls(bundle?.queue ?? [], bundle?.commitment ?? [], exclusion),
    [bundle, exclusion],
  );
  const nextCard = pickNextCall(calls, exclusion);
  const next = nextCallCopy(nextCard);
  const hypotheses = compactHypothesisLabels(
    (bundle?.instrument.hypotheses ?? []).map((card) => ({
      id: card.id,
      status: card.status,
      title: HYPOTHESIS_PLAIN[card.id]?.title ?? card.id,
    })),
    glance?.reports.n ?? 0,
  );
  const cohorts = cohortRowsForDisplay(bundle?.activation ?? []);

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
        <BackLink to="/ops" className="mt-4">
          Back to Lighthouse
        </BackLink>
      </div>
    );
  }

  return (
    <div className="milon-ops founder-metrics">
      <div className="ops-glow" />
      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ops-line)] pb-4">
          <div>
            <p className="fm-kicker">Founder only · what people actually did</p>
            <h1 className="fm-title mt-1">This week</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <BackLink
              to="/ops"
              className="h-9 rounded-full border border-[var(--ops-line-strong)] px-3 uppercase tracking-wider text-[var(--ops-ink-soft)]"
            >
              Back to Lighthouse
            </BackLink>
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

        {glance ? (
          <section className="fm-glance mb-6">
            <article className="ops-panel fm-span p-4">
              <p className="fm-kicker">Rolling 14 days</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ops-ink)]">
                Practices that sent a real report
              </p>
              <p
                className={`fm-number mt-2 ${
                  glance.reports.n < 5 ? "text-[var(--ops-ink)]" : `fm-traffic-${glance.reports.traffic}`
                }`}
              >
                {glance.reports.valueLabel}
              </p>
              <p className="mt-2 text-xs text-[var(--ops-ink-dim)]">{glance.reports.verdict}</p>
            </article>

            <article className="ops-panel fm-span p-4">
              <p className="fm-kicker">Activation · {glance.funnelWindowLabel}</p>
              <div className="fm-funnel mt-3">
                {glance.funnel.map((step) => (
                  <div key={step.key}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ops-ink-dim)]">
                      {step.label}
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--ops-ink)]">{step.count}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="ops-panel p-4">
              <p className="fm-kicker">Outbound</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ops-ink)]">Contacted → replied</p>
              <p className="fm-number mt-2 text-[1.8rem] text-[var(--ops-ink)]">
                {glance.outbound.contacted}
                <span className="text-base font-medium text-[var(--ops-ink-dim)]">
                  {" "}
                  → {glance.outbound.replied}
                </span>
              </p>
              <p className="mt-2 text-xs text-[var(--ops-ink-dim)]">
                Reply rate {glance.outbound.replyRateLabel}
              </p>
            </article>

            <article className="ops-panel p-4">
              <p className="fm-kicker">New signups · 7d</p>
              <p className="fm-number mt-2 text-[var(--ops-ink)]">{glance.signupsLabel}</p>
            </article>

            <article className="ops-panel p-4">
              <p className="fm-kicker">Received this month</p>
              <p className="fm-number mt-2 text-[1.8rem] text-[var(--ops-ink)]">{glance.revenueLabel}</p>
            </article>

            <a href={glance.review.href} className="ops-panel block p-4 hover:border-[var(--ops-amber-border)]">
              <p className="fm-kicker">Review inbox</p>
              <p className="fm-number mt-2 text-[var(--ops-ink)]">{glance.review.inbox}</p>
              <p className="mt-2 text-xs text-[var(--ops-ink-dim)]">{glance.review.dueNow} due now</p>
            </a>
          </section>
        ) : null}

        <section className="ops-panel fm-now mb-4 p-5">
          <p className="fm-kicker">Do this next</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--ops-ink)]">{next.title}</h2>
          <p className="mt-1 text-sm text-[var(--ops-ink-soft)]">{next.body}</p>
          {next.question ? <p className="mt-3 text-sm text-[var(--ops-ink)]">Ask: {next.question}</p> : null}
          {glance && glance.review.inbox + glance.review.dueNow > 0 ? (
            <Link
              to="/ops"
              search={{ tab: "agent" }}
              className="mt-4 inline-flex h-9 items-center rounded-full border border-[var(--ops-line-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--ops-ink-soft)]"
            >
              Clear review inbox
            </Link>
          ) : null}
        </section>

        <section className="mb-8">
          <h2 className="fm-section">Practices to call</h2>
          {calls.length ? (
            <div className="space-y-3">
              {calls.map((card) => (
                <article key={card.key} className="ops-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`fm-pill ${card.severity === "high" ? "fm-pill-bad" : ""}`}>
                      {card.severity}
                    </span>
                    <span className="fm-who">{stallWho(card.stallType)}</span>
                    {card.founding ? <span className="fm-pill">Founding</span> : null}
                  </div>
                  <p className="mt-2 text-base font-semibold text-[var(--ops-ink)]">{card.name}</p>
                  <p className="text-sm text-[var(--ops-ink)]">Furthest: {card.furthestLabel}</p>
                  <p className="text-sm text-[var(--ops-ink-soft)]">{stallTitle(card.stallType)}</p>
                  <p className="mt-1 text-[11px] text-[var(--ops-ink-dim)]">{stallWhy(card.stallType)}</p>
                  {card.question ? (
                    <p className="mt-3 text-sm text-[var(--ops-ink)]">Ask: {card.question}</p>
                  ) : null}
                  <textarea
                    className="ops-input mt-3"
                    rows={2}
                    placeholder="What they actually did last time — not whether they liked it"
                    value={notes[card.key] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [card.key]: e.target.value }))}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["contacted", "answered", "dismissed"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className="rounded-full border border-[var(--ops-line-strong)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ops-ink-soft)]"
                        onClick={() =>
                          void Promise.all(
                            card.queueIds.map((id) =>
                              updateQueue({
                                data: { id, status, outcomeNotes: notes[card.key] },
                              }),
                            ),
                          )
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
            <p className="text-sm text-[var(--ops-ink-dim)]">No open stalls on real practices.</p>
          )}
        </section>

        <section className="ops-panel mb-8 p-4">
          <h2 className="fm-section">Hypotheses</h2>
          <div className="fm-hyp">
            {hypotheses.map((item) => (
              <p key={item.id} className="text-sm text-[var(--ops-ink)]" title={item.title}>
                <span className="fm-who">{item.id}</span> {item.label}
              </p>
            ))}
          </div>
        </section>

        {cohorts.length ? (
          <section className="mb-8">
            <h2 className="fm-section">Cohorts · n at least 5</h2>
            <div className="ops-panel overflow-x-auto p-2">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th>Signup week</th>
                    <th>n</th>
                    <th>Activation 14d</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map((row) => (
                    <tr key={String(row.cohort_week)}>
                      <td>{String(row.cohort_week).slice(0, 10)}</td>
                      <td>{row.practices}</td>
                      <td>{formatValue(row.activation_14d_pct, "percent")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

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

        <details
          className="mb-12"
          onToggle={(event) => setExperimentsOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="fm-section cursor-pointer">Experiments</summary>
          {experimentsOpen ? (
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
          ) : null}
        </details>

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
    <section id="conversation-signal" className="mb-8 scroll-mt-24">
      <p className="fm-kicker">Log a conversation signal</p>
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
    <div className="mt-4">
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
    </div>
  );
}
