import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
} from "@/lib/user-roles";
import { FirmBillingAccessProvider } from "@/contexts/firm-billing-access";

function FirmShellLoading() {
  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground">Loading…</div>
  );
}

export function AuthGate() {
  const { user, loading } = useAuth();
  const { firmId, brandLoading, firmMarket, hasFirm } = useAccountantProfile();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const entitledRef = useRef(false);
  const [firmEntitled, setFirmEntitled] = useState<boolean | null>(null);
  const [firmGate, setFirmGate] = useState<"idle" | "checking" | "allow">("idle");

  useLayoutEffect(() => {
    applyPortalTheme(resolvePortalTheme());
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: {} });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user || loading) return;
    if (!isFirmProductPath(pathname)) {
      setFirmGate("allow");
      return;
    }
    if (brandLoading) {
      if (!entitledRef.current) setFirmGate("checking");
      return;
    }
    let cancelled = false;
    if (!entitledRef.current) setFirmGate("checking");
    void (async () => {
      const stay = await shouldStayOnAccountantPortal(user.id);
      if (cancelled) return;
      if (!stay) {
        clearForcePortal();
        setPortalIntent("owner");
        navigate({ to: "/app" });
        return;
      }
      if (await isMilonItMember(user.id)) {
        if (!cancelled) {
          entitledRef.current = true;
          setFirmEntitled(true);
          setFirmGate("allow");
        }
        return;
      }
      if (entitledRef.current) {
        setFirmEntitled(true);
        setFirmGate("allow");
        return;
      }
      let entitled = false;
      try {
        const result = await checkEntitlement({ data: {} });
        if (cancelled) return;
        entitled = result.entitled;
        if (entitled) {
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
      const gate = decideFirmBillingPathGate({
        pathname,
        isAccountantFirmUser: true,
        isMilonItMember: false,
        entitled,
        insightSeen: clients.firmClientCount === 0 ? false : readInsightSeen(firmId),
        firmClientCount: clients.firmClientCount,
        firstClientId: clients.firstClientId,
      });
      if (gate === "allow") {
        setFirmEntitled(false);
        setFirmGate("allow");
        return;
      }
      const pending = hasFirm
        ? firmBillingResumeIntent(firmMarket, peekPendingCheckout())
        : peekPendingCheckout() ?? firmBillingResumeIntent(null, null);
      stashPendingCheckout(pending);
      navigate({
        to: "/billing/required",
        search: billingStartSearch(pending),
        replace: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, pathname, navigate, checkEntitlement, firmId, brandLoading, firmMarket, hasFirm]);

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
