import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import {
  fetchIndustryNews,
  fallbackIndustryPulse,
  type IndustryPulsePayload,
  type NewsItem,
  type PulseMetric,
} from "@/lib/industry-news.functions";

const TAG_COLORS: Record<string, { bg: string; color: string }> = {
  green: { bg: "rgba(76,175,130,0.15)", color: "#4caf82" },
  amber: { bg: "rgba(201,168,76,0.15)", color: "#c9a84c" },
  red: { bg: "rgba(224,92,92,0.15)", color: "#e05c5c" },
  blue: { bg: "rgba(100,160,220,0.15)", color: "#64a0dc" },
};

const CACHE_KEY = "milon_industry_pulse_v2";
const CACHE_TTL = 24 * 60 * 60 * 1000;

type CachedPulse = {
  timestamp: number;
  data: IndustryPulsePayload;
};

function loadCache(industry: string): IndustryPulsePayload | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}_${industry}`);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw) as CachedPulse;
    if (Date.now() - timestamp < CACHE_TTL && data?.metrics?.length) return data;
    return null;
  } catch {
    return null;
  }
}

function saveCache(industry: string, data: IndustryPulsePayload) {
  try {
    sessionStorage.setItem(
      `${CACHE_KEY}_${industry}`,
      JSON.stringify({ timestamp: Date.now(), data } satisfies CachedPulse),
    );
  } catch {
    /* ignore quota */
  }
}

function MetricRow({ metric }: { metric: PulseMetric }) {
  const color =
    metric.sentiment === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : metric.sentiment === "bad"
        ? "text-rose-600 dark:text-rose-400"
        : "text-amber-600 dark:text-amber-300";
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-slate-500 dark:text-slate-400">{metric.label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>{metric.value}</span>
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const tc = TAG_COLORS[item.tagColor] ?? TAG_COLORS.amber;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-white/8 dark:bg-white/[0.03]">
      <span
        className="w-fit rounded px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em]"
        style={{ background: tc.bg, color: tc.color }}
      >
        {item.tag}
      </span>
      <div className="text-[13px] font-bold leading-snug text-slate-900 dark:text-white">
        {item.headline}
      </div>
      <div className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        {item.summary}
      </div>
    </div>
  );
}

export function IndustryPulse({
  industry,
  vertical,
}: {
  industry: string;
  /** kept for call-site compatibility; sidebar layout is always vertical */
  vertical?: boolean;
}) {
  void vertical;
  const sector = industry?.trim() || "General SME";
  const [pulse, setPulse] = useState<IndustryPulsePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    if (!force) {
      const cached = loadCache(sector);
      if (cached) {
        setPulse(cached);
        setLastRefresh(new Date());
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchIndustryNews({ data: { industry: sector } });
      const payload =
        result?.metrics?.length || result?.items?.length
          ? result
          : fallbackIndustryPulse(sector);
      saveCache(sector, payload);
      setPulse(payload);
      setLastRefresh(new Date());
    } catch (e) {
      const fb = fallbackIndustryPulse(sector);
      setPulse(fb);
      setError(e instanceof Error ? e.message : "Using offline industry pulse");
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sector]);

  const display = pulse ?? fallbackIndustryPulse(sector);

  return (
    <div className="w-full max-w-[340px] rounded-2xl border border-slate-200 bg-gradient-to-b from-amber-50/60 to-white p-4 dark:border-white/8 dark:from-white/[0.04] dark:to-transparent">
      {/* Header — title on its own row so it never gets clipped */}
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
            style={{ boxShadow: "0 0 6px #4caf82", animation: "pulse 2s ease-in-out infinite" }}
          />
          <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-900 dark:text-white">
            Industry Pulse
          </h3>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          aria-label="Refresh industry pulse"
          className="flex items-center gap-1.5 rounded-md border border-[#d4a550]/40 px-2 py-1 text-[10px] font-semibold text-[#b8860b] transition-colors hover:bg-[#d4a550]/10 disabled:opacity-40 dark:text-[#d4a550]"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <p className="mb-3 text-[10px] text-slate-500">
        AI · {lastRefresh ? lastRefresh.toLocaleDateString("en-ZA") : "Refreshed daily"}
      </p>

      {loading && !pulse && (
        <div className="space-y-2 py-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-slate-200 dark:bg-white/7"
              style={{ width: i === 3 ? "55%" : "100%" }}
            />
          ))}
        </div>
      )}

      {(!loading || pulse) && (
        <>
          <p className="text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">
            {display.headline}
          </p>

          <div className="mt-3 divide-y divide-slate-200/80 border-y border-slate-200/80 py-1 dark:divide-white/6 dark:border-white/6">
            {display.metrics.map((m) => (
              <MetricRow key={m.label} metric={m} />
            ))}
          </div>

          {error && (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              Live AI unavailable — showing sector baseline.
            </p>
          )}

          {/* Industry news always visible */}
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Industry News
            </p>
            <div className="flex flex-col gap-2.5">
              {display.items.map((item, i) => (
                <NewsCard key={`${item.headline}-${i}`} item={item} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
