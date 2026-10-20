import { useEffect, useState } from "react";
import { firmBillingResumeIntent } from "@/lib/billing-market";
import { useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { billingStartPath, peekPendingCheckout, type PendingCheckout } from "@/lib/pending-checkout";
import { PRECARD_CAP_MESSAGE } from "@/lib/precard-cap";
import { firmSignupCheckoutIntent } from "@/lib/stripe-plans";
import { loadStarterMonthlyLabel } from "@/lib/trial-card-price";
import { TrialCardSentence } from "@/components/trial-card-sentence";

/**
 * In-context step when a no-card firm has used its pack, email, or Bot
 * allowance. The button is the existing Checkout start path.
 */
export function PrecardCapCard({ priceLabel }: { priceLabel?: string | null } = {}) {
  const profile = useOptionalAccountantProfile();
  const [pending, setPending] = useState<PendingCheckout>(() =>
    profile?.hasFirm ? firmBillingResumeIntent(profile.firmMarket, null) : firmSignupCheckoutIntent(),
  );
  const [loadedPrice, setLoadedPrice] = useState<string | null>(priceLabel ?? null);
  useEffect(() => {
    const stored = peekPendingCheckout();
    setPending(
      profile?.hasFirm
        ? firmBillingResumeIntent(profile.firmMarket, stored)
        : stored ?? firmSignupCheckoutIntent(),
    );
  }, [profile?.hasFirm, profile?.firmMarket]);
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
  const price = priceLabel ?? loadedPrice;
  return (
    <section className="precard-cap-card" role="region" aria-label={PRECARD_CAP_MESSAGE}>
      <TrialCardSentence priceLabel={price} />
      <a className="precard-cap-button" href={billingStartPath(pending)}>
        Add a card
      </a>
    </section>
  );
}
