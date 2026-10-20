import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BillingSignOutButton } from "@/components/billing-sign-out";
import { useAuth } from "@/hooks/use-auth";
import { billingIntentForResolvedMarket } from "@/lib/billing-market";
import { loadFirstFirmClient, type FirstFirmClient } from "@/lib/firm-client-gate";
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
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import {
  FIRM_WALL_BACK_HREF,
  FIRM_WALL_BACK_LABEL,
  FIRM_WALL_START_LABEL,
  FIRM_WALL_TRIAL_ENDED_LINE,
  FIRM_WALL_TRIAL_LINE,
  firmWallBackTarget,
  firmWallOffersRetry,
  firmWallWhyLine,
  resolveBillingWall,
  type FirmWallEntitlementOutcome,
} from "@/lib/billing-wall";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

export const Route = createFileRoute("/billing/required")({
  validateSearch: (search: Record<string, unknown>): PendingCheckout => {
    return parsePendingCheckout(search) ?? firmSignupCheckoutIntent();
  },
  loaderDeps: ({ search }) => ({ plan: search.plan, interval: search.interval }),
  loader: async ({ deps }) => {
    try {
      const quote = await readFirmBillingQuote({
        data: { plan: deps.plan, interval: deps.interval },
      });
      return { quote };
    } catch {
      // SSR has no bearer token. The client refetches once auth is attached.
      return { quote: null as FirmBillingQuote | null };
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
  checkout,
  onRetry,
  backHref = FIRM_WALL_BACK_HREF,
  trialEnded = false,
  quoteError,
}: {
  planName: string;
  priceLabel: string | null;
  clientName?: string | null;
  checkout: PendingCheckout;
  onRetry?: () => void;
  backHref?: string;
  trialEnded?: boolean;
  quoteError?: string;
}) {
  const primaryClass =
    "inline-flex h-10 items-center rounded-full bg-[#0B5FFF] px-4 text-xs font-bold uppercase tracking-wider text-white";
  const ghostClass =
    "inline-flex h-10 items-center rounded-full border border-[#0B5FFF] bg-transparent px-4 text-xs font-bold uppercase tracking-wider text-[#0B5FFF]";
  const price = priceLabel?.trim() ?? "";
  return (
    <div className="grid min-h-screen place-items-center bg-white px-4 text-[#102A43]" data-billing-wall="card">
      <div className="w-full max-w-md rounded-2xl border border-[#DBEAFE] bg-white p-6 shadow-[0_8px_24px_rgba(16,42,67,0.06)]">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#0B5FFF]">Billing</p>
        <h1 className="mt-2 text-xl font-semibold text-[#102A43]">Continue on {planName} to keep this practice</h1>
        <p className="mt-2 text-sm text-[#102A43]" data-billing-why>
          {firmWallWhyLine(clientName)}
        </p>
        <p className="mt-2 text-sm text-[#102A43]" data-billing-trial>
          {FIRM_WALL_TRIAL_LINE}
        </p>
        {price ? (
          <p className="mt-2 text-sm font-semibold text-[#102A43]" data-billing-price>
            {price}
          </p>
        ) : null}
        {trialEnded ? (
          <p className="mt-2 text-sm text-[#102A43]" data-billing-trial-ended>
            {FIRM_WALL_TRIAL_ENDED_LINE}
          </p>
        ) : null}
        {quoteError ? <p className="mt-2 text-sm text-[#102A43]">{quoteError}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={billingStartPath(checkout)} className={primaryClass} data-billing-action="trial">
            {FIRM_WALL_START_LABEL}
          </a>
          <a href={backHref} className={ghostClass} data-billing-back="clients">
            {FIRM_WALL_BACK_LABEL}
          </a>
          {onRetry ? (
            <button type="button" onClick={onRetry} className={ghostClass}>
              Retry
            </button>
          ) : null}
          <BillingSignOutButton className={ghostClass} />
        </div>
      </div>
    </div>
  );
}

function BillingRequiredPage() {
  const pending = Route.useSearch();
  const { quote: loadedQuote } = Route.useLoaderData();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const fetchQuote = useServerFn(readFirmBillingQuote);
  const [checking, setChecking] = useState(true);
  const [returnClient, setReturnClient] = useState<FirstFirmClient | null | undefined>(undefined);
  const [quote, setQuote] = useState<FirmBillingQuote | null>(loadedQuote);
  const [quoteError, setQuoteError] = useState("");
  const [wallAttempt, setWallAttempt] = useState(0);
  const [entitlementOutcome, setEntitlementOutcome] = useState<FirmWallEntitlementOutcome>("failed");
  const [trialEnded, setTrialEnded] = useState(false);
  const [backHref, setBackHref] = useState(FIRM_WALL_BACK_HREF);
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
    setBackHref(
      firmWallBackTarget({
        referrer: typeof document === "undefined" ? null : document.referrer,
        pageOrigin: typeof window === "undefined" ? null : window.location.origin,
        firstClientId: returnClient?.id ?? null,
      }),
    );
  }, [returnClient?.id]);

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
      setEntitlementOutcome(result.entitlementOutcome);
      setTrialEnded(result.trialEnded);
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

  if (loading || checking || !user || returnClient === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-white px-4 text-[#102A43]" data-billing-wall="checking">
        <div className="w-full max-w-md rounded-2xl border border-[#DBEAFE] bg-white p-6 shadow-[0_8px_24px_rgba(16,42,67,0.06)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#0B5FFF]">Billing</p>
          <h1 className="mt-2 text-xl font-semibold text-[#102A43]">Checking firm billing…</h1>
        </div>
      </div>
    );
  }

  return (
    <BillingRequiredCard
      planName={planName}
      priceLabel={shownPrice}
      clientName={returnClient?.name}
      checkout={checkout}
      onRetry={firmWallOffersRetry(entitlementOutcome) ? retryWall : undefined}
      backHref={backHref}
      trialEnded={trialEnded}
      quoteError={shownPrice ? undefined : quoteError || "Refresh and try again."}
    />
  );
}
