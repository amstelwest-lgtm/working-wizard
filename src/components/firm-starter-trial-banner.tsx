import { useEffect, useState } from "react";
import { cardFreeTrialLine, cardFreeTrialPrice, cardFreeTrialPriceFromQuote } from "@/lib/billing-wall";
import type { FirmUpgradeAllowance } from "@/lib/firm-client-cap";
import { firmStarterTrialCountdownCopy, type StarterTrialBanner } from "@/lib/firm-starter-trial";
import { loadCardFreeTrialPriceLabel } from "@/lib/trial-card-price";

/**
 * Practice-dashboard trial countdown (from day 10).
 * The ended plan picker mounts in Settings, not here.
 * Hidden when the firm is exempt, the clock does not apply, or the trial has ended.
 */
export function FirmStarterTrialBanner({
  trial,
  upgrade,
  quote,
}: {
  trial: StarterTrialBanner;
  upgrade?: FirmUpgradeAllowance;
  firmId: string | null;
  onUpgraded?: () => void;
  /**
   * Firm billing quote. The same object the Start trial wall prices.
   * Omit it and the banner loads that quote. A missing label is not USD.
   */
  quote?: { market?: string | null; priceLabel?: string | null } | null;
}) {
  const [fetched, setFetched] = useState<string | null>(null);
  useEffect(() => {
    if (quote !== undefined || upgrade?.zaPriceLabel) return;
    let cancelled = false;
    void loadCardFreeTrialPriceLabel().then((label) => {
      if (!cancelled) setFetched(label);
    });
    return () => {
      cancelled = true;
    };
  }, [quote, upgrade?.zaPriceLabel]);
  const countdown = firmStarterTrialCountdownCopy(trial);
  const explore = trial.cardFree && !trial.expired ? cardFreeTrialLine(upgrade?.clientCount) : null;
  const quoted = quote !== undefined ? cardFreeTrialPriceFromQuote(quote) : null;
  const fromSnapshot = upgrade?.zaPriceLabel
    ? cardFreeTrialPrice({ market: "za", zaPriceLabel: upgrade.zaPriceLabel })
    : null;
  const price = explore
    ? quote !== undefined
      ? quoted
      : (fromSnapshot ?? fetched)
    : (upgrade?.zaPriceLabel ?? null);
  if (trial.expired || (!countdown && !explore)) return null;

  return (
    <section className="trial-ended-block bg-card text-foreground" role="status" aria-label="Trial">
      {explore ? (
        <p className="trial-ended-title text-foreground" data-card-free-trial="">
          {explore}
        </p>
      ) : null}
      {countdown ? <p className="trial-ended-note text-muted-foreground">{countdown}</p> : null}
      {price ? (
        <p className="trial-ended-note text-muted-foreground" data-trial-price="">
          {price}
        </p>
      ) : null}
    </section>
  );
}
