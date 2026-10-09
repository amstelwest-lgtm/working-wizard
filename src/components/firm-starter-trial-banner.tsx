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
  if (trial.expired || !countdown) return null;

  return (
    <section className="trial-ended-block bg-card text-foreground" role="status" aria-label="Trial">
      <p className="trial-ended-title text-foreground">{countdown}</p>
      {upgrade?.zaPriceLabel ? (
        <p className="trial-ended-note text-muted-foreground">{upgrade.zaPriceLabel}</p>
      ) : null}
    </section>
  );
}
