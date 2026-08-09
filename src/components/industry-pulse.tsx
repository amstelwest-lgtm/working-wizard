import { ExternalLink, RefreshCw } from "lucide-react";
import { useIndustryPulse } from "@/hooks/use-industry-pulse";
import { resolveNewsUrl, type NewsItem, type PulseMetric } from "@/lib/industry-news.functions";

const TAG_COLORS: Record<string, { bg: string; color: string }> = {
  green: { bg: "rgba(76,175,130,0.15)", color: "#2f9d6a" },
  amber: { bg: "rgba(201,168,76,0.18)", color: "#b8860b" },
  red: { bg: "rgba(224,92,92,0.15)", color: "#d64545" },
  blue: { bg: "rgba(100,160,220,0.15)", color: "#3b82c4" },
};

function MetricRow({ metric }: { metric: PulseMetric }) {
  const color =
    metric.sentiment === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : metric.sentiment === "bad"
        ? "text-rose-600 dark:text-rose-400"
        : "text-amber-600 dark:text-amber-300";
  const arrow =
    metric.direction === "up" ? "↑ " : metric.direction === "down" ? "↓ " : "→ ";
  const value = /^[↑↓→]/.test(metric.value.trim()) ? metric.value : `${arrow}${metric.value}`;
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[12px]">
      <span className="text-slate-500 dark:text-slate-400">{metric.label}</span>
      <span className={`max-w-[55%] text-right font-semibold ${color}`}>{value}</span>
    </div>
  );
}

/** Compact rail card: headline + metrics only (news lives in IndustryNewsBand). */
export function IndustryPulse({
  industry,
  vertical,
}: {
  industry: string;
  vertical?: boolean;
}) {
  void vertical;
  const { display, loading, lastRefresh, error, refresh } = useIndustryPulse(industry);

  return (
    <div className="w-full rounded-xl border border-slate-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-[#0f172a]/55 dark:shadow-none">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
              style={{ boxShadow: "0 0 6px #4caf82" }}
            />
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-800 dark:text-slate-100">
              Industry Pulse
            </h3>
          </div>
          <p className="mt-0.5 pl-4 text-[10px] text-slate-500">
            {display.source === "ai" ? "Claude · Live" : "Sector baseline"} ·{" "}
            {lastRefresh ? lastRefresh.toLocaleDateString("en-ZA") : "Updated today"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          aria-label="Refresh industry pulse"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[#d4a550]/35 text-[#b8860b] transition-colors hover:bg-[#d4a550]/10 disabled:opacity-40 dark:text-[#d4a550]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !display.metrics.length ? (
        <div className="space-y-2 py-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-slate-200 dark:bg-white/7"
              style={{ width: i === 3 ? "55%" : "100%" }}
            />
          ))}
        </div>
      ) : (
        <>
          <p className="text-[13px] font-semibold leading-snug text-slate-900 dark:text-white">
            {display.headline}
          </p>
          <div className="mt-2 divide-y divide-slate-100 border-y border-slate-100 py-0.5 dark:divide-white/6 dark:border-white/6">
            {display.metrics.map((m) => (
              <MetricRow key={m.label} metric={m} />
            ))}
          </div>
          {error && (
            <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
              Live AI unavailable — showing sector baseline.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function NewsLinkCard({ item }: { item: NewsItem }) {
  const tc = TAG_COLORS[item.tagColor] ?? TAG_COLORS.amber;
  const href = resolveNewsUrl(item);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#d4a550]/50 hover:shadow-md dark:border-white/10 dark:bg-[#0f172a]/55 dark:hover:border-[#d4a550]/35"
    >
      <span
        className="inline-block w-fit rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em]"
        style={{ background: tc.bg, color: tc.color }}
      >
        {item.tag}
      </span>
      <div className="mt-2 text-[13px] font-semibold leading-snug text-slate-900 group-hover:text-[#8a651b] dark:text-white dark:group-hover:text-[#d4a550]">
        {item.headline}
      </div>
      <div className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        {item.summary}
      </div>
      <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#b8860b] dark:text-[#d4a550]">
        Read article
        <ExternalLink className="h-3 w-3 opacity-80 transition group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}

/** Full-width news strip under the overview grid — keeps the rail from spilling. */
export function IndustryNewsBand({ industry }: { industry: string }) {
  const { display, loading } = useIndustryPulse(industry);
  if (loading && !display.items.length) {
    return (
      <section className="mt-4">
        <div className="mb-2.5 h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-white/5" />
          ))}
        </div>
      </section>
    );
  }
  if (!display.items.length) return null;

  return (
    <section className="mt-4">
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-800 dark:text-slate-100">
            Industry News
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">What's moving in your sector</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {display.items.map((item, i) => (
          <NewsLinkCard key={`${item.headline}-${i}`} item={item} />
        ))}
      </div>
    </section>
  );
}
