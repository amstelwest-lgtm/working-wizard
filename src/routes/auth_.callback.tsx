import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { acceptOwnerInvite, ensurePracticePortalAccess } from "@/lib/auth.functions";
import {
  consumeGoogleAuthIntent,
  establishSessionFromOAuthCallback,
  googleDisplayName,
  inferGoogleIntentFromRoles,
  isFreshAuthUser,
} from "@/lib/google-auth";
import { notifySignup } from "@/lib/signup-notify";
import {
  consumePendingOwnerInvite,
  ownerInviteFromCallbackSearch,
  ownerInviteLandingPath,
  peekPendingOwnerInvite,
  resolvePendingOwnerInvite,
  stashInviteHandoff,
  stashPendingOwnerInvite,
} from "@/lib/invite-handoff";
import { readVisitorMarket, withMarketRpcFallback } from "@/lib/market";
import { OPS_UNLOCK_KEY } from "@/lib/owner-ops.functions";
import { isOpsNext, lighthouseTabFromOpsNext } from "@/lib/client-note-link";
import { accessTokenFromNext } from "@/lib/practice-access";
import { listUserFirms } from "@/lib/firm-brand";
import {
  clearForcePortal,
  forcePortal,
  resolvePortalRoles,
  resolvePostLoginPath,
  setPortalIntent,
  shouldOpenItInbox,
} from "@/lib/user-roles";
import {
  AuthEntryCard,
  AuthEntryEyebrow,
  AuthEntryShell,
  AuthEntryTitle,
} from "@/components/auth-entry-shell";
import {
  OwnerInviteCard,
  OwnerInviteEyebrow,
  OwnerInviteShell,
} from "@/components/owner-invite-shell";

export const Route = createFileRoute("/auth_/callback")({
  component: AuthCallbackPage,
  head: () => ({
    meta: [{ title: "Signing in — Milōn" }],
  }),
});

function detectInviteFlow(): boolean {
  if (typeof window === "undefined") return false;
  if (ownerInviteFromCallbackSearch(window.location.search)) return true;
  if (peekPendingOwnerInvite()?.token) return true;
  return false;
}

function AuthCallbackPage() {
  const navigate = useNavigate();
  const ensurePractice = useServerFn(ensurePracticePortalAccess);
  const doAcceptOwnerInvite = useServerFn(acceptOwnerInvite);
  const [error, setError] = useState("");
  const [inviteContinue, setInviteContinue] = useState<string | null>(null);
  const [working, setWorking] = useState(true);
  const [isInviteFlow, setIsInviteFlow] = useState(detectInviteFlow);

  useEffect(() => {
    const el = document.documentElement;
    const hadDark = el.classList.contains("dark");
    el.classList.add("dark");
    return () => {
      if (!hadDark) el.classList.remove("dark");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const established = await establishSessionFromOAuthCallback();
      if (cancelled) return;
      if (established.error) {
        setWorking(false);
        setError(established.error);
        return;
      }

      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        setWorking(false);
        setError("Google sign-in did not complete. Please try again.");
        return;
      }

      const consumed = consumeGoogleAuthIntent();
      const { next } = consumed;
      // URL (OAuth redirectTo) survives origin hops and storage loss. Do not
      // consume the cookie until redeem succeeds — a remount must not drop it.
      const pendingInvite = resolvePendingOwnerInvite({
        callbackSearch: window.location.search,
        next,
        stored: peekPendingOwnerInvite(),
      });
      if (pendingInvite?.token) setIsInviteFlow(true);
      let intent = consumed.intent;
      if (!intent && !pendingInvite?.token) {
        // Nothing survived the round trip (origin hop). Decide from the account.
        const portal = await resolvePortalRoles(user.id);
        const firms =
          portal.hasClientRole || portal.hasPracticeRole ? [] : await listUserFirms(user.id);
        intent = inferGoogleIntentFromRoles({ ...portal, hasFirm: firms.length > 0 });
        setPortalIntent(intent);
      }
      const displayName = googleDisplayName(
        user.user_metadata as Record<string, unknown> | undefined,
        user.email,
      );

      // Owner invite always wins over the existing Google identity. Matching
      // amstel.west@gmail.com to the accountant login must still open the
      // invited business seat (dual-role), not the practice console.
      if (pendingInvite?.token) {
        forcePortal("owner");
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
        try {
          const accepted = (await doAcceptOwnerInvite({
            data: {
              inviteClientId: pendingInvite.token,
              inviteClientCode: pendingInvite.clientCode,
            },
          })) as { clientId?: string } | undefined;
          consumePendingOwnerInvite();
          stashInviteHandoff(accepted?.clientId ?? null);
          if (!cancelled) void navigate({ to: "/app", replace: true });
        } catch (err) {
          stashPendingOwnerInvite(pendingInvite.token, pendingInvite.clientCode);
          const msg = err instanceof Error ? err.message : "Could not accept the invite.";
          if (!cancelled) {
            setWorking(false);
            setError(msg);
            setInviteContinue(ownerInviteLandingPath(pendingInvite.token));
          }
        }
        return;
      }

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
  }, [doAcceptOwnerInvite, ensurePractice, navigate]);

  const useInviteShell = isInviteFlow || Boolean(inviteContinue);

  if (error) {
    if (useInviteShell) {
      return (
        <OwnerInviteShell>
          <OwnerInviteEyebrow>{inviteContinue ? "Invitation" : "Sign in"}</OwnerInviteEyebrow>
          <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-[#e8ede9]">
            {inviteContinue ? "Could not accept invitation" : "Could not sign in with Google"}
          </h1>
          <OwnerInviteCard className="mt-6 text-center">
            <p className="text-sm leading-relaxed text-[#8a938c]">{error}</p>
            <div className="mt-6 flex flex-col gap-3">
              {inviteContinue ? (
                <a
                  href={inviteContinue}
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300]"
                >
                  Continue invitation
                </a>
              ) : (
                <Link
                  to="/"
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300]"
                >
                  Back home
                </Link>
              )}
            </div>
          </OwnerInviteCard>
        </OwnerInviteShell>
      );
    }

    return (
      <AuthEntryShell>
        <AuthEntryEyebrow>Sign in</AuthEntryEyebrow>
        <AuthEntryTitle>Could not sign in with Google</AuthEntryTitle>
        <AuthEntryCard className="mt-6 text-center">
          <p className="text-sm leading-relaxed text-[#8a938c]">{error}</p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              to="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300]"
            >
              Back home
            </Link>
            <Link
              to="/auth"
              search={{}}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/15 px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#c9d0cb] hover:border-white/25 hover:text-[#e8ede9]"
            >
              Accountant portal
            </Link>
          </div>
        </AuthEntryCard>
      </AuthEntryShell>
    );
  }

  if (useInviteShell) {
    return (
      <OwnerInviteShell loading={working} loadingMessage="Completing sign-in…">
        {!working ? (
          <p className="text-center text-sm text-[#8a938c]">Redirecting to your workspace…</p>
        ) : null}
      </OwnerInviteShell>
    );
  }

  return <AuthEntryShell loading loadingMessage="Signing you in with Google…" />;
}
