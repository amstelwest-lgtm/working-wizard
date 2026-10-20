import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { firmBillingResumeIntent } from "@/lib/billing-market";
import { useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { FUNNEL_CHECKOUT_AFTER_INSIGHT } from "@/lib/funnel-timing";
import {
  billingStartSearch,
  peekPendingCheckout,
  registerLabelForPlan,
} from "@/lib/pending-checkout";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
import { readCachedFirmEntitlement } from "@/lib/firm-entitlement-client";
import { firmSignupCheckoutIntent } from "@/lib/stripe-plans";
import { loadStarterMonthlyLabel } from "@/lib/trial-card-price";
import { TrialCardSentence } from "@/components/trial-card-sentence";

/**
 * Shown once figures are on screen. Entitled firms see nothing.
 * Unpaid firms get one Checkout action for the stashed band (Starter by default).
 */
export function CheckoutAfterInsight({ priceLabel }: { priceLabel?: string | null } = {}) {
  const { user } = useAuth();
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const [unpaid, setUnpaid] = useState(false);
  const [loadedPrice, setLoadedPrice] = useState<string | null>(priceLabel ?? null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void readCachedFirmEntitlement(user.id, (input) => checkEntitlement(input))
      .then((result) => {
        if (!cancelled) setUnpaid(!result.entitled);
      })
      .catch(() => {
        if (!cancelled) setUnpaid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [checkEntitlement, user?.id]);

  useEffect(() => {
    if (priceLabel != null) return;
    let cancelled = false;
    void loadStarterMonthlyLabel().then((label) => {
      if (!cancelled) setLoadedPrice(label);
    });
    return () => {
      cancelled = true;
    };
  }, [priceLabel]);

  const profile = useOptionalAccountantProfile();

  if (!unpaid) return null;

  const pending = profile?.hasFirm
    ? firmBillingResumeIntent(profile.firmMarket, peekPendingCheckout())
    : peekPendingCheckout() ?? firmSignupCheckoutIntent();
  const planName = registerLabelForPlan(pending.plan);

  return (
    <section
      className="card trial-next"
      data-funnel={FUNNEL_CHECKOUT_AFTER_INSIGHT}
      aria-label="Continue after the figures"
    >
      <p className="kicker">Next · {planName}</p>
      <h3>The figures stay on this client.</h3>
      <TrialCardSentence priceLabel={priceLabel ?? loadedPrice} />
      <Link to="/billing/start" search={billingStartSearch(pending)} className="btn gold">
        Add a card
      </Link>
    </section>
  );
}
