import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BillingSignOutButton } from "@/components/billing-sign-out";
import { useAuth } from "@/hooks/use-auth";
import { createStripeCheckout } from "@/lib/stripe-checkout.functions";
import { readSaPricingCopy } from "@/lib/pricing/za-pricing.functions";
import {
  billingStartPath,
  consumePendingCheckout,
  parsePendingCheckout,
  registerLabelForPlan,
  stashPendingCheckout,
  type PendingCheckout,
} from "@/lib/pending-checkout";
import {
  FIRM_BAND_CATALOG,
  FIRM_TRIAL_SENTENCE,
  firmSignupCheckoutIntent,
  firmUsdListPrice,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

export const Route = createFileRoute("/billing/start")({
  validateSearch: (search: Record<string, unknown>) => {
    const pending = parsePendingCheckout(search) ?? firmSignupCheckoutIntent();
    return { ...pending, hold: search.hold === "1" || search.hold === 1 || search.hold === true };
  },
  loader: async () => {
    const saPricing = await readSaPricingCopy();
    return { saPricing };
  },
  component: BillingStartPage,
  head: () => ({
    meta: [
      { title: "Start subscription — Milōn" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function priceLabel(
  plan: FirmCheckoutBand,
  interval: FirmInterval,
  saPricing: { labels: Partial<Record<string, { month: string; year: string }>> } | null,
): string {
  const local = saPricing?.labels?.[plan]?.[interval];
  if (local) return local;
  const amount = firmUsdListPrice(plan, interval);
  if (!amount) return FIRM_BAND_CATALOG[plan].name;
  return interval === "year" ? `${amount}/yr` : `${amount}/mo`;
}

function BillingStartPage() {
  const search = Route.useSearch();
  const pending: PendingCheckout = {
    plan: search.plan,
    interval: search.interval,
    market: search.market,
    promo: search.promo,
  };
  const hold = search.hold;
  const { saPricing } = Route.useLoaderData();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const startCheckout = useServerFn(createStripeCheckout);
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    stashPendingCheckout(pending);
  }, [pending.plan, pending.interval, pending.market, pending.promo]);

  useEffect(() => {
    if (import.meta.env.DEV && hold) return;
    if (loading) return;
    if (!user) {
      void navigate({
        to: "/auth",
        search: { next: billingStartPath(pending), signup: true },
        replace: true,
      });
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    void startCheckout({
      data: {
        plan: pending.plan,
        interval: pending.interval,
        market: pending.market,
        promo: pending.promo,
      },
    })
      .then(({ url }) => {
        if (startedRef.current === false) return;
        consumePendingCheckout();
        window.location.href = url;
      })
      .catch((ex: unknown) => {
        startedRef.current = false;
        setError(ex instanceof Error ? ex.message : "Could not start Stripe Checkout.");
      });
  }, [loading, user, pending.plan, pending.interval, pending.market, pending.promo, navigate, startCheckout, hold]);

  const planName = registerLabelForPlan(pending.plan);
  const shownPrice = priceLabel(pending.plan, pending.interval, saPricing);

  if (error) {
    return (
      <div className="relative z-10 grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
          <h1 className="mt-2 text-xl font-semibold">Could not start Checkout</h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setError("");
                startedRef.current = false;
              }}
              className="inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
            >
              Try again
            </button>
            <a
              href="/#pricing"
              className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
            >
              Back to pricing
            </a>
            <BillingSignOutButton
              onBeforeSignOut={() => {
                startedRef.current = false;
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
        <h1 className="mt-2 text-xl font-semibold">
          {user ? `Starting ${planName}` : `Sign in to start ${planName}`}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          {user
            ? `Redirecting to Stripe for ${planName} (${shownPrice}). Card required. ${FIRM_TRIAL_SENTENCE} on a first subscription, then the paid band.`
            : `Create a firm account or sign in, then we will send you to Stripe for ${planName} (${shownPrice}). Card required. ${FIRM_TRIAL_SENTENCE}. Owner Spark stays free.`}
        </p>
        {user ? (
          <div className="mt-5">
            <BillingSignOutButton
              onBeforeSignOut={() => {
                startedRef.current = false;
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
