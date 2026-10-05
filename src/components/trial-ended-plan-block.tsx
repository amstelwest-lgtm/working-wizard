import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FirmBandUpgrade } from "@/components/firm-band-upgrade";
import { UPGRADE_FAILED_MESSAGE } from "@/lib/firm-band-upgrade";
import { STARTER_TRIAL_ENDED_MESSAGE } from "@/lib/firm-starter-trial";
import {
  isStarterTrialEndedMessage,
  messageFromUnknown,
} from "@/lib/starter-trial-generation";
import type { FirmBandId, FirmCheckoutBand, FirmInterval } from "@/lib/stripe-plans";
import { getFirmPlanDisplay, upgradeFirmBand } from "@/lib/stripe-checkout.functions";

export type TrialEndedUpgrade = {
  band: FirmBandId | null;
  interval: FirmInterval;
  priceCurrency: "USD" | "ZAR";
  zarByBand?: Partial<Record<FirmBandId, { month: number | null; year: number | null }>>;
  canUpgrade: boolean;
  clientCount?: number | null;
  usageLabel?: string | null;
  saDiscount?: boolean;
};

/**
 * One "Your trial has ended, choose a plan" card. The band list is the
 * existing picker. South Africa 50% copy stays inside that picker.
 */
export function TrialEndedPlanCard({
  upgrade,
  loading = false,
  upgrading = false,
  onUpgrade,
}: {
  upgrade: TrialEndedUpgrade | null;
  loading?: boolean;
  upgrading?: boolean;
  onUpgrade?: (band: FirmCheckoutBand, interval: FirmInterval) => void;
}) {
  return (
    <section
      className="trial-ended-block bg-card text-foreground"
      role="region"
      aria-label={STARTER_TRIAL_ENDED_MESSAGE}
    >
      <p className="trial-ended-title text-foreground">{STARTER_TRIAL_ENDED_MESSAGE}</p>
      {loading ? <p className="trial-ended-note text-muted-foreground">Loading plans…</p> : null}
      {!loading && !upgrade ? (
        <p className="trial-ended-note text-muted-foreground" role="alert">
          Plans could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {upgrade ? (
        <FirmBandUpgrade
          currentBand={upgrade.band}
          interval={upgrade.interval}
          priceCurrency={upgrade.priceCurrency}
          zarByBand={upgrade.zarByBand}
          canUpgrade={upgrade.canUpgrade}
          clientCount={upgrade.clientCount}
          usageLabel={upgrade.usageLabel}
          saDiscount={upgrade.saDiscount}
          upgrading={upgrading}
          onUpgrade={onUpgrade}
        />
      ) : null}
    </section>
  );
}

export function TrialEndedPlanBlock({
  firmId,
  upgrade: upgradeFromCaller,
  upgrading = false,
  onUpgrade,
  onUpgraded,
}: {
  firmId: string | null;
  upgrade?: TrialEndedUpgrade | null;
  upgrading?: boolean;
  onUpgrade?: (band: FirmCheckoutBand, interval: FirmInterval) => void;
  onUpgraded?: () => void;
}) {
  const loadPlan = useServerFn(getFirmPlanDisplay);
  const upgradeBand = useServerFn(upgradeFirmBand);
  const [fetched, setFetched] = useState<TrialEndedUpgrade | null>(null);
  const [loading, setLoading] = useState(!upgradeFromCaller);
  const [localUpgrading, setLocalUpgrading] = useState(false);
  const callerUpgrade = upgradeFromCaller ?? null;

  useEffect(() => {
    if (callerUpgrade) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadPlan({ data: { firmId } })
      .then((plan) => {
        if (cancelled || !plan || plan.configured === false) return;
        setFetched({
          band: plan.band,
          interval: plan.interval ?? "month",
          priceCurrency: plan.priceCurrency ?? "USD",
          zarByBand: plan.zarByBand,
          canUpgrade: plan.canUpgrade,
          clientCount: plan.clientCount,
          usageLabel: plan.usageLabel,
          saDiscount: plan.saDiscount,
        });
      })
      .catch(() => {
        if (!cancelled) setFetched(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [callerUpgrade, firmId, loadPlan]);

  const upgrade = callerUpgrade ?? fetched;

  const handleUpgrade = (band: FirmCheckoutBand, interval: FirmInterval) => {
    if (onUpgrade) {
      onUpgrade(band, interval);
      return;
    }
    if (!firmId) return;
    setLocalUpgrading(true);
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
        toast.error(messageFromUnknown(err) || UPGRADE_FAILED_MESSAGE);
      })
      .finally(() => setLocalUpgrading(false));
  };

  return (
    <TrialEndedPlanCard
      upgrade={upgrade}
      loading={loading && !upgrade}
      upgrading={upgrading || localUpgrading}
      onUpgrade={upgrade ? handleUpgrade : undefined}
    />
  );
}

export function useTrialEndedAction() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = (err: unknown, fallback: string) => {
    const message = messageFromUnknown(err).trim() || fallback;
    if (isStarterTrialEndedMessage(message)) {
      setError(null);
      setOpen(true);
      return;
    }
    setOpen(false);
    setError(message);
    toast.error(message);
  };

  const reset = () => {
    setError(null);
  };

  return { open, error, report, reset };
}

export function TrialEndedActionNotice({
  firmId,
  open,
  error,
}: {
  firmId: string | null;
  open: boolean;
  error: string | null;
}) {
  if (!open && !error) return null;
  return (
    <div className="trial-ended-action">
      {open ? <TrialEndedPlanBlock firmId={firmId} /> : null}
      {error ? (
        <p role="alert" className="trial-ended-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
