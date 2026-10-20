import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { noteFirmEntitlement } from "@/lib/firm-entitlement-client";
import { useServerFn } from "@tanstack/react-start";
import {
  getCheckoutSessionStatus,
  getFirmBillingEntitlement,
} from "@/lib/stripe-checkout.functions";
import { checkoutSessionUnlocksFirm } from "@/lib/stripe-entitlement";
import { ownerPlanPublicLine } from "@/lib/owner-plan";
import { readSaPricingCopy } from "@/lib/pricing/za-pricing.functions";
import { ownerCheckoutReturnCopy } from "@/lib/owner-subscribe";
import { FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "@/lib/stripe-plans";

export const Route = createFileRoute("/billing/success")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => {
    const session_id =
      typeof search.session_id === "string" && search.session_id.startsWith("cs_")
        ? search.session_id
        : undefined;
    return session_id ? { session_id } : {};
  },
  component: BillingSuccessPage,
  head: () => ({
    meta: [{ title: "Payment received — Milōn" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function BillingSuccessPage() {
  const { user } = useAuth();
  const { session_id: sessionId } = Route.useSearch();
  const loadStatus = useServerFn(getCheckoutSessionStatus);
  const loadSaPricing = useServerFn(readSaPricingCopy);
  const refreshEntitlement = useServerFn(getFirmBillingEntitlement);
  const [label, setLabel] = useState("Checking Stripe…");
  const [unlocked, setUnlocked] = useState(false);
  const [ownerReturn, setOwnerReturn] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setLabel("Checkout finished. Open Stripe Dashboard if you need the receipt.");
      setUnlocked(true);
      void refreshEntitlement({ data: { refresh: true } })
        .then((result) => {
          if (user?.id) noteFirmEntitlement(user.id, result);
        })
        .catch(() => undefined);
      return;
    }
    let cancelled = false;
    void loadStatus({ data: { sessionId } })
      .then(async (result) => {
        if (cancelled) return;
        if (!result.ok) {
          setLabel("Checkout finished. Stripe status is not available on this deploy.");
          setUnlocked(true);
          return;
        }
        if (result.plan === "owner") {
          setOwnerReturn(true);
          setLabel(ownerCheckoutReturnCopy("success"));
          return;
        }
        if (checkoutSessionUnlocksFirm(result)) {
          const pricing = await loadSaPricing().catch(() => null);
          const ownerLine = pricing?.ownerMonthly
            ? ownerPlanPublicLine("za", pricing.ownerMonthly)
            : ownerPlanPublicLine("us");
          setLabel(
            `Checkout is complete and your card is on file. A first firm subscription is ${FIRM_TRIAL_SENTENCE} on Starter. ${FIRM_TRIAL_CARD_NOTE} Then the Starter price applies. Owner plan: ${ownerLine}.`,
          );
          setUnlocked(true);
          void refreshEntitlement({ data: { refresh: true } })
            .then((result) => {
              if (user?.id) noteFirmEntitlement(user.id, result);
            })
            .catch(() => undefined);
          return;
        }
        setLabel(`Stripe session status: ${result.status ?? "unknown"}.`);
      })
      .catch(() => {
        if (!cancelled) {
          setLabel("Checkout finished. We could not confirm the session from here.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadStatus, loadSaPricing, refreshEntitlement, user?.id]);

  if (ownerReturn) {
    return (
      <div className="grid min-h-screen place-items-center bg-white px-4 text-[#102a43]">
        <div className="w-full max-w-md">
          <h1 className="text-xl font-semibold">Payment received</h1>
          <p className="mt-2 text-base">{label}</p>
          <Link
            to="/app"
            search={{ screen: "plan", checkout: "success" }}
            className="mt-5 inline-flex h-10 items-center rounded-full bg-[#0b5fff] px-4 text-sm font-semibold text-white"
          >
            Back to your plan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
        <h1 className="mt-2 text-xl font-semibold">Payment received</h1>
        <p className="mt-2 text-sm text-slate-400">{label}</p>
        <Link
          to="/dashboard"
          className="mt-5 inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#102A43]"
        >
          {unlocked ? "Open your practice" : "Open your workspace"}
        </Link>
      </div>
    </div>
  );
}
