import { createContext, useContext, useState } from "react";

export type AnalyticsEvent = {
  id: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  userId: string;
};

type AnalyticsCtx = {
  events: AnalyticsEvent[];
  track: (eventName: string, properties?: Record<string, unknown>) => void;
};

const AnalyticsContext = createContext<AnalyticsCtx>({
  events: [],
  track: () => {},
});

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);

  function track(eventName: string, properties: Record<string, unknown> = {}) {
    const event: AnalyticsEvent = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      event: eventName,
      properties,
      timestamp: new Date().toISOString(),
      userId: (properties.userId as string) || "anonymous",
    };
    setEvents((prev) => [...prev, event]);
    if (import.meta.env.DEV) {
      console.log("[Milōn track]", event.event, event.properties);
    }
  }

  return (
    <AnalyticsContext.Provider value={{ events, track }}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics() {
  return useContext(AnalyticsContext);
}
