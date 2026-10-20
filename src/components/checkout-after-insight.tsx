import { useEffect, useState } from "react";
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
import { FIRM_TRIAL_CARD_LINE, firmSignupCheckoutIntent } from "@/lib/stripe-plans";

/**
 * Shown once figures are on screen. Entitled firms see nothing.
 * Unpaid firms get one Checkout action for the stashed band (Starter by default).
 */
export function CheckoutAfterInsight() {
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const [unpaid, setUnpaid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readCachedFirmEntitlement((input) => checkEntitlement(input))
      .then((result) => {
        if (!cancelled) setUnpaid(!result.entitled);
      })
      .catch(() => {
        if (!cancelled) setUnpaid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [checkEntitlement]);

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
      <p>{FIRM_TRIAL_CARD_LINE}</p>
      <Link to="/billing/start" search={billingStartSearch(pending)} className="btn gold">
        Add a card
      </Link>
    </section>
  );
}
