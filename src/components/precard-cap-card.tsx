import { useEffect, useState } from "react";
import { firmBillingResumeIntent } from "@/lib/billing-market";
import { useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { billingStartPath, peekPendingCheckout, type PendingCheckout } from "@/lib/pending-checkout";
import { PRECARD_CAP_MESSAGE } from "@/lib/precard-cap";
import { firmSignupCheckoutIntent } from "@/lib/stripe-plans";

/**
 * In-context step when a no-card firm has used its pack, email, or Bot
 * allowance. The button is the existing Checkout start path.
 */
export function PrecardCapCard() {
  const profile = useOptionalAccountantProfile();
  const [pending, setPending] = useState<PendingCheckout>(() =>
    profile?.hasFirm ? firmBillingResumeIntent(profile.firmMarket, null) : firmSignupCheckoutIntent(),
  );
  useEffect(() => {
    const stored = peekPendingCheckout();
    setPending(
      profile?.hasFirm
        ? firmBillingResumeIntent(profile.firmMarket, stored)
        : stored ?? firmSignupCheckoutIntent(),
    );
  }, [profile?.hasFirm, profile?.firmMarket]);
  return (
    <section className="precard-cap-card" role="region" aria-label={PRECARD_CAP_MESSAGE}>
      <p className="precard-cap-title">{PRECARD_CAP_MESSAGE}</p>
      <a className="precard-cap-button" href={billingStartPath(pending)}>
        Add a card
      </a>
    </section>
  );
}
