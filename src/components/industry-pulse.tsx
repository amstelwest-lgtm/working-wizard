import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useViewMode } from "@/contexts/view-mode";
import { fetchIndustryNews, type NewsItem } from "@/lib/industry-news.functions";

const TAG_COLORS: Record<string, { bg: string; color: string }> = {
  green: { bg: "rgba(76,175,130,0.15)",  color: "#4caf82" },
  amber: { bg: "rgba(201,168,76,0.15)",   color: "#c9a84c" },
  red:   { bg: "rgba(224,92,92,0.15)",    color: "#e05c5c" },
  blue:  { bg: "rgba(100,160,220,0.15)",  color: "#64a0dc" },
};

const CACHE_KEY = "milon_industry_news";
const CACHE_TTL = 24 * 60 * 60 * 1000;

function loadCache(industry: string): NewsItem[] | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}_${industry}`);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw) as { timestamp: number; data: NewsItem[] };
    if (Date.now() - timestamp < CACHE_TTL) return data;
    return null;
  } catch {
    return null;
  }
}

function saveCache(industry: string, data: NewsItem[]) {
  try {
    sessionStorage.setItem(
      `${CACHE_KEY}_${industry}`,
      JSON.stringify({ timestamp: Date.now(), data }),
    );
  } catch {
  }
}

export function IndustryPulse({ industry }: { industry: string }) {
  const { viewMode } = useViewMode();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    if (!force) {
      const cached = loadCache(industry);
      if (cached && cached.length > 0) {
        setNews(cached);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchIndustryNews({ data: { industry } });
      if (result.items.length > 0) {
        saveCache(industry, result.items);
        setNews(result.items);
        setLastRefresh(new Date());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (industry) load();
  }, [industry]);

  const displayNews = viewMode === "simplified" ? news.slice(0, 1) : news;

  return (
    <div className="w-full max-w-[640px]">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full bg-emerald-500"
            style={{ boxShadow: "0 0 6px #4caf82", animation: "pulse 2s ease-in-out infinite" }}
          />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white">
            Industry Pulse
          </span>
          <span className="text-[10px] text-slate-500">
            AI ·{" "}
            {lastRefresh
              ? lastRefresh.toLocaleDateString("en-ZA")
              : "Refreshed daily"}
          </span>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-[#d4a550]/30 px-2.5 py-1 text-[10px] font-semibold text-[#d4a550] transition-colors hover:border-[#d4a550]/60 hover:bg-[#d4a550]/10 disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2 py-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-3 animate-pulse rounded bg-white/7"
              style={{ width: i === 2 ? "60%" : "100%" }}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <p className="py-3 text-center text-xs text-slate-500">{error}</p>
      )}

      {/* Empty state */}
      {!loading && !error && displayNews.length === 0 && (
        <p className="py-3 text-center text-xs text-slate-500">
          No news loaded yet — tap Refresh.
        </p>
      )}

      {/* News cards */}
      {!loading && displayNews.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {displayNews.map((item, i) => {
            const tc = TAG_COLORS[item.tagColor] ?? TAG_COLORS.amber;
            return (
              <div
                key={i}
                className="flex min-w-[240px] max-w-[260px] shrink-0 flex-col gap-2 rounded-xl border border-white/8 bg-white/4 p-3.5"
              >
                <span
                  className="w-fit rounded px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em]"
                  style={{ background: tc.bg, color: tc.color }}
                >
                  {item.tag}
                </span>
                <div className="text-[13px] font-bold leading-snug text-white">
                  {item.headline}
                </div>
                <div className="text-[11px] leading-relaxed text-slate-400">
                  {item.summary}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
