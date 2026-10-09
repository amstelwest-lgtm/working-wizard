import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BillingSignOutButton } from "@/components/billing-sign-out";
import { useAuth } from "@/hooks/use-auth";
import { billingIntentForResolvedMarket } from "@/lib/billing-market";
import { loadFirstFirmClient, type FirstFirmClient } from "@/lib/firm-client-gate";
import { firmWallBackLabel } from "@/lib/smart-landing";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
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
  backLabel,
  backClientId,
  checkout,
}: {
  planName: string;
  priceLabel: string;
  clientName?: string | null;
  backLabel?: string | null;
  backClientId?: string | null;
  checkout: PendingCheckout;
}) {
  const resumeClass =
    backClientId && backLabel
      ? "inline-flex h-10 items-center rounded-full border border-amber-400/40 px-4 text-xs font-bold uppercase tracking-wider text-amber-400"
      : "inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300]";
  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
        <h1 className="mt-2 text-xl font-semibold">Continue on {planName} to keep this practice</h1>
        <p className="mt-2 text-sm text-slate-400">
          The figures stay.
          {clientName ? ` ${clientName} is still open. The firm dashboard and reports need a card. ` : " "}
          Checkout for {planName} ({priceLabel}) starts the subscription. A card is required. A first
          subscription includes a {FIRM_TRIAL_SENTENCE}. If a trial already ended, billing resumes on
          the paid band without another trial. Owner Spark stays free.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {backClientId && backLabel ? (
            <a
              href={`/clients/${backClientId}`}
              className="inline-flex h-10 items-center rounded-full bg-amber-400 px-4 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
            >
              {backLabel}
            </a>
          ) : null}
          <a href={billingStartPath(checkout)} className={resumeClass}>
            Resume Checkout
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
  const { quote: loadedQuote } = Route.useLoaderData();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const fetchQuote = useServerFn(readFirmBillingQuote);
  const [checking, setChecking] = useState(true);
  const [returnClient, setReturnClient] = useState<FirstFirmClient | null | undefined>(undefined);
  const [quote, setQuote] = useState<FirmBillingQuote | null>(loadedQuote);
  const [quoteError, setQuoteError] = useState("");

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
    let cancelled = false;
    void loadFirstFirmClient().then((row) => {
      if (!cancelled) setReturnClient(row);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, [loading, user, pending.plan, pending.interval, navigate, checkEntitlement]);

  useEffect(() => {
    if (!user || quote) return;
    let cancelled = false;
    void fetchQuote({ data: { plan: pending.plan, interval: pending.interval } })
      .then((next) => {
        if (!cancelled) setQuote(next);
      })
      .catch(() => {
        if (!cancelled) setQuoteError("We couldn't read this firm's billing market. Refresh and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [user, quote, pending.plan, pending.interval, fetchQuote]);

  const planName = registerLabelForPlan(priced?.plan ?? pending.plan);
  const priceLabel =
    quote?.market === "za"
      ? quote.priceLabel
      : quote?.market === "us"
        ? usdPriceLabel(priced?.plan ?? pending.plan, priced?.interval ?? pending.interval)
        : null;
  const backLabel = returnClient ? firmWallBackLabel(returnClient.name) : null;

  if (loading || checking || !user || returnClient === undefined || (!priceLabel && !quoteError)) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
          <h1 className="mt-2 text-xl font-semibold">Checking firm billing…</h1>
        </div>
      </div>
    );
  }

  if (quoteError || !priceLabel || !priced) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0b1220] px-4 text-slate-200">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6" role="alert">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Billing</p>
          <h1 className="mt-2 text-xl font-semibold">Continue on {planName} to keep this practice</h1>
          <p className="mt-2 text-sm text-slate-400">
            The figures stay. {quoteError || "Refresh and try again."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
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
      priceLabel={priceLabel}
      clientName={returnClient?.name}
      backLabel={backLabel}
      backClientId={returnClient?.id}
      checkout={priced}
    />
  );
}
