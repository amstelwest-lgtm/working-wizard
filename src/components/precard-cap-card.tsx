import { billingStartPath, peekPendingCheckout } from "@/lib/pending-checkout";
import { PRECARD_CAP_MESSAGE } from "@/lib/precard-cap";
import { firmSignupCheckoutIntent } from "@/lib/stripe-plans";

/**
 * In-context step when a no-card firm has used its pack, email, or Bot
 * allowance. The button is the existing Checkout start path.
 */
export function PrecardCapCard() {
  const pending = peekPendingCheckout() ?? firmSignupCheckoutIntent();
  return (
    <section className="precard-cap-card" role="region" aria-label={PRECARD_CAP_MESSAGE}>
      <p className="precard-cap-title">{PRECARD_CAP_MESSAGE}</p>
      <a className="precard-cap-button" href={billingStartPath(pending)}>
        Add a card
      </a>
    </section>
  );
}
