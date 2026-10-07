import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
import {
  billingStartPath,
  billingStartSearch,
  parsePendingCheckout,
  registerLabelForPlan,
  stashPendingCheckout,
  type PendingCheckout,
} from "@/lib/pending-checkout";
import {
  FIRM_BAND_CATALOG,
  firmUsdListPrice,
  firmSignupCheckoutIntent,
  FIRM_TRIAL_SENTENCE,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

export const Route = createFileRoute("/billing/required")({
  validateSearch: (search: Record<string, unknown>): PendingCheckout => {
    return parsePendingCheckout(search) ?? firmSignupCheckoutIntent();
  },
  component: BillingRequiredPage,
  head: () => ({
    meta: [
      { title: "Finish firm billing — Milōn" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function priceLabel(plan: FirmCheckoutBand, interval: FirmInterval): string {
  const amount = firmUsdListPrice(plan, interval);
  if (!amount) return FIRM_BAND_CATALOG[plan].name;
  return interval === "year" ? `${amount}/yr` : `${amount}/mo`;
}

function BillingRequiredPage() {
  const pending = Route.useSearch();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    stashPendingCheckout(pending);
  }, [pending]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({
        to: "/auth",
        search: { next: billingStartPath(pending), signup: true },
        replace: true,
      });
      return;
    }
    let cancelled = false;
    void checkEntitlement({ data: { refresh: true } })
      .then((result) => {
        if (cancelled) return;
        if (result.entitled) {
          void navigate({ to: "/dashboard", replace: true });
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user, pending, navigate, checkEntitlement]);

  const planName = registerLabelForPlan(pending.plan);

  if (loading || checking || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
          <h1 className="mt-2 text-xl font-semibold">Checking firm billing…</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
        <h1 className="mt-2 text-xl font-semibold">Continue on {planName} to keep this practice</h1>
        <p className="mt-2 text-sm text-slate-400">
          The figures stay. Checkout for {planName} ({priceLabel(pending.plan, pending.interval)})
          starts the subscription. A card is required. A first subscription includes a{" "}
          {FIRM_TRIAL_SENTENCE}. If a trial already ended, billing resumes on the paid band without
          another trial. Owner Spark stays free.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/billing/start"
            search={billingStartSearch(pending)}
            className="inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
          >
            Resume Checkout
          </Link>
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
          >
            Back to pricing
          </Link>
        </div>
      </div>
    </div>
  );
}
