/**
 * Shared Industry Pulse loader — one fetch for rail metrics + news band.
 */
import { useCallback, useEffect, useState } from "react";
import { useMarket } from "@/contexts/market";
import {
  fallbackIndustryPulse,
  fetchIndustryNews,
  type IndustryPulsePayload,
} from "@/lib/industry-news.functions";
import { selectionPayload } from "@/lib/market";

const CACHE_KEY = "milon_industry_pulse_v5";
const CACHE_TTL = 24 * 60 * 60 * 1000;

type CachedPulse = {
  timestamp: number;
  data: IndustryPulsePayload;
};

function marketCacheKey(country: string, regionCode: string | null): string {
  return country === "US" ? `US_${regionCode ?? "XX"}` : "ZA";
}

function loadCache(industry: string, marketKey: string): IndustryPulsePayload | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(`${CACHE_KEY}_${industry}_${marketKey}`);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw) as CachedPulse;
    if (Date.now() - timestamp < CACHE_TTL && data?.metrics?.length) return data;
    return null;
  } catch {
    return null;
  }
}

function saveCache(industry: string, marketKey: string, data: IndustryPulsePayload) {
  try {
    sessionStorage.setItem(
      `${CACHE_KEY}_${industry}_${marketKey}`,
      JSON.stringify({ timestamp: Date.now(), data } satisfies CachedPulse),
    );
  } catch {
    /* ignore */
  }
}

export function useIndustryPulse(industry: string) {
  const { selection, market } = useMarket();
  const sector = industry?.trim() || "General SME";
  const marketKey = marketCacheKey(selection.country, selection.regionCode);
  const [pulse, setPulse] = useState<IndustryPulsePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (!force) {
        const cached = loadCache(sector, marketKey);
        if (cached) {
          setPulse(cached);
          setLastRefresh(new Date());
          return;
        }
      }
      setLoading(true);
      setError(null);
      try {
        const result = await fetchIndustryNews({
          data: { industry: sector, market: selectionPayload(selection) },
        });
        const payload =
          result?.metrics?.length || result?.items?.length
            ? result
            : fallbackIndustryPulse(sector, market);
        saveCache(sector, marketKey, payload);
        setPulse(payload);
        setLastRefresh(new Date());
      } catch (e) {
        const fb = fallbackIndustryPulse(sector, market);
        setPulse(fb);
        setError(e instanceof Error ? e.message : "Using offline industry pulse");
        setLastRefresh(new Date());
      } finally {
        setLoading(false);
      }
    },
    [sector, marketKey, selection, market],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const display = pulse ?? fallbackIndustryPulse(sector, market);

  return { display, loading, lastRefresh, error, refresh: () => load(true), sector };
}
