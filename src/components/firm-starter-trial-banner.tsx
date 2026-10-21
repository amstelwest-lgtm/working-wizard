import { cardFreeTrialLine, cardFreeTrialPrice } from "@/lib/billing-wall";
import type { FirmUpgradeAllowance } from "@/lib/firm-client-cap";
import { firmStarterTrialCountdownCopy, type StarterTrialBanner } from "@/lib/firm-starter-trial";

/**
 * Practice-dashboard trial countdown (from day 10).
 * The ended plan picker mounts in Settings, not here.
 * Hidden when the firm is exempt, the clock does not apply, or the trial has ended.
 */
export function FirmStarterTrialBanner({
  trial,
  upgrade,
}: {
  trial: StarterTrialBanner;
  upgrade?: FirmUpgradeAllowance;
  firmId: string | null;
  onUpgraded?: () => void;
}) {
  const countdown = firmStarterTrialCountdownCopy(trial);
  const explore = trial.cardFree && !trial.expired ? cardFreeTrialLine(upgrade?.clientCount) : null;
  const price = explore
    ? upgrade
      ? cardFreeTrialPrice({
          market: upgrade.saDiscount || upgrade.zaPriceLabel ? "za" : "us",
          zaPriceLabel: upgrade.zaPriceLabel ?? null,
        })
      : null
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
