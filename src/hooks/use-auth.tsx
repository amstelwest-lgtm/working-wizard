import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up listener BEFORE getSession (per Supabase guidance)
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      setSession(s);
      // After email-confirmation sign-in, create the firm from metadata if it doesn't exist yet.
      if (event === "SIGNED_IN" && s?.user) {
        const firmName = s.user.user_metadata?.firm_name as string | undefined;
        if (firmName) {
          const { count } = await supabase
            .from("firms")
            .select("id", { count: "exact", head: true })
            .eq("owner_user_id", s.user.id);
          if (count === 0) {
            const { error: fErr } = await supabase
              .from("firms")
              .insert({ name: firmName, owner_user_id: s.user.id });
            if (!fErr) {
              await supabase
                .from("user_roles")
                .insert({ user_id: s.user.id, role: "firm_admin" });
            }
          }
        }
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          const { clearPortalRouting } = await import("@/lib/user-roles");
          clearPortalRouting();
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
