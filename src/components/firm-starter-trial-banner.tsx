import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { TrialEndedPlanBlock } from "@/components/trial-ended-plan-block";
import type { FirmUpgradeAllowance } from "@/lib/firm-client-cap";
import { UPGRADE_FAILED_MESSAGE } from "@/lib/firm-band-upgrade";
import { SA_FIRM_DISCOUNT_NOTE } from "@/lib/firm-sa-market";
import {
  firmStarterTrialCountdownCopy,
  type StarterTrialBanner,
} from "@/lib/firm-starter-trial";
import type { FirmCheckoutBand, FirmInterval } from "@/lib/stripe-plans";
import { upgradeFirmBand } from "@/lib/stripe-checkout.functions";

/**
 * Practice-dashboard trial notice. Countdown from day 10.
 * After expiry, the band picker sits under the ended sentence.
 * Hidden when the firm is exempt or the clock does not apply.
 */
export function FirmStarterTrialBanner({
  trial,
  upgrade,
  firmId,
  onUpgraded,
}: {
  trial: StarterTrialBanner;
  upgrade?: FirmUpgradeAllowance;
  firmId: string | null;
  onUpgraded?: () => void;
}) {
  const upgradeBand = useServerFn(upgradeFirmBand);
  const [upgrading, setUpgrading] = useState(false);
  const countdown = firmStarterTrialCountdownCopy(trial);
  if (!trial.expired && !countdown) return null;

  const onUpgrade = (band: FirmCheckoutBand, interval: FirmInterval) => {
    if (!firmId) return;
    setUpgrading(true);
    void upgradeBand({ data: { firmId, band, interval } })
      .then((result) => {
        if (result.kind === "checkout") {
          window.location.href = result.url;
          return;
        }
        toast.success(result.message);
        onUpgraded?.();
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : UPGRADE_FAILED_MESSAGE);
      })
      .finally(() => setUpgrading(false));
  };

  if (trial.expired) {
    return (
      <TrialEndedPlanBlock
        firmId={firmId}
        upgrading={upgrading}
        upgrade={
          upgrade
            ? {
                band: upgrade.band,
                interval: upgrade.interval,
                priceCurrency: upgrade.priceCurrency,
                zarByBand: upgrade.zarByBand,
                canUpgrade: upgrade.canUpgrade,
                clientCount: upgrade.clientCount,
                usageLabel: upgrade.usageLabel,
                saDiscount: upgrade.saDiscount,
              }
            : null
        }
        onUpgrade={onUpgrade}
        onUpgraded={onUpgraded}
      />
    );
  }

  return (
    <section className="trial-ended-block" role="status" aria-label="Trial">
      <p className="trial-ended-title">{countdown}</p>
      {upgrade?.saDiscount ? <p className="trial-ended-note">{SA_FIRM_DISCOUNT_NOTE}</p> : null}
    </section>
  );
}
