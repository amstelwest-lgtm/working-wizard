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
import { cardFreeTrialLine, cardFreeTrialPriceFromQuote } from "@/lib/billing-wall";
import { firmSignupCheckoutIntent } from "@/lib/stripe-plans";
import { loadCardFreeTrialPriceLabel } from "@/lib/trial-card-price";
import { TrialCardSentence } from "@/components/trial-card-sentence";

/**
 * Shown once figures are on screen. Entitled firms see nothing.
 * Unpaid firms get one Checkout action for the stashed band (Starter by default).
 */
export function CheckoutAfterInsight({
  priceLabel,
  clientCount,
  quote,
}: {
  priceLabel?: string | null;
  /**
   * Firm client count for the practice home. Omit it and the sentence stays
   * the locked one-client line used on a client file.
   */
  clientCount?: number | null;
  /** Firm billing quote. Omit it and this block loads the wall's quote. */
  quote?: { market?: string | null; priceLabel?: string | null } | null;
} = {}) {
  const { user } = useAuth();
  const profile = useOptionalAccountantProfile();
  const firmId = profile?.firmId ?? null;
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const [unpaid, setUnpaid] = useState(false);
  const [loadedPrice, setLoadedPrice] = useState<string | null>(priceLabel ?? null);

  useEffect(() => {
    if (!user?.id || !firmId) return;
    let cancelled = false;
    void readCachedFirmEntitlement(
      user.id,
      (input) => checkEntitlement({ data: { ...input.data, firmId } }),
      false,
      firmId,
    )
      .then((result) => {
        if (!cancelled) setUnpaid(!result.entitled);
      })
      .catch(() => {
        if (!cancelled) setUnpaid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [checkEntitlement, user?.id, firmId, profile]);

  useEffect(() => {
    if (priceLabel != null) return;
    if (quote !== undefined) {
      setLoadedPrice(cardFreeTrialPriceFromQuote(quote));
      return;
    }
    let cancelled = false;
    void loadCardFreeTrialPriceLabel().then((label) => {
      if (!cancelled) setLoadedPrice(label);
    });
    return () => {
      cancelled = true;
    };
  }, [priceLabel, quote]);

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
      <TrialCardSentence
        priceLabel={priceLabel ?? loadedPrice}
        line={clientCount === undefined ? undefined : cardFreeTrialLine(clientCount)}
      />
      <Link to="/billing/start" search={billingStartSearch(pending)} className="btn gold">
        Add a card
      </Link>
    </section>
  );
}
