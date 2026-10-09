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
import { FIRM_TRIAL_SENTENCE, firmSignupCheckoutIntent } from "@/lib/stripe-plans";

/**
 * Shown once figures are on screen. Entitled firms see nothing.
 * Unpaid firms get one Checkout action for the stashed band (Solo by default).
 */
export function CheckoutAfterInsight() {
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  const [unpaid, setUnpaid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void checkEntitlement({ data: {} })
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
      className="card"
      data-funnel={FUNNEL_CHECKOUT_AFTER_INSIGHT}
      aria-label="Continue after the figures"
      style={{ marginTop: 16 }}
    >
      <p className="kicker">Next · {planName}</p>
      <h3 style={{ margin: "6px 0 8px" }}>The figures stay on this client.</h3>
      <p style={{ margin: "0 0 14px", maxWidth: "62ch" }}>
        A card starts the {FIRM_TRIAL_SENTENCE}. You can keep reading this file without one.
      </p>
      <Link
        to="/billing/start"
        search={billingStartSearch(pending)}
        className="btn gold"
      >
        Add a card to start your 14-day free trial
      </Link>
    </section>
  );
}
