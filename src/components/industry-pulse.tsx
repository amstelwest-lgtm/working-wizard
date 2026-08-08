import { useState, useEffect } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
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
      ? "text-emerald-400"
      : metric.sentiment === "bad"
        ? "text-rose-400"
        : "text-amber-300";
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-slate-400">{metric.label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>{metric.value}</span>
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const tc = TAG_COLORS[item.tagColor] ?? TAG_COLORS.amber;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <span
        className="w-fit rounded px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em]"
        style={{ background: tc.bg, color: tc.color }}
      >
        {item.tag}
      </span>
      <div className="text-[13px] font-bold leading-snug text-white">{item.headline}</div>
      <div className="text-[11px] leading-relaxed text-slate-400">{item.summary}</div>
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
  const [showNews, setShowNews] = useState(false);

  async function load(force = false) {
    if (!force) {
      const cached = loadCache(sector);
      if (cached) {
        setPulse(cached);
        setLastRefresh(new Date(cached.source === "fallback" ? Date.now() : Date.now()));
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
      // Never leave the rail blank — show curated pulse and soft-error.
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
    <div className="w-full max-w-[340px] rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.04] to-transparent p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
            style={{ boxShadow: "0 0 6px #4caf82", animation: "pulse 2s ease-in-out infinite" }}
          />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white">
            Industry Pulse
          </span>
          <span className="truncate text-[10px] text-slate-500">
            AI · {lastRefresh ? lastRefresh.toLocaleDateString("en-ZA") : "Refreshed daily"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          aria-label="Refresh industry pulse"
          className="flex items-center gap-1.5 rounded-md border border-[#d4a550]/30 px-2 py-1 text-[10px] font-semibold text-[#d4a550] transition-colors hover:border-[#d4a550]/60 hover:bg-[#d4a550]/10 disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !pulse && (
        <div className="space-y-2 py-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-white/7"
              style={{ width: i === 3 ? "55%" : "100%" }}
            />
          ))}
        </div>
      )}

      {!loading || pulse ? (
        <>
          <p className="text-[15px] font-semibold leading-snug text-white">{display.headline}</p>

          <div className="mt-3 divide-y divide-white/6 border-y border-white/6 py-1">
            {display.metrics.map((m) => (
              <MetricRow key={m.label} metric={m} />
            ))}
          </div>

          {error && (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              Live AI unavailable — showing sector baseline. {error.includes("AI not configured") ? "Add LOVABLE_API_KEY or GEMINI_API_KEY to refresh live." : ""}
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowNews((v) => !v)}
            className="mt-3 flex w-full items-center justify-between text-[11px] font-semibold text-[#d4a550] transition hover:text-[#e8c06a]"
          >
            <span>{showNews ? "Hide full industry pulse" : "View full industry pulse"}</span>
            <ChevronRight className={`h-3.5 w-3.5 transition ${showNews ? "rotate-90" : ""}`} />
          </button>

          {showNews && (
            <div className="mt-3 flex flex-col gap-2.5">
              {display.items.map((item, i) => (
                <NewsCard key={`${item.headline}-${i}`} item={item} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
