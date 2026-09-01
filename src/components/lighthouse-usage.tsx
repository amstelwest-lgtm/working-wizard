/**
 * Lighthouse Usage — most / least used product surfaces by
 * firms (practice), founders (owners), and customers (members).
 */

import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import {
  getLighthouseUsage,
  type LighthouseUsageReport,
} from "@/lib/product-usage.functions";
import {
  PERSONA_LABELS,
  type FeatureStat,
  type UsagePersona,
} from "@/lib/product-usage";

const WINDOWS = [7, 30, 90] as const;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FeatureBars({
  items,
  empty,
}: {
  items: FeatureStat[];
  empty: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.events));
  if (!items.length) {
    return <p className="py-4 text-xs text-[var(--ops-ink-dim)]">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((f) => (
        <div key={f.key} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-xs text-[var(--ops-ink-soft)]" title={f.label}>
            {f.label}
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--ops-line)]">
            <div
              className="h-full rounded bg-[var(--ops-amber)]"
              style={{ width: `${(f.events / max) * 100}%` }}
            />
          </div>
          <div className="w-16 text-right text-[11px] tabular-nums text-[var(--ops-ink-dim)]">
            {f.events}
            <span className="ml-1 text-[10px]">{f.uniqueUsers}u</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PersonaCard({
  persona,
  events,
  users,
}: {
  persona: UsagePersona;
  events: number;
  users: number;
}) {
  return (
    <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
        {PERSONA_LABELS[persona]}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-[var(--ops-ink)]">{users}</div>
      <div className="text-[11px] text-[var(--ops-ink-dim)]">{events} events</div>
    </div>
  );
}

export function LighthouseUsagePanel() {
  const load = useServerFn(getLighthouseUsage);
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [report, setReport] = useState<LighthouseUsageReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setReport(await load({ data: { days } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load usage");
    } finally {
      setBusy(false);
    }
  }, [days, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (busy && !report) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[var(--ops-ink-dim)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--ops-amber)]" /> Loading usage…
      </div>
    );
  }

  if (err && !report) {
    return (
      <div className="rounded-2xl border border-[var(--ops-danger-border)] bg-[var(--ops-danger-bg)] p-5 text-sm text-[var(--ops-danger-ink)]">
        {err}
      </div>
    );
  }
  if (!report) return null;

  const maxDay = Math.max(1, ...report.daily.map((d) => d.events));
  const p = report.totals.byPersona;

  return (
    <div className="space-y-6">
      {report.migrationHint && (
        <div className="rounded-xl border border-[var(--ops-amber-border)] bg-[var(--ops-amber-soft)] px-4 py-3 text-sm text-[var(--ops-amber)]">
          {report.migrationHint}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-xl text-xs text-[var(--ops-ink-dim)]">
          What firms, founders, and customers actually open. Rankings include catalog
          features with zero events so you can see what is unused.
        </p>
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setDays(w)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
              days === w
                ? "bg-[var(--ops-amber-soft)] text-[var(--ops-amber)]"
                : "border border-[var(--ops-line)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-ink-soft)]"
            }`}
          >
            {w}d
          </button>
        ))}
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--ops-line-strong)] text-[var(--ops-ink-dim)] hover:text-[var(--ops-amber)]"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            Events
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-[var(--ops-amber)]">
            {report.totals.events}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            People
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums text-[var(--ops-ink)]">
            {report.totals.uniqueUsers}
          </div>
        </div>
        <PersonaCard persona="firm" events={p.firm.events} users={p.firm.uniqueUsers} />
        <PersonaCard persona="founder" events={p.founder.events} users={p.founder.uniqueUsers} />
        <PersonaCard persona="customer" events={p.customer.events} users={p.customer.uniqueUsers} />
      </div>

      {report.daily.some((d) => d.events > 0) && (
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            Daily movement
          </div>
          <div className="flex h-16 items-end gap-px">
            {report.daily.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.events} events · ${d.users} people`}
                className="flex-1 rounded-t bg-[var(--ops-amber)]/80"
                style={{ height: `${Math.max(4, (d.events / maxDay) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            Most used
          </div>
          <FeatureBars items={report.mostUsed} empty="No events in this window yet." />
        </div>
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            Least used
          </div>
          <FeatureBars
            items={report.leastUsed}
            empty="Catalog is empty — run the usage migration."
          />
        </div>
      </div>

      {report.unused.length > 0 && report.totals.events > 0 && (
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            Untouched this window
          </div>
          <p className="mb-2 text-xs text-[var(--ops-ink-dim)]">
            {report.unused.length} catalog {report.unused.length === 1 ? "feature" : "features"} had
            no events.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {report.unused.map((f) => (
              <span
                key={f.key}
                className="rounded-full border border-[var(--ops-line)] px-2.5 py-0.5 text-[11px] text-[var(--ops-ink-soft)]"
              >
                {f.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {(["firm", "founder", "customer"] as const).map((persona) => {
        const ranked = report.features
          .filter((f) => f.byPersona[persona].events > 0)
          .sort((a, b) => b.byPersona[persona].events - a.byPersona[persona].events)
          .slice(0, 6)
          .map((f) => ({
            ...f,
            events: f.byPersona[persona].events,
            uniqueUsers: f.byPersona[persona].uniqueUsers,
          }));
        if (!ranked.length) return null;
        return (
          <div key={persona} className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
              {PERSONA_LABELS[persona]} — top features
            </div>
            <FeatureBars items={ranked} empty="" />
          </div>
        );
      })}

      {report.entities.length > 0 && (
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            Most active
          </div>
          <div className="divide-y divide-[var(--ops-line)]">
            {report.entities.map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-[var(--ops-ink-dim)]">
                  {PERSONA_LABELS[e.persona].slice(0, -1)}
                </span>
                <span className="flex-1 truncate text-[var(--ops-ink-soft)]">{e.label}</span>
                <span className="tabular-nums text-[var(--ops-amber)]">{e.events}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.recent.length > 0 && (
        <div className="rounded-2xl border border-[var(--ops-line)] bg-[var(--ops-card)] p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ops-ink-dim)]">
            Recent movement
          </div>
          <div className="divide-y divide-[var(--ops-line)]">
            {report.recent.map((r, i) => (
              <div key={`${r.at}-${i}`} className="flex gap-3 py-1.5 text-[11px]">
                <span className="w-28 shrink-0 text-[var(--ops-ink-dim)]">{fmtTime(r.at)}</span>
                <span className="w-16 shrink-0 text-[var(--ops-amber)]">{r.personaLabel}</span>
                <span className="flex-1 text-[var(--ops-ink-soft)]">{r.featureLabel}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
