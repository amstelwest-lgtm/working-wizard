import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ownerPlanPublicLine, ownerVisitorFromPack } from "@/lib/owner-plan";
import { readMarketingVisitor } from "@/lib/geo-country.functions";
import { readSaPricingCopy } from "@/lib/pricing/za-pricing.functions";
import { useServerFn } from "@tanstack/react-start";
import { BillingSignOutButton } from "@/components/billing-sign-out";
import { useAuth } from "@/hooks/use-auth";
import { billingIntentForResolvedMarket } from "@/lib/billing-market";
import { loadFirstFirmClient, type FirstFirmClient } from "@/lib/firm-client-gate";
import { firmWallBackLabel } from "@/lib/smart-landing";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
import { noteFirmEntitlement } from "@/lib/firm-entitlement-client";
import { readFirmBillingQuote, type FirmBillingQuote } from "@/lib/pricing/za-pricing.functions";
import {
  billingStartPath,
  billingStartSearch,
  parsePendingCheckout,
  registerLabelForPlan,
  stashPendingCheckout,
  type PendingCheckout,
} from "@/lib/pending-checkout";
import {
  firmSignupCheckoutIntent,
  firmUsdListPrice,
  FIRM_TRIAL_SENTENCE,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import {
  BILLING_WALL_TRIAL_ACTION,
  firmWallTrialDetail,
  resolveBillingWall,
} from "@/lib/billing-wall";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

export const Route = createFileRoute("/billing/required")({
  validateSearch: (search: Record<string, unknown>): PendingCheckout => {
    return parsePendingCheckout(search) ?? firmSignupCheckoutIntent();
  },
  loaderDeps: ({ search }) => ({ plan: search.plan, interval: search.interval }),
  loader: async ({ deps }) => {
    const visitor = await readMarketingVisitor();
    const ownerPack = visitor.geoZa ? "za" : "us";
    const ownerMonthly = visitor.showSaPricing ? (await readSaPricingCopy())?.ownerMonthly ?? null : null;
    try {
      const quote = await readFirmBillingQuote({
        data: { plan: deps.plan, interval: deps.interval },
      });
      return { quote, ownerPack, ownerMonthly };
    } catch {
      // SSR has no bearer token. The client refetches once auth is attached.
      return { quote: null as FirmBillingQuote | null, ownerPack, ownerMonthly };
    }
  },
  component: BillingRequiredPage,
  head: () => ({
    meta: [
      { title: "Finish firm billing — Milōn" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function usdPriceLabel(plan: FirmCheckoutBand, interval: FirmInterval): string {
  const amount = firmUsdListPrice(plan, interval);
  if (!amount) return "";
  return interval === "year" ? `${amount}/yr` : `${amount}/mo`;
}

export function BillingRequiredCard({
  planName,
  priceLabel,
  clientName,
  backLabel,
  backClientId,
  checkout,
  ownerPack,
  ownerMonthly,
  onRetry,
  backHref,
}: {
  planName: string;
  priceLabel: string;
  clientName?: string | null;
  backLabel?: string | null;
  backClientId?: string | null;
  checkout: PendingCheckout;
  ownerPack?: "za" | "us";
  ownerMonthly?: string | null;
  onRetry?: () => void;
  backHref?: string;
}) {
  const ownerLine = ownerPlanPublicLine(ownerPack === "za" ? "za" : "us", ownerMonthly);
  const trialClass =
    "inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#102A43]";
  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200" data-billing-wall="card">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
        <h1 className="mt-2 text-xl font-semibold">Continue on {planName} to keep this practice</h1>
        <p className="mt-2 text-sm text-slate-400">
          The figures stay.
          {clientName ? ` ${clientName} is still open. The firm dashboard and reports need a card. ` : " "}
          {firmWallTrialDetail(priceLabel)} Checkout for {planName} ({priceLabel}) starts the
          subscription. A card is required. A first subscription is {FIRM_TRIAL_SENTENCE} on Starter.
          If a trial already ended, billing resumes on the paid band without another trial. Owner plan
          is {ownerLine}.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {backClientId && backLabel ? (
            <a
              href={`/clients/${backClientId}`}
              className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
            >
              {backLabel}
            </a>
          ) : null}
          <a href={billingStartPath(checkout)} className={trialClass} data-billing-action="trial">
            {BILLING_WALL_TRIAL_ACTION}
          </a>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
            >
              Retry
            </button>
          ) : null}
          <a
            href={backHref || "/dashboard"}
            className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
          >
            Back
          </a>
          <a
            href="/#pricing"
            className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
          >
            Back to pricing
          </a>
          <BillingSignOutButton />
        </div>
      </div>
    </div>
  );
}

function BillingRequiredPage() {
  const pending = Route.useSearch();
  const { quote: loadedQuote, ownerPack, ownerMonthly } = Route.useLoaderData();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const fetchQuote = useServerFn(readFirmBillingQuote);
  const [checking, setChecking] = useState(true);
  const [returnClient, setReturnClient] = useState<FirstFirmClient | null | undefined>(undefined);
  const [quote, setQuote] = useState<FirmBillingQuote | null>(loadedQuote);
  const [quoteError, setQuoteError] = useState("");
  const [wallAttempt, setWallAttempt] = useState(0);
  const retryWall = () => {
    setChecking(true);
    setReturnClient(undefined);
    setQuote(null);
    setQuoteError("");
    setWallAttempt((n) => n + 1);
  };

  const priced = quote
    ? billingIntentForResolvedMarket(quote.market, pending)
    : null;

  useEffect(() => {
    if (priced) stashPendingCheckout(priced);
  }, [priced?.plan, priced?.interval, priced?.market, priced?.promo]);

  useEffect(() => {
    if (!priced || priced.market === pending.market) return;
    void navigate({
      to: "/billing/required",
      search: billingStartSearch(priced),
      replace: true,
    });
  }, [priced?.market, pending.market, navigate]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({
        to: "/auth",
        search: { next: billingStartPath(priced ?? pending), signup: true },
        replace: true,
      });
      return;
    }
    let cancelled = false;
    const plan = pending.plan;
    const interval = pending.interval;
    void resolveBillingWall({
      client: loadFirstFirmClient(),
      entitlement: checkEntitlement({ data: { refresh: true } }).then((result) => {
        if (user?.id) noteFirmEntitlement(user.id, result);
        return result;
      }),
      quote: fetchQuote({ data: { plan, interval } }),
      plan,
      interval,
      timeoutMs: SHELL_GATE_TIMEOUT_MS,
    }).then((result) => {
      if (cancelled) return;
      setReturnClient(result.returnClient);
      if (result.quote) setQuote(result.quote);
      if (result.quoteError) setQuoteError(result.quoteError);
      if (result.entitled) {
        void navigate({ to: "/dashboard", replace: true });
        return;
      }
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loading, user, pending.plan, pending.interval, navigate, checkEntitlement, fetchQuote, wallAttempt]);

  const checkout = priced ?? pending;
  const planName = registerLabelForPlan(checkout.plan);
  const priceLabel =
    quote?.market === "za"
      ? quote.priceLabel
      : quote?.market === "us"
        ? usdPriceLabel(checkout.plan, checkout.interval)
        : null;
  // A missing quote is not ZA. A ZA quote with a null price stays unresolved.
  const shownPrice =
    priceLabel ||
    (quote?.market === "za"
      ? null
      : usdPriceLabel(checkout.plan, checkout.interval));
  const backHref = returnClient?.id ? `/clients/${returnClient.id}` : "/dashboard";
  const backLabel = returnClient ? firmWallBackLabel(returnClient.name) : null;

  if (loading || checking || !user || returnClient === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200" data-billing-wall="checking">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
          <h1 className="mt-2 text-xl font-semibold">Checking firm billing…</h1>
        </div>
      </div>
    );
  }

  if (!shownPrice) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200" data-billing-wall="error">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6" role="alert">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
          <h1 className="mt-2 text-xl font-semibold">Continue on {planName} to keep this practice</h1>
          <p className="mt-2 text-sm text-slate-400">
            The figures stay. {quoteError || "Refresh and try again."} {firmWallTrialDetail(null)}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href={billingStartPath(checkout)}
              className="inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#102A43]"
            >
              {BILLING_WALL_TRIAL_ACTION}
            </a>
            <button
              type="button"
              onClick={retryWall}
              className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
            >
              Retry
            </button>
            <a
              href={backHref}
              className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
            >
              Back
            </a>
            <a
              href="/#pricing"
              className="inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
            >
              Back to pricing
            </a>
            <BillingSignOutButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <BillingRequiredCard
      planName={planName}
      priceLabel={shownPrice}
      clientName={returnClient?.name}
      backLabel={backLabel}
      backClientId={returnClient?.id}
      checkout={checkout}
      ownerPack={ownerVisitorFromPack(ownerPack)}
      ownerMonthly={ownerMonthly}
      onRetry={retryWall}
      backHref={backHref}
    />
  );
}
