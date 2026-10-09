import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { acceptOwnerInvite, ensurePracticePortalAccess } from "@/lib/auth.functions";
import {
  consumeAccountantGoogleSignup,
  consumeGoogleAuthIntent,
  establishSessionFromOAuthCallback,
  googleDisplayName,
  inferGoogleIntentFromRoles,
  isFreshAuthUser,
} from "@/lib/google-auth";
import {
  accountantInviteTokenFromPath,
  accountantJoinFromCallbackSearch,
  accountantJoinTokenFromNext,
} from "@/lib/accountant-invite";
import { notifySignup } from "@/lib/signup-notify";
import {
  signupWelcomeTrigger,
  WELCOME_FRESH_WINDOW_MS,
  welcomeWithoutBlockingSignup,
} from "@/lib/welcome-email";
import { sendSignupWelcome } from "@/lib/welcome-email.functions";
import {
  consumePendingOwnerInvite,
  ownerInviteFromCallbackSearch,
  ownerInviteLandingPath,
  peekPendingOwnerInvite,
  resolvePendingOwnerInvite,
  stashInviteHandoff,
  stashPendingOwnerInvite,
} from "@/lib/invite-handoff";
import {
  marketToJson,
  parseMarketSelection,
  readVisitorMarket,
  withMarketRpcFallback,
} from "@/lib/market";
import { OPS_UNLOCK_KEY } from "@/lib/owner-ops.functions";
import { isOpsNext, lighthouseTabFromOpsNext } from "@/lib/client-note-link";
import {
  billingStartSearch,
  isBillingStartPath,
  parsePendingCheckoutFromSearch,
  pendingCheckoutFromNext,
  peekPendingCheckout,
  stashPendingCheckout,
} from "@/lib/pending-checkout";
import { checkoutIntentForUser } from "@/lib/billing-market";
import { firmSignupCheckoutIntent } from "@/lib/stripe-plans";
import { readInsightSeen } from "@/lib/funnel-timing";
import { isSmartLandingNext, SMART_LANDING_PATH } from "@/lib/smart-landing";
import { accessTokenFromNext } from "@/lib/practice-access";
import { callbackNextParam } from "@/lib/staff-invite-landing";
import { activeFirmIdForUser, listUserFirms } from "@/lib/firm-brand";
import {
  clearForcePortal,
  forcePortal,
  resolvePortalRoles,
  setPortalIntent,
  shouldOpenItInbox,
} from "@/lib/user-roles";
import {
  destinationAfterSignIn,
  loadSignInRoleSnapshot,
  resolveSignedInDestination,
} from "@/lib/landing-sign-in-destination";
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
  const doSendWelcome = useServerFn(sendSignupWelcome);
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
      // Email confirmation puts the staff invite on ?next=. That survives a new
      // tab. Session storage still covers a Google hop that kept the same origin.
      const next = callbackNextParam(window.location.search) ?? consumed.next;
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
      const joinToken =
        accountantJoinFromCallbackSearch(window.location.search) ||
        accountantJoinTokenFromNext(next) ||
        accountantInviteTokenFromPath(next ?? "");

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

      // Staff (and other) /access links must not mint a practice firm or stash
      // firm Checkout. The access page accepts the invite after this hop.
      const accessTok = accessTokenFromNext(next);
      if (accessTok) {
        setPortalIntent("accountant");
        forcePortal("accountant");
        if (!cancelled) {
          void navigate({ to: "/access/$token", params: { token: accessTok }, replace: true });
        }
        return;
      }

      const offerWelcome = signupWelcomeTrigger({
        fresh: isFreshAuthUser(user.created_at, Date.now(), WELCOME_FRESH_WINDOW_MS),
        ownerInvite: false,
        staffJoin: Boolean(joinToken),
      });

      if (intent === "owner") {
        // The landing modal stashes the owner door for Google. A practice
        // account (including one whose role rows are not visible yet) still
        // opens the practice workspace, and must not be given a business seat.
        const landingRoles = await loadSignInRoleSnapshot(
          user.id,
          user.user_metadata as Record<string, unknown> | undefined,
        );
        if (destinationAfterSignIn(landingRoles, "landing") === "/dashboard") {
          intent = "accountant";
        }
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
        if (offerWelcome) await welcomeWithoutBlockingSignup(() => doSendWelcome());
      } else {
        const draft = consumeAccountantGoogleSignup();
        const provisionPractice = isFreshAuthUser(user.created_at) || Boolean(draft);
        const firmName =
          draft?.firmName ||
          (typeof user.user_metadata?.firm_name === "string"
            ? user.user_metadata.firm_name.trim()
            : "") ||
          displayName;
        const fullName =
          draft?.fullName ||
          (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ||
          (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "") ||
          displayName;
        const market =
          (draft?.marketCountry
            ? parseMarketSelection({
                country: draft.marketCountry,
                regionCode: draft.marketRegion ?? null,
              })
            : null) ?? readVisitorMarket();
        if (provisionPractice) {
          try {
            await supabase.auth.updateUser({
              data: {
                signup_type: "accountant",
                firm_name: firmName,
                full_name: fullName,
                ...(market
                  ? { market_country: market.country, market_region: market.regionCode }
                  : {}),
              },
            });
          } catch {
            /* metadata stamp is best-effort */
          }
          const { error: firmErr } = await withMarketRpcFallback(
            () =>
              supabase.rpc("ensure_practice_firm", {
                p_name: firmName,
                p_market: market ? marketToJson(market) : null,
              }),
            () => supabase.rpc("ensure_practice_firm", { p_name: firmName }),
          );
          if (firmErr) console.error("[google] ensure_practice_firm failed:", firmErr.message);
        }
        await ensurePractice().catch(() => undefined);
        if (isFreshAuthUser(user.created_at)) {
          notifySignup("Accountant firm (Google)", user.email ?? "", displayName);
        }
        if (offerWelcome) await welcomeWithoutBlockingSignup(() => doSendWelcome());
      }

      if (joinToken) {
        forcePortal("accountant");
        if (!cancelled) {
          void navigate({
            to: "/join/$token",
            params: { token: joinToken },
            replace: true,
          });
        }
        return;
      }

      let pendingCheckout =
        parsePendingCheckoutFromSearch(window.location.search) ||
        pendingCheckoutFromNext(next) ||
        peekPendingCheckout();
      if (!pendingCheckout && intent === "accountant" && isFreshAuthUser(user.created_at)) {
        pendingCheckout = firmSignupCheckoutIntent(
          readVisitorMarket()?.country === "ZA" ? "za" : "us",
        );
      }
      if (pendingCheckout) {
        pendingCheckout = await checkoutIntentForUser(
          user.id,
          pendingCheckout,
          pendingCheckout.market,
        );
        stashPendingCheckout(pendingCheckout);
      }
      // The welcome link asked for the product, not Checkout.
      if (isSmartLandingNext(next)) {
        if (!cancelled) void navigate({ to: SMART_LANDING_PATH, replace: true });
        return;
      }
      // Checkout after insight. A fresh Solo stash still lands in the workspace.
      if (pendingCheckout && readInsightSeen(await activeFirmIdForUser(user.id))) {
        if (!cancelled) {
          void navigate({
            to: "/billing/start",
            search: billingStartSearch(pendingCheckout),
            replace: true,
          });
        }
        return;
      }

      let goOps = false;
      try {
        goOps = sessionStorage.getItem(OPS_UNLOCK_KEY) === "1";
      } catch {
        /* ignore */
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
        path = await resolveSignedInDestination(user.id, {
          door: intent === "accountant" ? "accountant" : "landing",
          knownMeta: user.user_metadata as Record<string, unknown> | undefined,
        });
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
  }, [doAcceptOwnerInvite, doSendWelcome, ensurePractice, navigate]);

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
