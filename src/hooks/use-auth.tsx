import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useRouterState } from "@tanstack/react-router";
import { setMonitoringUser } from "@/lib/monitoring";
import { isPublicMarketingPath } from "@/lib/public-marketing";
import { clearLegacyInsightSeen } from "@/lib/funnel-timing";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

const AUTH_WAKE = "milon-auth-wake";

/** Ask AuthProvider to attach the Supabase client (sign-in on a public page). */
export function wakeAuth(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_WAKE));
}

function storageHasAuthToken(storage: Storage): boolean {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    const value = storage.getItem(key);
    if (value && value !== "null") return true;
  }
  return false;
}

/** True when this tab already has a Supabase session (sessionStorage, or a legacy local copy). */
function browserHasAuthToken(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (storageHasAuthToken(window.sessionStorage)) return true;
    if (storageHasAuthToken(window.localStorage)) return true;
  } catch {
    /* private mode / blocked storage */
  }
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onPublic = isPublicMarketingPath(pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [wake, setWake] = useState(0);

  useEffect(() => {
    const onWake = () => setWake((n) => (n > 0 ? n : 1));
    window.addEventListener(AUTH_WAKE, onWake);
    return () => window.removeEventListener(AUTH_WAKE, onWake);
  }, []);

  useEffect(() => {
    // Anonymous marketing HTML paints without the Supabase client. A stored
    // session, an app route, or an in-page sign-in still attaches the listener
    // before getSession (a callback that awaits another Supabase call deadlocks
    // the auth lock and freezes the portal on "Loading…").
    const shouldLoad = !onPublic || wake > 0 || browserHasAuthToken();
    if (!shouldLoad) {
      setLoading(false);
      setSession(null);
      return;
    }

    let unsub = () => {};
    let cancelled = false;
    setLoading(true);
    void import("@/integrations/supabase/client").then(({ supabase }) => {
      if (cancelled) return;
      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        setSession(s);
        setMonitoringUser(s?.user.id ?? null);
      });
      unsub = () => sub.subscription.unsubscribe();
      void supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setMonitoringUser(data.session?.user.id ?? null);
        setLoading(false);
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [onPublic, wake]);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          const { clearPortalRouting } = await import("@/lib/user-roles");
          clearPortalRouting();
          clearLegacyInsightSeen();
          // Local only: a global revoke would kill this email's other tabs.
          const { supabase } = await import("@/integrations/supabase/client");
          await supabase.auth.signOut({ scope: "local" });
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
