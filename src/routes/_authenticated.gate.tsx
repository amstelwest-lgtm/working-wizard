import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { shouldRedirectToAuth } from "@/lib/auth-session-guard";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { firmBillingResumeIntent } from "@/lib/billing-market";
import {
  billingStartSearch,
  peekPendingCheckout,
  stashPendingCheckout,
} from "@/lib/pending-checkout";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
import { applyPortalTheme, resolvePortalTheme } from "@/lib/portal-theme";
import { loadFirmClientGateContext, type FirmClientGateContext } from "@/lib/firm-client-gate";
import { decideFirmBillingPathGate, isFirmProductPath } from "@/lib/stripe-entitlement";
import {
  pageWhileEntitlementUnknown,
  skeletonAfterBillingDeadline,
  surfaceAfterBillingCheckFailure,
} from "@/lib/firm-gate-access";
import {
  billingCheckNoticeVisible,
  billingCheckRetryDelayMs,
  classifyBillingCheckFailure,
  type BillingCheckFailureKind,
  logBillingCheckFailure,
} from "@/lib/billing-check-failure";
import { FirmBillingGateView } from "@/components/firm-billing-gate-view";
import { readInsightSeen } from "@/lib/funnel-timing";
import {
  shouldStayOnAccountantPortal,
  setPortalIntent,
  clearForcePortal,
  isMilonItMember,
} from "@/lib/user-roles";
import { FirmBillingAccessProvider } from "@/contexts/firm-billing-access";
import { useAnalytics } from "@/contexts/analytics";
import { BootSkeleton } from "@/components/primitives/skeleton-blocks";
import { reportClientError } from "@/lib/monitoring";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { redirectAccountantWithoutFirm } from "@/lib/google-practice-market";
import {
  clearCachedFirmEntitlement,
  lastKnownEntitlementForFirm,
  readCachedFirmEntitlement,
} from "@/lib/firm-entitlement-client";

type EntitlementResult = {
  entitled: boolean;
  reason?: string;
  checkFailed?: BillingCheckFailureKind;
};

type GateSnap = {
  firmId: string | null;
  firmMarket: unknown;
  hasFirm: boolean;
  firmCount: number;
  firmsLoaded: boolean;
  pathname: string;
  navigate: ReturnType<typeof useNavigate>;
  checkEntitlement: (input: {
    data: { refresh?: boolean; firmId?: string | null };
  }) => Promise<EntitlementResult>;
  practiceMeta: unknown;
};

type SettledEntitlement = {
  entitled: boolean;
  reason: string;
  clients: FirmClientGateContext;
};

function FirmShellLoading() {
  return <BootSkeleton />;
}

/**
 * A confirmed unpaid firm leaves a gated client route. Home, the client
 * list, settings, and billing stay. The outlet is already mounted.
 */
function resumeUnpaidFirm(snap: GateSnap, clients: FirmClientGateContext) {
  const firmId = snap.firmId;
  const gate = decideFirmBillingPathGate({
    pathname: snap.pathname,
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: clients.firmClientCount === 0 ? false : readInsightSeen(firmId),
    firmClientCount: clients.firmClientCount,
    firstClientId: clients.firstClientId,
  });
  if (gate === "allow") return;
  if (!isFirmProductPath(snap.pathname)) return;
  const pending = snap.hasFirm
    ? firmBillingResumeIntent(snap.firmMarket, peekPendingCheckout())
    : (peekPendingCheckout() ?? firmBillingResumeIntent(null, null));
  stashPendingCheckout(pending);
  snap.navigate({
    to: "/billing/required",
    search: billingStartSearch(pending),
    replace: true,
  });
}

export function AuthGate() {
  const { user, loading, restoreFailed } = useAuth();
  const { firmId, firmMarket, hasFirm, firms, firmsLoaded } = useAccountantProfile();
  const { track } = useAnalytics();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const settledRef = useRef<SettledEntitlement | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  // Session restore replaces the user object. Keying the check on the id
  // keeps that identity change from cancelling the in-flight read.
  const firmCount = firms.length;
  const latest = useRef<GateSnap>({
    firmId,
    firmMarket,
    hasFirm,
    firmCount,
    firmsLoaded,
    pathname,
    navigate,
    checkEntitlement,
    practiceMeta: user?.user_metadata,
  });
  latest.current = {
    firmId,
    firmMarket,
    hasFirm,
    firmCount,
    firmsLoaded,
    pathname,
    navigate,
    checkEntitlement,
    practiceMeta: user?.user_metadata,
  };
  const userId = user?.id ?? null;
  const [firmEntitled, setFirmEntitled] = useState<boolean | null>(null);
  const [billingUnknown, setBillingUnknown] = useState(false);
  /** The 8s check already gave up. A later walled page must not wait on Stripe. */
  const [billingDeadlinePassed, setBillingDeadlinePassed] = useState(false);
  const [checkNotice, setCheckNotice] = useState(false);
  const [showWall, setShowWall] = useState(false);
  const [clientGate, setClientGate] = useState<FirmClientGateContext | null>(null);
  const [gateAttempt, setGateAttempt] = useState(0);
  const [quietAttempt, setQuietAttempt] = useState(0);
  const failuresRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const clientGateRef = useRef<FirmClientGateContext | null>(null);
  const pendingWallRef = useRef(false);

  useLayoutEffect(() => {
    applyPortalTheme(resolvePortalTheme());
  }, []);

  useEffect(() => {
    if (!shouldRedirectToAuth({ loading, hasUser: !!user, restoreFailed })) return;
    navigate({ to: "/auth", search: {} });
  }, [user, loading, restoreFailed, navigate]);

  // Practice metadata with no firm is the abandoned location picker. Stay on
  // the callback until a market is chosen. Do not leave them on an empty practice.
  useEffect(() => {
    if (loading || !user) return;
    const meta = user.user_metadata as { signup_type?: string; firm_name?: string } | undefined;
    if (
      !redirectAccountantWithoutFirm({
        firmsLoaded,
        signupType: meta?.signup_type,
        firmName: meta?.firm_name,
        firmCount,
      })
    ) {
      return;
    }
    navigate({ to: "/auth/callback", replace: true });
  }, [loading, user, firmsLoaded, firmCount, navigate]);

  // The previous account's entitlement must not paint the next sign-in.
  useEffect(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    pendingWallRef.current = false;
    clientGateRef.current = null;
    settledRef.current = null;
    setBillingDeadlinePassed(false);
    setFirmEntitled(null);
    setBillingUnknown(false);
    setCheckNotice(false);
    setShowWall(false);
    setClientGate(null);
    failuresRef.current = 0;
  }, [userId]);

  // A remount starts unknown. The tab's last success for this firm paints
  // before the next Stripe read, so a timeout cannot replace the page.
  useEffect(() => {
    if (!userId) return;
    const known = lastKnownEntitlementForFirm(userId, firmId);
    if (!known?.entitled) return;
    setFirmEntitled(true);
  }, [userId, firmId]);

  // Known unpaid: correct the route the moment they open a gated client file.
  useEffect(() => {
    const settled = settledRef.current;
    if (!settled || settled.entitled || settled.reason !== "no_active_subscription") return;
    resumeUnpaidFirm(latest.current, settled.clients);
  }, [pathname, firmEntitled]);

  useEffect(() => {
    if (loading || !userId) return;
    let cancelled = false;
    settledRef.current = null;
    setClientGate(null);
    setBillingDeadlinePassed(false);

    const knownKind = () => {
      const known = lastKnownEntitlementForFirm(userId, latest.current.firmId);
      if (!known) return "none" as const;
      return known.entitled ? ("entitled" as const) : ("unpaid" as const);
    };

    let reported = false;
    const noteFailure = (kind: BillingCheckFailureKind) => {
      if (cancelled || settledRef.current) return;
      const path = latest.current.pathname;
      const known = knownKind();
      logBillingCheckFailure(kind, { known, path });
      if (reported) return;
      reported = true;
      // Remember the deadline even when this pathname is Home. Opening a
      // later client file must show Retry, not sit on the skeleton, unless
      // this firm already has a known plan.
      setBillingDeadlinePassed(true);
      const clients = clientGateRef.current;
      const surface = surfaceAfterBillingCheckFailure({
        known,
        pathname: path,
        firmClientCount: clients?.firmClientCount ?? null,
        firstClientId: clients?.firstClientId ?? null,
      });
      // A known plan for this firm opens the page. A failed check is not the wall.
      if (surface === "content" && known !== "none") {
        setFirmEntitled(true);
        setBillingUnknown(false);
        setShowWall(false);
        failuresRef.current += 1;
        setCheckNotice(billingCheckNoticeVisible(failuresRef.current));
        if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setQuietAttempt((n) => n + 1);
        }, billingCheckRetryDelayMs(failuresRef.current));
        return;
      }
      if (surface === "content") {
        setBillingUnknown(false);
        return;
      }
      console.warn(
        "[billing-gate] couldn't check billing. Gated client pages show Retry. Home stays open.",
        { reason: kind, path },
      );
      reportClientError(new Error(`billing gate ${kind}`), {
        source: "billing-gate",
        extra: { reason: kind, pathname: path },
      });
      trackRef.current("billing_gate_timeout", {
        path,
        surface: "accountant_portal",
        reason: kind,
      });
      setFirmEntitled(null);
      setBillingUnknown(true);
      setCheckNotice(false);
    };

    const timer = window.setTimeout(() => noteFailure("timeout"), SHELL_GATE_TIMEOUT_MS);

    void (async () => {
      try {
        const practiceMeta = latest.current.practiceMeta as
          | { signup_type?: string; firm_name?: string }
          | undefined;
        if (
          redirectAccountantWithoutFirm({
            firmsLoaded: latest.current.firmsLoaded,
            signupType: practiceMeta?.signup_type,
            firmName: practiceMeta?.firm_name,
            firmCount: latest.current.firmCount,
          })
        ) {
          window.clearTimeout(timer);
          latest.current.navigate({ to: "/auth/callback", replace: true });
          return;
        }
        // Stay, the client count, and Stripe start together. The count is
        // what lets the first client file mount before Stripe answers.
        const stayPromise = shouldStayOnAccountantPortal(userId);
        const clientsPromise = loadFirmClientGateContext();
        void clientsPromise
          .then((clients) => {
            if (cancelled) return;
            clientGateRef.current = clients;
            setClientGate(clients);
            if (pendingWallRef.current) {
              pendingWallRef.current = false;
              resumeUnpaidFirm(latest.current, clients);
            }
          })
          .catch(() => {
            // The entitlement path below reports this rejection. Without this
            // catch the floating then still rejects with no handler.
          });
        const entitlementPromise = readCachedFirmEntitlement(
          userId,
          (input) =>
            latest.current.checkEntitlement({
              data: { ...input.data, firmId: latest.current.firmId },
            }),
          gateAttempt > 0 || quietAttempt > 0,
          latest.current.firmId,
        );
        const itPromise = isMilonItMember(userId);
        const stay = await stayPromise;
        if (cancelled) return;
        if (!stay) {
          window.clearTimeout(timer);
          clearForcePortal();
          setPortalIntent("owner");
          latest.current.navigate({ to: "/app" });
          return;
        }
        if (await itPromise) {
          if (cancelled) return;
          window.clearTimeout(timer);
          settledRef.current = {
            entitled: true,
            reason: "it",
            clients: { firmClientCount: 0, firstClientId: null },
          };
          setFirmEntitled(true);
          setBillingUnknown(false);
          failuresRef.current = 0;
          setCheckNotice(false);
          return;
        }
        const [clients, result] = await Promise.all([clientsPromise, entitlementPromise]);
        if (cancelled) return;
        window.clearTimeout(timer);
        clientGateRef.current = clients;
        const reason =
          result && typeof result === "object" && "reason" in result && typeof result.reason === "string"
            ? result.reason
            : result.entitled
              ? "active_subscription"
              : "no_active_subscription";
        const failed = reason === "stripe_error" || Boolean(result.checkFailed);
        if (failed) {
          noteFailure(result.checkFailed ?? classifyBillingCheckFailure(result));
          return;
        }
        if (retryTimerRef.current != null) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        pendingWallRef.current = false;
        setShowWall(false);
        failuresRef.current = 0;
        setCheckNotice(false);
        reported = true;
        settledRef.current = { entitled: result.entitled === true, reason, clients };
        setBillingUnknown(false);
        setBillingDeadlinePassed(false);
        if (result.entitled === true) {
          setFirmEntitled(true);
          return;
        }
        setFirmEntitled(false);
        resumeUnpaidFirm(latest.current, clients);
      } catch (err) {
        if (cancelled) return;
        window.clearTimeout(timer);
        noteFailure(classifyBillingCheckFailure(err));
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, loading, gateAttempt, quietAttempt]);

  if (loading) {
    return <FirmShellLoading />;
  }
  if (!user) return null;
  // Unknown entitlement does not mount a gated client file. Home, the client
  // list, settings, and billing stay open. The first client file may mount
  // once the count is known. A later file stays on the skeleton until Stripe
  // confirms a redirect, or until the check times out onto the Retry card.
  const unknownPage = pageWhileEntitlementUnknown({
    pathname,
    firmClientCount: clientGate?.firmClientCount ?? null,
    firstClientId: clientGate?.firstClientId ?? null,
  });
  const knownRecord = userId ? lastKnownEntitlementForFirm(userId, firmId) : null;
  const knownKind = !knownRecord ? "none" : knownRecord.entitled ? "entitled" : "unpaid";
  const failureSurface = billingUnknown
    ? surfaceAfterBillingCheckFailure({
        known: knownKind,
        pathname,
        firmClientCount: clientGate?.firmClientCount ?? null,
        firstClientId: clientGate?.firstClientId ?? null,
      })
    : null;
  const deadlineHoldsRetry = skeletonAfterBillingDeadline({
    deadlinePassed: billingDeadlinePassed,
    firmEntitled,
    unknownPage,
  });
  if (failureSurface === "error" || deadlineHoldsRetry) {
    return (
      <FirmBillingGateView
        surface="error"
        onRetry={() => {
          clearCachedFirmEntitlement();
          setBillingUnknown(false);
          setBillingDeadlinePassed(false);
          setGateAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (failureSurface === "wall" || showWall) {
    return <FirmBillingGateView surface="wall" />;
  }
  const holdGatedPage = firmEntitled !== true && unknownPage === "wall";
  if (holdGatedPage) {
    return (
      <FirmShellLoading />
    );
  }
  return (
    <FirmBillingAccessProvider entitled={firmEntitled}>
      <FirmBillingGateView surface="content" notice={checkNotice}>
        <Outlet />
      </FirmBillingGateView>
    </FirmBillingAccessProvider>
  );
}
