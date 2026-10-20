import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { firmBillingResumeIntent } from "@/lib/billing-market";
import {
  billingStartSearch,
  peekPendingCheckout,
  stashPendingCheckout,
} from "@/lib/pending-checkout";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
import { applyPortalTheme, resolvePortalTheme } from "@/lib/portal-theme";
import { loadFirmClientGateContext } from "@/lib/firm-client-gate";
import { decideFirmBillingPathGate, isFirmProductPath } from "@/lib/stripe-entitlement";
import { readInsightSeen } from "@/lib/funnel-timing";
import {
  shouldStayOnAccountantPortal,
  setPortalIntent,
  clearForcePortal,
  isMilonItMember,
  markAccountantPortalOpen,
  peekAccountantStay,
} from "@/lib/user-roles";
import { FirmBillingAccessProvider } from "@/contexts/firm-billing-access";
import { useAnalytics } from "@/contexts/analytics";
import { BootSkeleton } from "@/components/primitives/skeleton-blocks";
import { reportClientError } from "@/lib/monitoring";
import { measureBootstrap } from "@/lib/bootstrap-perf";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

function FirmShellLoading() {
  return <BootSkeleton />;
}

export function AuthGate() {
  const { user, loading } = useAuth();
  const { firmId, brandLoading, firmMarket, hasFirm } = useAccountantProfile();
  const { track } = useAnalytics();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const entitledRef = useRef(false);
  const failedOpenRef = useRef(false);
  const gatedUserRef = useRef<string | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  // Session restore replaces the user object (getSession and onAuthStateChange
  // both call setSession). Reading these here keeps that identity change, and
  // brandLoading / firmId, from cancelling the in-flight check.
  const latest = useRef({
    firmId,
    firmMarket,
    hasFirm,
    brandLoading,
    pathname,
    navigate,
    checkEntitlement,
  });
  latest.current = {
    firmId,
    firmMarket,
    hasFirm,
    brandLoading,
    pathname,
    navigate,
    checkEntitlement,
  };
  const userId = user?.id ?? null;
  const [firmEntitled, setFirmEntitled] = useState<boolean | null>(null);
  const [firmGate, setFirmGate] = useState<"idle" | "checking" | "allow">(() =>
    userId && peekAccountantStay(userId) === true ? "allow" : "idle",
  );

  useLayoutEffect(() => {
    applyPortalTheme(resolvePortalTheme());
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: {} });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (loading || !userId) return;
    if (gatedUserRef.current !== userId) {
      gatedUserRef.current = userId;
      entitledRef.current = false;
      failedOpenRef.current = false;
    }
    if (!isFirmProductPath(pathname)) {
      setFirmGate("allow");
      return;
    }
    if (entitledRef.current) {
      setFirmGate("allow");
      return;
    }

    let cancelled = false;
    // Already opened after a hang: keep the app up, but still finish the check
    // so an owner session can redirect to /app.
    const knownStay = peekAccountantStay(userId) === true;
    if (!failedOpenRef.current && !knownStay) setFirmGate("checking");

    const openBilling = () => {
      // Shell paints before Stripe. The greeting comes from the session and
      // the firm row. Entitlement, the client-count gate, and IT confirmation
      // continue after the outlet is up. Server routes still enforce billing.
      void (async () => {
        if (cancelled) return;
        if (await isMilonItMember(userId)) {
          if (cancelled) return;
          entitledRef.current = true;
          setFirmEntitled(true);
          return;
        }
        if (entitledRef.current) {
          setFirmEntitled(true);
          return;
        }
        let entitled = false;
        try {
          const result = await latest.current.checkEntitlement({ data: {} });
          if (cancelled) return;
          entitled = result.entitled;
          if (entitled) {
            entitledRef.current = true;
            setFirmEntitled(true);
            return;
          }
        } catch {
          if (cancelled) return;
        }
        const clients = await loadFirmClientGateContext();
        if (cancelled) return;
        const snap = latest.current;
        const firmId = snap.firmId;
        const gate = decideFirmBillingPathGate({
          pathname: snap.pathname,
          isAccountantFirmUser: true,
          isMilonItMember: false,
          entitled,
          insightSeen: clients.firmClientCount === 0 ? false : readInsightSeen(firmId),
          firmClientCount: clients.firmClientCount,
          firstClientId: clients.firstClientId,
        });
        if (cancelled) return;
        if (gate === "allow") {
          setFirmEntitled(false);
          return;
        }
        if (!isFirmProductPath(latest.current.pathname)) return;
        const pending = snap.hasFirm
          ? firmBillingResumeIntent(snap.firmMarket, peekPendingCheckout())
          : (peekPendingCheckout() ?? firmBillingResumeIntent(null, null));
        stashPendingCheckout(pending);
        latest.current.navigate({
          to: "/billing/required",
          search: billingStartSearch(pending),
          replace: true,
        });
      })();
    };

    const failOpen = (reason: "timeout" | "error") => {
      if (cancelled || failedOpenRef.current) return;
      failedOpenRef.current = true;
      const path = latest.current.pathname;
      console.warn(
        "[billing-gate] check did not finish; opening the app. Server-side billing still applies.",
        { reason, path },
      );
      reportClientError(new Error(`billing gate ${reason}`), {
        source: "billing-gate",
        extra: { reason, pathname: path },
      });
      trackRef.current("billing_gate_timeout", {
        path,
        surface: "accountant_portal",
        reason,
      });
      markAccountantPortalOpen(userId);
      setFirmGate("allow");
      measureBootstrap("shell");
    };

    if (knownStay) {
      setFirmGate("allow");
      measureBootstrap("shell");
      openBilling();
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => failOpen("timeout"), SHELL_GATE_TIMEOUT_MS);

    void (async () => {
      try {
        const stay = await shouldStayOnAccountantPortal(userId);
        if (cancelled) return;
        if (!stay) {
          window.clearTimeout(timer);
          clearForcePortal();
          setPortalIntent("owner");
          latest.current.navigate({ to: "/app" });
          return;
        }
        window.clearTimeout(timer);
        setFirmGate("allow");
        measureBootstrap("shell");
        openBilling();
      } catch (err) {
        if (cancelled) return;
        console.warn("[billing-gate] check failed", err);
        window.clearTimeout(timer);
        failOpen("error");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, loading, pathname]);

  if (loading) {
    return <FirmShellLoading />;
  }
  if (!user) return null;
  if (isFirmProductPath(pathname) && firmGate !== "allow") {
    // Same skeleton the route already painted. A one-bar pulse here was the
    // blank body between "Loading dashboard…" and the card frames.
    return (
      <div data-billing-gate="pending" aria-busy="true">
        <FirmShellLoading />
      </div>
    );
  }
  return (
    <FirmBillingAccessProvider entitled={firmEntitled}>
      <Suspense fallback={<FirmShellLoading />}>
        <Outlet />
      </Suspense>
    </FirmBillingAccessProvider>
  );
}
