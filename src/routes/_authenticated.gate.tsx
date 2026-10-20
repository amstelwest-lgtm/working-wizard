import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
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
import { loadFirmClientGateContext, type FirmClientGateContext } from "@/lib/firm-client-gate";
import { decideFirmBillingPathGate, isFirmProductPath } from "@/lib/stripe-entitlement";
import { pageWhileEntitlementUnknown } from "@/lib/firm-gate-access";
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
import { clearCachedFirmEntitlement, readCachedFirmEntitlement } from "@/lib/firm-entitlement-client";

type EntitlementResult = { entitled: boolean; reason?: string };

type GateSnap = {
  firmId: string | null;
  firmMarket: unknown;
  hasFirm: boolean;
  firmCount: number;
  firmsLoaded: boolean;
  pathname: string;
  navigate: ReturnType<typeof useNavigate>;
  checkEntitlement: (input: { data: { refresh?: boolean } }) => Promise<EntitlementResult>;
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
  const { user, loading } = useAuth();
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
  const [clientGate, setClientGate] = useState<FirmClientGateContext | null>(null);
  const [gateAttempt, setGateAttempt] = useState(0);

  useLayoutEffect(() => {
    applyPortalTheme(resolvePortalTheme());
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: {} });
  }, [user, loading, navigate]);

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
    settledRef.current = null;
    setFirmEntitled(null);
    setBillingUnknown(false);
    setClientGate(null);
  }, [userId]);

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

    const noteUnknown = (reason: "timeout" | "error") => {
      if (cancelled || settledRef.current) return;
      const path = latest.current.pathname;
      console.warn(
        "[billing-gate] couldn't check billing. Gated client pages show Retry. Home stays open.",
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
      setFirmEntitled(null);
      setBillingUnknown(true);
    };

    const timer = window.setTimeout(() => noteUnknown("timeout"), SHELL_GATE_TIMEOUT_MS);

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
            if (!cancelled) setClientGate(clients);
          })
          .catch(() => {
            // The entitlement path below reports this rejection. Without this
            // catch the floating then still rejects with no handler.
          });
        const entitlementPromise = readCachedFirmEntitlement(
          userId,
          (input) => latest.current.checkEntitlement(input),
          gateAttempt > 0,
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
          return;
        }
        const [clients, result] = await Promise.all([clientsPromise, entitlementPromise]);
        if (cancelled) return;
        window.clearTimeout(timer);
        const reason =
          result && typeof result === "object" && "reason" in result && typeof result.reason === "string"
            ? result.reason
            : result.entitled
              ? "active_subscription"
              : "no_active_subscription";
        settledRef.current = { entitled: result.entitled === true, reason, clients };
        if (reason === "stripe_error") {
          noteUnknown("error");
          return;
        }
        setBillingUnknown(false);
        if (result.entitled === true) {
          setFirmEntitled(true);
          return;
        }
        setFirmEntitled(false);
        resumeUnpaidFirm(latest.current, clients);
      } catch (err) {
        if (cancelled) return;
        console.warn("[billing-gate] check failed", err);
        window.clearTimeout(timer);
        noteUnknown("error");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, loading, gateAttempt]);

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
  const holdGatedPage = firmEntitled !== true && unknownPage === "wall";
  if (holdGatedPage && billingUnknown) {
    return (
      <div
        className="bg-background px-6 py-8 text-foreground"
        data-billing-gate="pending"
        role="alert"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
        <h1 className="mt-2 text-xl font-semibold">Couldn't check billing</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This client file stays closed until the plan check finishes. Home, the client list, settings,
          and billing stay open.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              clearCachedFirmEntitlement();
              setBillingUnknown(false);
              setGateAttempt((n) => n + 1);
            }}
            className="inline-flex h-10 items-center rounded-full bg-foreground px-4 text-xs font-bold uppercase tracking-wider text-background"
          >
            Retry
          </button>
          <Link to="/dashboard" className="inline-flex h-10 items-center px-4 text-sm underline">
            Back
          </Link>
        </div>
      </div>
    );
  }
  if (holdGatedPage) {
    return <FirmShellLoading />;
  }
  return (
    <FirmBillingAccessProvider entitled={firmEntitled}>
      <Outlet />
    </FirmBillingAccessProvider>
  );
}
