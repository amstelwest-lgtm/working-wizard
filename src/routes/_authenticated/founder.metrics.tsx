/**
 * Founder validated-learning instrument. Platform owner only — not Milōn IT.
 * Order is the priority: one number → call list → loop → cohorts → hypotheses → signals → experiments.
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
import { LOOP_INTERPRETATION, METRICS, PIVOT_TYPES, SITUATION_MIN_CHARS } from "@/lib/metrics/definitions";
import { ThemeToggle } from "@/components/theme-toggle";
import "@/styles/ops-console.css";
import "@/styles/founder-metrics.css";

export const Route = createFileRoute("/_authenticated/founder/metrics")({
  component: FounderMetricsPage,
  head: () => ({
    meta: [{ title: "Founder instrument — Milōn" }],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap",
      },
    ],
  }),
});

type Bundle = Awaited<ReturnType<typeof getFounderInstrument>>;

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n)}%`;
}

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

  const headline = bundle?.instrument.headline;
  const hypotheses = bundle?.instrument.hypotheses ?? [];

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

  return (
    <div className="milon-ops founder-metrics">
      <div className="ops-glow" />
      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ops-line)] pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--ops-amber)]">
              Founder only · validated learning
            </p>
            <h1 className="fm-display mt-1 text-4xl text-[var(--ops-ink)]">The number</h1>
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
                void refresh().then(() => reload()).catch((e) => toast.error(String(e)))
              }
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Snapshot
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

        <section className="ops-panel mb-8 p-6">
          <p className="max-w-2xl font-serif text-xl text-[var(--ops-ink)]">{headline?.question}</p>
          <p
            className={`fm-number mt-4 ${headline ? `fm-traffic-${headline.traffic}` : "fm-traffic-empty"}`}
          >
            {headline?.value == null
              ? "—"
              : `${headline.value}${headline.unit === "percent" ? "%" : ""}`}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--ops-ink-dim)]">
            {headline?.cohortLabel}
            {headline?.isFounding ? " · founding (not a headline)" : ""}
          </p>
          <p className="mt-4 max-w-2xl text-sm text-[var(--ops-danger-ink)]">
            If bad: {headline?.decisionIfBad}
          </p>
          <p className="mt-3 text-sm font-medium text-[var(--ops-ink)]">
            {bundle?.instrument.worstLine}
          </p>
        </section>

        <section className="mb-8">
          <h2 className="fm-display mb-3 text-2xl text-[var(--ops-ink)]">Call list</h2>
          {bundle?.queue.length ? (
            <div className="space-y-3">
              {bundle.queue.map((q) => (
                <article key={q.id} className="ops-panel p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ops-amber)]">
                    {q.severity} · {q.stall_type}
                    {q.is_founding_practice ? " · founding" : ""}
                  </p>
                  <p className="mt-1 font-medium text-[var(--ops-ink)]">{q.practice_name || "Unnamed practice"}</p>
                  <p className="mt-2 font-serif text-lg text-[var(--ops-ink)]">{q.suggested_question}</p>
                  <textarea
                    className="ops-input mt-3"
                    rows={2}
                    placeholder="What they actually did (not whether they liked it)"
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
                        {status}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--ops-ink-dim)]">
              No open stalls. That is not a win if the funnel is empty — run Snapshot after SQL 4.
            </p>
          )}
        </section>

        <section className="mb-8 grid gap-4 lg:grid-cols-2">
          <div className="ops-panel p-4">
            <h2 className="fm-display mb-3 text-2xl text-[var(--ops-ink)]">Loop funnel</h2>
            <ol className="space-y-1 text-sm text-[var(--ops-ink-soft)]">
              <li>Assigned {bundle?.instrument.loopTotals.assigned ?? 0}</li>
              <li>Dispatched {bundle?.instrument.loopTotals.dispatched ?? 0}</li>
              <li>Engaged (human POST) {bundle?.instrument.loopTotals.engaged ?? 0}</li>
              <li>Progressed {bundle?.instrument.loopTotals.progressed ?? 0}</li>
              <li>Completed {bundle?.instrument.loopTotals.completed ?? 0}</li>
            </ol>
          </div>
          <div className="ops-panel p-4">
            <h2 className="fm-display mb-3 text-2xl text-[var(--ops-ink)]">How to read it</h2>
            <ul className="space-y-2 text-sm text-[var(--ops-ink-soft)]">
              {LOOP_INTERPRETATION.map((row) => (
                <li key={row.reading}>
                  <span className="font-medium text-[var(--ops-ink)]">{row.reading}.</span> {row.meaning}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="fm-display mb-3 text-2xl text-[var(--ops-ink)]">Cohorts</h2>
          <p className="mb-3 text-xs text-[var(--ops-ink-dim)]">
            Tables, not charts. Gold bar = Founding Practice (never blended into the headline).
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
                      {fmtPct(row.activation_14d_pct)}
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
                  <th>Dispatched</th>
                  <th>Engaged</th>
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
                      {fmtPct(row.completion_14d_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="fm-display mb-3 text-2xl text-[var(--ops-ink)]">Hypotheses</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {hypotheses.map((h) => (
              <article
                key={h.id}
                className={`ops-panel p-4 ${h.status === "blocked" ? "fm-status-blocked" : ""}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ops-amber)]">
                  {h.id} · {h.status}
                </p>
                <p className="mt-2 text-sm text-[var(--ops-ink)]">{h.statement}</p>
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
            ))}
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
  onSave: (data: { source: string; situation: string; literalAsk?: string; hypothesisId?: "H1" | "H2" | "H3" | "H4" | "H5" }) => void;
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

  function submit(e: FormEvent) {
    e.preventDefault();
    if (situation.trim().length < SITUATION_MIN_CHARS) {
      toast.error(`Situation must be more than ${SITUATION_MIN_CHARS - 1} characters — what they do today.`);
      return;
    }
    onSave({ source, situation: situation.trim(), literalAsk: ask.trim() || undefined });
    setSituation("");
    setAsk("");
  }

  return (
    <section className="mb-8">
      <h2 className="fm-display mb-3 text-2xl text-[var(--ops-ink)]">Signals</h2>
      <form className="ops-panel mb-4 space-y-3 p-4" onSubmit={submit}>
        <p className="text-xs text-[var(--ops-ink-dim)]">
          Situation is required (what they actually do). Compliments do not count.
        </p>
        <textarea
          className="ops-input"
          rows={3}
          required
          minLength={SITUATION_MIN_CHARS}
          placeholder="Walk me through the last time you… (more than 20 characters)"
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
        />
        <input
          className="ops-input"
          placeholder="The ask they said out loud (optional, stored separately)"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="ops-input max-w-[10rem]"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
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
            {row.literal_ask ? <p className="mt-1 text-xs text-[var(--ops-ink-dim)]">Ask: {row.literal_ask}</p> : null}
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
      <h2 className="fm-display mb-3 text-2xl text-[var(--ops-ink)]">Experiments</h2>
      <form className="ops-panel mb-4 space-y-3 p-4" onSubmit={submit}>
        <input
          className="ops-input"
          required
          placeholder="Name (what you are changing)"
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
          <input
            className="ops-input max-w-[12rem]"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          />
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
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ops-amber)]">
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
                          onDecide({ id: row.id, decision, result, pivotType: PIVOT_TYPES[8] });
                          return;
                        }
                        onDecide({ id: row.id, decision, result });
                      }}
                    >
                      {decision}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--ops-ink-dim)]">
                  Pivot defaults to channel — change later in SQL if needed.
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
