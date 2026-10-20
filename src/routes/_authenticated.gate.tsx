import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { firmBillingResumeIntent } from "@/lib/billing-market";
import { marketForFirm } from "@/lib/market";
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
} from "@/lib/user-roles";
import { FirmBillingAccessProvider } from "@/contexts/firm-billing-access";
import { useAnalytics } from "@/contexts/analytics";
import { BootSkeleton } from "@/components/primitives/skeleton-blocks";
import { reportClientError } from "@/lib/monitoring";
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
  const [firmGate, setFirmGate] = useState<"idle" | "checking" | "allow">("idle");

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
    if (!failedOpenRef.current) setFirmGate("checking");

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
      setFirmGate("allow");
    };

    const started = Date.now();
    const timer = window.setTimeout(() => failOpen("timeout"), SHELL_GATE_TIMEOUT_MS);

    void (async () => {
      try {
        const deadline = started + SHELL_GATE_TIMEOUT_MS;
        while (latest.current.brandLoading && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (cancelled) return;
        }
        const stay = await shouldStayOnAccountantPortal(userId);
        if (cancelled) return;
        if (!stay) {
          window.clearTimeout(timer);
          clearForcePortal();
          setPortalIntent("owner");
          latest.current.navigate({ to: "/app" });
          return;
        }
        if (await isMilonItMember(userId)) {
          if (cancelled) return;
          window.clearTimeout(timer);
          entitledRef.current = true;
          setFirmEntitled(true);
          setFirmGate("allow");
          return;
        }
        if (entitledRef.current) {
          window.clearTimeout(timer);
          setFirmEntitled(true);
          setFirmGate("allow");
          return;
        }
        let entitled = false;
        try {
          const result = await latest.current.checkEntitlement({ data: {} });
          if (cancelled) return;
          entitled = result.entitled;
          if (entitled) {
            window.clearTimeout(timer);
            entitledRef.current = true;
            setFirmEntitled(true);
            setFirmGate("allow");
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
        window.clearTimeout(timer);
        if (gate === "allow") {
          setFirmEntitled(false);
          setFirmGate("allow");
          return;
        }
        if (!isFirmProductPath(latest.current.pathname)) return;
        const pending = snap.hasFirm
          ? firmBillingResumeIntent(
              marketForFirm({ market: snap.firmMarket }),
              peekPendingCheckout(),
            )
          : (peekPendingCheckout() ?? firmBillingResumeIntent(null, null));
        stashPendingCheckout(pending);
        latest.current.navigate({
          to: "/billing/required",
          search: billingStartSearch(pending),
          replace: true,
        });
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
    return (
      <div
        className="bg-background px-6 py-8 text-foreground"
        data-billing-gate="pending"
        aria-busy="true"
      >
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  return (
    <FirmBillingAccessProvider entitled={firmEntitled}>
      <Outlet />
    </FirmBillingAccessProvider>
  );
}
