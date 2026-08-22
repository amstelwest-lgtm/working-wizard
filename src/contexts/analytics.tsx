import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { ingestProductUsage } from "@/lib/product-usage.functions";
import {
  shouldSkipPath,
  surfaceFromPath,
  type UsageSurface,
} from "@/lib/product-usage";

export type AnalyticsEvent = {
  id: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  userId: string;
};

type TrackProps = Record<string, unknown> & {
  tab?: string;
  path?: string;
  clientId?: string | null;
  firmId?: string | null;
  featureKey?: string;
  surface?: UsageSurface;
};

type AnalyticsCtx = {
  events: AnalyticsEvent[];
  track: (eventName: string, properties?: TrackProps) => void;
};

const AnalyticsContext = createContext<AnalyticsCtx>({
  events: [],
  track: () => {},
});

const SESSION_KEY = "milon_usage_session";
const MAX_LOCAL = 250;

type Queued = {
  event: string;
  featureKey?: string;
  surface?: UsageSurface;
  tab?: string;
  path?: string;
  clientId?: string | null;
  firmId?: string | null;
  sessionId?: string;
  occurredAt?: string;
  properties?: Record<string, unknown>;
};

function usageSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "";
  }
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { firmId } = useAccountantProfile();
  const ingest = useServerFn(ingestProductUsage);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const queueRef = useRef<Queued[]>([]);
  const lastSigRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef<string | null>(null);
  const firmIdRef = useRef<string | null>(null);
  const ingestRef = useRef(ingest);

  userIdRef.current = user?.id ?? null;
  firmIdRef.current = firmId;
  ingestRef.current = ingest;

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!userIdRef.current) {
      queueRef.current = [];
      return;
    }
    const batch = queueRef.current.splice(0, 40);
    if (!batch.length) return;
    try {
      await ingestRef.current({ data: { events: batch } });
    } catch {
      /* tracking must never break the product */
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, 1800);
  }, [flush]);

  const track = useCallback(
    (eventName: string, properties: TrackProps = {}) => {
      const timestamp = new Date().toISOString();
      const userId = userIdRef.current ?? (typeof properties.userId === "string" ? properties.userId : "anonymous");
      const local: AnalyticsEvent = {
        id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        event: eventName,
        properties,
        timestamp,
        userId,
      };
      setEvents((prev) => {
        const next = [...prev, local];
        return next.length > MAX_LOCAL ? next.slice(next.length - MAX_LOCAL) : next;
      });
      if (import.meta.env.DEV) {
        console.log("[Milōn track]", eventName, properties);
      }

      if (!userIdRef.current) return;
      const path = typeof properties.path === "string" ? properties.path : undefined;
      if (path && shouldSkipPath(path)) return;

      const sig = `${eventName}|${properties.tab ?? ""}|${path ?? ""}|${properties.featureKey ?? ""}`;
      if (sig === lastSigRef.current && eventName === "tab_viewed") return;
      if (eventName === "page_viewed" || eventName === "tab_viewed") {
        lastSigRef.current = sig;
      }

      const surface =
        properties.surface ?? (path ? surfaceFromPath(path) : undefined);
      queueRef.current.push({
        event: eventName,
        featureKey: properties.featureKey,
        surface,
        tab: properties.tab,
        path,
        clientId: properties.clientId ?? null,
        firmId: properties.firmId ?? firmIdRef.current,
        sessionId: usageSessionId(),
        occurredAt: timestamp,
        properties,
      });
      if (queueRef.current.length >= 20) {
        void flush();
      } else {
        scheduleFlush();
      }
    },
    [flush, scheduleFlush],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHide = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flush]);

  useEffect(() => {
    if (!userIdRef.current) return;
    if (shouldSkipPath(pathname)) return;
    track("page_viewed", {
      path: pathname,
      surface: surfaceFromPath(pathname),
      firmId: firmIdRef.current,
    });
  }, [pathname, user?.id, track]);

  return (
    <AnalyticsContext.Provider value={{ events, track }}>{children}</AnalyticsContext.Provider>
  );
}

export function useAnalytics() {
  return useContext(AnalyticsContext);
}
