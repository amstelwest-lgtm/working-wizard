import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FirmBandUpgrade } from "@/components/firm-band-upgrade";
import { useFirmVoucherCheck } from "@/hooks/use-firm-voucher";
import { UPGRADE_FAILED_MESSAGE } from "@/lib/firm-band-upgrade";
import { showStarterTrialEndedCopy, type FirmSubscriptionPhase } from "@/lib/firm-client-cap";
import { STARTER_TRIAL_ENDED_MESSAGE } from "@/lib/firm-starter-trial";
import { FIRM_VOUCHER_INVALID_MESSAGE } from "@/lib/firm-voucher";
import { isStarterTrialEndedMessage, messageFromUnknown } from "@/lib/starter-trial-generation";
import type { FirmBandId, FirmCheckoutBand, FirmInterval } from "@/lib/stripe-plans";
import {
  getFirmPlanDisplay,
  upgradeFirmBand,
  validateFirmVoucher,
} from "@/lib/stripe-checkout.functions";
import { readCachedFirmPlan } from "@/lib/firm-plan-client";

export type TrialEndedUpgrade = {
  band: FirmBandId | null;
  interval: FirmInterval;
  priceCurrency: "USD" | "zar";
  zarByBand?: Partial<Record<FirmBandId, { month: number | null; year: number | null }>>;
  canUpgrade: boolean;
  clientCount?: number | null;
  usageLabel?: string | null;
  saDiscount?: boolean;
  zaLabels?: Partial<Record<FirmBandId, { month: string; year: string }>> | null;
  /** Live subscription phase. Active / CURRENT is not an ended trial. */
  phase?: FirmSubscriptionPhase | null;
};

/**
 * One "Your trial has ended, choose a plan" card. The band list is the
 * existing picker. An SA firm sees the rand lines the server built.
 */
export function TrialEndedPlanCard({
  upgrade,
  loading = false,
  upgrading = false,
  onUpgrade,
  onValidateVoucher,
}: {
  upgrade: TrialEndedUpgrade | null;
  loading?: boolean;
  upgrading?: boolean;
  onUpgrade?: (band: FirmCheckoutBand, interval: FirmInterval, voucherCode?: string | null) => void;
  onValidateVoucher?: (input: {
    code: string;
    band: FirmCheckoutBand;
    interval: FirmInterval;
  }) => Promise<
    { ok: true; promotionCodeId: string; preview: string } | { ok: false; message: string }
  >;
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
          zaLabels={upgrade.zaLabels}
          upgrading={upgrading}
          onUpgrade={onUpgrade}
          onValidateVoucher={onValidateVoucher}
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
  onUpgrade?: (band: FirmCheckoutBand, interval: FirmInterval, voucherCode?: string | null) => void;
  onUpgraded?: () => void;
}) {
  const loadPlan = useServerFn(getFirmPlanDisplay);
  const upgradeBand = useServerFn(upgradeFirmBand);
  const onValidateVoucher = useFirmVoucherCheck(firmId);
  const [fetched, setFetched] = useState<TrialEndedUpgrade | null>(null);
  const [fetchedPhase, setFetchedPhase] = useState<FirmSubscriptionPhase | null | undefined>(
    upgradeFromCaller ? (upgradeFromCaller.phase ?? null) : undefined,
  );
  const [loading, setLoading] = useState(!upgradeFromCaller);
  const [localUpgrading, setLocalUpgrading] = useState(false);
  const callerUpgrade = upgradeFromCaller ?? null;

  useEffect(() => {
    if (callerUpgrade) {
      setFetchedPhase(callerUpgrade.phase ?? null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void readCachedFirmPlan(firmId, (input) => loadPlan(input))
      .then((plan) => {
        if (cancelled || !plan || plan.configured === false) {
          if (!cancelled) setFetchedPhase(null);
          return;
        }
        setFetchedPhase(plan.phase);
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
        if (!cancelled) {
          setFetched(null);
          setFetchedPhase(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [callerUpgrade, firmId, loadPlan]);

  const upgrade = callerUpgrade ?? fetched;
  const phase = callerUpgrade ? (callerUpgrade.phase ?? fetchedPhase ?? null) : fetchedPhase;
  const phaseKnown = phase !== undefined;
  if (!phaseKnown || !showStarterTrialEndedCopy(phase, true)) return null;

  const handleUpgrade = (
    band: FirmCheckoutBand,
    interval: FirmInterval,
    voucherCode?: string | null,
  ) => {
    if (onUpgrade) {
      onUpgrade(band, interval, voucherCode);
      return;
    }
    if (!firmId) return;
    setLocalUpgrading(true);
    void upgradeBand({
      data: { firmId, band, interval, voucherCode: voucherCode?.trim() || undefined },
    })
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
      onValidateVoucher={onValidateVoucher}
    />
  );
}

/**
 * Plan card for the Analyst chat, Bot, and ask-ai thread.
 * The widget mounts this in its own root, outside the router, so the server
 * functions are called directly. Prices stay on FirmBandUpgrade.
 */
export function ChatTrialEndedPlan({ firmId }: { firmId: string | null }) {
  const [fetched, setFetched] = useState<TrialEndedUpgrade | null>(null);
  const [phase, setPhase] = useState<FirmSubscriptionPhase | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void readCachedFirmPlan(firmId, (input) => getFirmPlanDisplay(input))
      .then((plan) => {
        if (cancelled) return;
        if (!plan || plan.configured === false) {
          setPhase(null);
          setFetched(null);
          return;
        }
        setPhase(plan.phase);
        setFetched({
          band: plan.band,
          interval: plan.interval ?? "month",
          priceCurrency: plan.priceCurrency ?? "USD",
          zarByBand: plan.zarByBand,
          canUpgrade: plan.canUpgrade,
          clientCount: plan.clientCount,
          usageLabel: plan.usageLabel,
          saDiscount: plan.saDiscount,
          zaLabels: plan.zaLabels,
          phase: plan.phase,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFetched(null);
          setPhase(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  if (phase !== undefined && !showStarterTrialEndedCopy(phase, true)) return null;

  const handleUpgrade = (
    band: FirmCheckoutBand,
    interval: FirmInterval,
    voucherCode?: string | null,
  ) => {
    if (!firmId) return;
    setUpgrading(true);
    void upgradeFirmBand({
      data: { firmId, band, interval, voucherCode: voucherCode?.trim() || undefined },
    })
      .then((result) => {
        if (result.kind === "checkout") {
          window.location.href = result.url;
          return;
        }
        toast.success(result.message);
      })
      .catch((err: unknown) => {
        toast.error(messageFromUnknown(err) || UPGRADE_FAILED_MESSAGE);
      })
      .finally(() => setUpgrading(false));
  };

  const onValidateVoucher = firmId
    ? async (input: { code: string; band: FirmCheckoutBand; interval: FirmInterval }) => {
        try {
          const result = await validateFirmVoucher({ data: { firmId, ...input } });
          if (!result.ok) {
            return { ok: false as const, message: result.message || FIRM_VOUCHER_INVALID_MESSAGE };
          }
          return {
            ok: true as const,
            promotionCodeId: result.promotionCodeId,
            preview: result.preview,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message.trim() : "";
          return { ok: false as const, message: message || FIRM_VOUCHER_INVALID_MESSAGE };
        }
      }
    : undefined;

  return (
    <TrialEndedPlanCard
      upgrade={fetched}
      loading={loading && !fetched}
      upgrading={upgrading}
      onUpgrade={fetched && firmId ? handleUpgrade : undefined}
      onValidateVoucher={onValidateVoucher}
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
