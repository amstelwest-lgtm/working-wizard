import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import {
  billingStartSearch,
  peekPendingCheckout,
  stashPendingCheckout,
} from "@/lib/pending-checkout";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
import { isFirmProductPath } from "@/lib/stripe-entitlement";
import { starterCheckoutIntent } from "@/lib/stripe-plans";
import {
  shouldStayOnAccountantPortal,
  setPortalIntent,
  clearForcePortal,
  isMilonItMember,
} from "@/lib/user-roles";

export const Route = createFileRoute("/_authenticated")({
  component: AuthGate,
});

function AuthGate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const entitledRef = useRef(false);
  const [firmGate, setFirmGate] = useState<"idle" | "checking" | "allow">("idle");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: {} });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user || loading) return;
    if (!isFirmProductPath(pathname)) {
      setFirmGate("allow");
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
          setFirmGate("allow");
        }
        return;
      }
      if (entitledRef.current) {
        setFirmGate("allow");
        return;
      }
      try {
        const result = await checkEntitlement({ data: {} });
        if (cancelled) return;
        if (result.entitled) {
          entitledRef.current = true;
          setFirmGate("allow");
          return;
        }
      } catch {
        if (cancelled) return;
      }
      const pending = peekPendingCheckout() ?? starterCheckoutIntent();
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
  }, [user, loading, pathname, navigate, checkEntitlement]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return null;
  if (isFirmProductPath(pathname) && firmGate !== "allow") {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        Checking billing…
      </div>
    );
  }
  return <Outlet />;
}
