/**
 * Shared Industry Pulse loader — one fetch for rail metrics + news band.
 */
import { useCallback, useEffect, useState } from "react";
import {
  fallbackIndustryPulse,
  fetchIndustryNews,
  type IndustryPulsePayload,
} from "@/lib/industry-news.functions";

const CACHE_KEY = "milon_industry_pulse_v5";
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
    /* ignore */
  }
}

export function useIndustryPulse(industry: string) {
  const sector = industry?.trim() || "General SME";
  const [pulse, setPulse] = useState<IndustryPulsePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
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
    },
    [sector],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const display = pulse ?? fallbackIndustryPulse(sector);

  return { display, loading, lastRefresh, error, refresh: () => load(true), sector };
}
