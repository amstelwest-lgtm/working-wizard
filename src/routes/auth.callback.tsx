import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ensurePracticePortalAccess } from "@/lib/auth.functions";
import {
  consumeGoogleAuthIntent,
  establishSessionFromOAuthCallback,
  googleDisplayName,
  isFreshAuthUser,
} from "@/lib/google-auth";
import { notifySignup } from "@/lib/signup-notify";
import { readVisitorMarket, withMarketRpcFallback } from "@/lib/market";
import { OPS_UNLOCK_KEY } from "@/lib/owner-ops.functions";
import { isOpsNext, lighthouseTabFromOpsNext } from "@/lib/client-note-link";
import { accessTokenFromNext } from "@/lib/practice-access";
import {
  clearForcePortal,
  forcePortal,
  resolvePostLoginPath,
  setPortalIntent,
  shouldOpenItInbox,
} from "@/lib/user-roles";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
  head: () => ({
    meta: [{ title: "Signing in — Milōn" }],
  }),
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const ensurePractice = useServerFn(ensurePracticePortalAccess);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const established = await establishSessionFromOAuthCallback();
      if (cancelled) return;
      if (established.error) {
        setError(established.error);
        return;
      }

      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        setError("Google sign-in did not complete. Please try again.");
        return;
      }

      const { intent, next } = consumeGoogleAuthIntent();
      const displayName = googleDisplayName(
        user.user_metadata as Record<string, unknown> | undefined,
        user.email,
      );

      if (intent === "owner") {
        try {
          await supabase.auth.updateUser({
            data: {
              signup_type: (user.user_metadata?.signup_type as string | undefined) ?? "customer",
              full_name:
                (user.user_metadata?.full_name as string | undefined) ||
                (user.user_metadata?.name as string | undefined) ||
                displayName,
            },
          });
        } catch {
          /* metadata stamp is best-effort */
        }
        const { error: rpcErr } = await withMarketRpcFallback(
          () =>
            supabase.rpc("ensure_own_client", {
              p_name: displayName,
              p_market: readVisitorMarket() ?? { country: "ZA", regionCode: null },
            }),
          () => supabase.rpc("ensure_own_client", { p_name: displayName }),
        );
        if (rpcErr) console.error("[google] ensure_own_client failed:", rpcErr.message);
        if (isFreshAuthUser(user.created_at)) {
          notifySignup("Business owner (Google)", user.email ?? "", displayName);
        }
      } else {
        await ensurePractice().catch(() => undefined);
        if (isFreshAuthUser(user.created_at)) {
          notifySignup("Accountant firm (Google)", user.email ?? "", displayName);
        }
      }

      let goOps = false;
      try {
        goOps = sessionStorage.getItem(OPS_UNLOCK_KEY) === "1";
      } catch {
        /* ignore */
      }

      const accessTok = accessTokenFromNext(next);
      if (accessTok) {
        if (!cancelled)
          void navigate({ to: "/access/$token", params: { token: accessTok }, replace: true });
        return;
      }
      let path: "/app" | "/dashboard" | "/ops" = "/app";
      let opsTab: string | undefined;
      if (goOps || isOpsNext(next)) {
        path = "/ops";
        opsTab = lighthouseTabFromOpsNext(next);
      } else if (await shouldOpenItInbox(user.id)) {
        path = "/ops";
        opsTab = "it";
      } else {
        forcePortal(intent);
        path = await resolvePostLoginPath(user.id);
        if (intent === "accountant" && path === "/app") {
          clearForcePortal();
          setPortalIntent("owner");
        }
      }
      if (!cancelled) {
        if (path === "/ops") {
          void navigate({ to: "/ops", search: opsTab ? { tab: opsTab } : {}, replace: true });
        } else {
          void navigate({ to: path, replace: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensurePractice, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-4">
      <img src="/milon-wordmark.png" alt="Milōn" className="h-8 w-auto" />
      {error ? (
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold">Could not sign in with Google</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex flex-wrap justify-center gap-3 pt-2 text-sm">
            <Link to="/" className="text-primary underline">
              Back home
            </Link>
            <Link to="/auth" search={{}} className="text-primary underline">
              Accountant portal
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Signing you in with Google…</p>
      )}
    </div>
  );
}
