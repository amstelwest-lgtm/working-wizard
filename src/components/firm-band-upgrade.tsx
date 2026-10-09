import { useEffect, useState } from "react";
import {
  ASK_FIRM_OWNER_TO_UPGRADE,
  downgradeDropsBelowUsage,
  firmBandPriceLabel,
  nextBandUp,
  upgradeButtonLabel,
  type FirmPriceCurrency,
  type ZarBandAmounts,
} from "@/lib/firm-band-upgrade";
import { FUNNEL_SOLO_FIRST } from "@/lib/funnel-timing";
import { FIRM_VOUCHER_INVALID_MESSAGE } from "@/lib/firm-voucher";
import {
  FIRM_BAND_CATALOG,
  FIRM_BAND_TABLE,
  FIRM_BAND_IDS,
  firmClientLimitLabel,
  isFirmCheckoutBand,
  type FirmBandId,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

export type FirmVoucherCheckResult =
  | { ok: true; promotionCodeId: string; preview: string }
  | { ok: false; message: string };

type Props = {
  currentBand: FirmBandId | null;
  interval: FirmInterval;
  priceCurrency: FirmPriceCurrency;
  zarByBand?: Partial<Record<FirmBandId, ZarBandAmounts>>;
  canUpgrade: boolean;
  /** Active clients. Bands whose limit is below this count are not offered. */
  clientCount?: number | null;
  usageLabel?: string | null;
  upgrading?: boolean;
  /** Server says this signed-in firm is SA. Never set from a public page. */
  saDiscount?: boolean;
  /** Server-built rand lines. When set, these are the prices Checkout charges. */
  zaLabels?: Partial<Record<FirmBandId, { month: string; year: string }>> | null;
  onUpgrade?: (band: FirmCheckoutBand, interval: FirmInterval, voucherCode?: string | null) => void;
  /** Checks the code with Stripe. Absent on previews that cannot bill. */
  onValidateVoucher?: (input: {
    code: string;
    band: FirmCheckoutBand;
    interval: FirmInterval;
  }) => Promise<FirmVoucherCheckResult>;
};

function rowPrice(
  bandId: FirmBandId,
  interval: FirmInterval,
  currency: FirmPriceCurrency,
  zarByBand: Partial<Record<FirmBandId, ZarBandAmounts>> | undefined,
  customQuote: boolean,
  yearlyUsdCents: number | null,
  zaLabels: Partial<Record<FirmBandId, { month: string; year: string }>> | null | undefined,
): string {
  if (customQuote) return "Custom";
  const pricedInterval: FirmInterval =
    interval === "year" && yearlyUsdCents == null ? "month" : interval;
  const local = zaLabels?.[bandId]?.[pricedInterval];
  if (local) return local;
  // Starter has no annual price. $0 on the annual toggle is $0/yr, not $0/mo.
  if (
    interval === "year" &&
    yearlyUsdCents == null &&
    FIRM_BAND_CATALOG[bandId].monthlyUsdCents === 0
  ) {
    return currency.toLowerCase() === "zar" ? "R0/yr" : "$0/yr";
  }
  const label = firmBandPriceLabel(bandId, pricedInterval, currency, zarByBand);
  if (!label) return "—";
  return pricedInterval === "year" ? `${label}/yr` : `${label}/mo`;
}

export function FirmBandUpgrade({
  currentBand,
  interval: intervalFromPlan,
  priceCurrency,
  zarByBand,
  canUpgrade,
  clientCount = null,
  usageLabel,
  upgrading = false,
  saDiscount = false,
  zaLabels = null,
  onUpgrade,
  onValidateVoucher,
}: Props) {
  const [interval, setInterval] = useState<FirmInterval>(intervalFromPlan);
  const [selected, setSelected] = useState<FirmCheckoutBand | null>(() =>
    nextBandUp(currentBand, clientCount),
  );
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherChecked, setVoucherChecked] = useState<string | null>(null);
  const [voucherPreview, setVoucherPreview] = useState<string | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [checkingVoucher, setCheckingVoucher] = useState(false);

  useEffect(() => {
    setInterval(intervalFromPlan);
  }, [intervalFromPlan]);

  useEffect(() => {
    setSelected(nextBandUp(currentBand, clientCount));
  }, [currentBand, clientCount]);

  useEffect(() => {
    setVoucherChecked(null);
    setVoucherPreview(null);
    setVoucherError(null);
  }, [selected, interval]);

  const currentIdx = currentBand ? FIRM_BAND_IDS.indexOf(currentBand) : -1;
  const soloLeads =
    selected === "solo" && (currentBand == null || currentBand === "starter");
  const voucherApplied = Boolean(voucherPreview && voucherChecked);
  void saDiscount;

  async function applyVoucher(): Promise<boolean> {
    if (!selected || !onValidateVoucher) return false;
    const code = voucherCode.trim();
    if (!code) {
      setVoucherError(null);
      setVoucherPreview(null);
      setVoucherChecked(null);
      return false;
    }
    setCheckingVoucher(true);
    setVoucherError(null);
    try {
      const result = await onValidateVoucher({ code, band: selected, interval });
      if (!result.ok) {
        setVoucherPreview(null);
        setVoucherChecked(null);
        setVoucherError(result.message || FIRM_VOUCHER_INVALID_MESSAGE);
        return false;
      }
      setVoucherPreview(result.preview);
      setVoucherChecked(code);
      setVoucherError(null);
      return true;
    } catch (err) {
      setVoucherPreview(null);
      setVoucherChecked(null);
      setVoucherError(err instanceof Error ? err.message : FIRM_VOUCHER_INVALID_MESSAGE);
      return false;
    } finally {
      setCheckingVoucher(false);
    }
  }

  async function continueUpgrade() {
    if (!selected || !onUpgrade || upgrading || checkingVoucher) return;
    const code = voucherCode.trim();
    if (code && code !== voucherChecked) {
      await applyVoucher();
      return;
    }
    onUpgrade(selected, interval, code && voucherChecked === code ? code : null);
  }

  return (
    <div className="firm-band-upgrade">
      {usageLabel ? (
        <p className="text-foreground" style={{ margin: "0 0 12px", fontSize: 13 }}>
          {usageLabel}
        </p>
      ) : null}
      {canUpgrade ? (
        <div
          style={{ display: "flex", gap: 8, marginBottom: 12 }}
          role="group"
          aria-label="Billing interval"
        >
          <button
            type="button"
            className={interval === "month" ? "btn gold mini" : "btn ghost mini"}
            onClick={() => setInterval("month")}
            disabled={upgrading}
          >
            Monthly
          </button>
          <button
            type="button"
            className={interval === "year" ? "btn gold mini" : "btn ghost mini"}
            onClick={() => setInterval("year")}
            disabled={upgrading}
          >
            Annual
          </button>
        </div>
      ) : null}
      <div role="radiogroup" aria-label="Firm bands">
        {FIRM_BAND_TABLE.map((band) => {
          const isCurrent = band.id === currentBand;
          const selectable =
            canUpgrade &&
            isFirmCheckoutBand(band.id) &&
            FIRM_BAND_IDS.indexOf(band.id) > currentIdx &&
            !downgradeDropsBelowUsage(band.id, clientCount);
          const price = rowPrice(
            band.id,
            interval,
            priceCurrency,
            zarByBand,
            band.customQuote,
            band.yearlyUsdCents,
            zaLabels,
          );
          return (
            <label
              key={band.id}
              aria-current={isCurrent ? "true" : undefined}
              data-funnel={band.id === "solo" && soloLeads ? FUNNEL_SOLO_FIRST : undefined}
              className="text-foreground"
              style={{
                display: "grid",
                gridTemplateColumns: selectable ? "20px 1fr auto" : "1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 0",
                borderTop: "1px solid var(--border, var(--line, rgba(0,0,0,.08)))",
                fontSize: 13,
              }}
            >
              {selectable ? (
                <input
                  type="radio"
                  name="firm-upgrade-band"
                  value={band.id}
                  checked={selected === band.id}
                  onChange={() => {
                    if (isFirmCheckoutBand(band.id)) setSelected(band.id);
                  }}
                  disabled={upgrading}
                />
              ) : null}
              <span>
                <strong>{band.name}</strong>
                {isCurrent ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Current
                  </span>
                ) : null}
                {band.id === "solo" && soloLeads ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Start here
                  </span>
                ) : null}
                <span className="text-muted-foreground" style={{ display: "block", fontSize: 12 }}>
                  {band.clientLimit == null
                    ? "Unlimited active clients"
                    : firmClientLimitLabel(band.id)}
                </span>
              </span>
              <span>{price}</span>
            </label>
          );
        })}
      </div>
      {canUpgrade && onValidateVoucher ? (
        <details style={{ marginTop: 14 }}>
          <summary className="text-muted-foreground" style={{ cursor: "pointer", fontSize: 13 }}>
            Have a voucher code?
          </summary>
          <label className="firm-voucher-label" htmlFor="firm-voucher-code">
            Voucher code
          </label>
          <div className="firm-voucher-row">
            <input
              id="firm-voucher-code"
              name="voucher"
              className="firm-voucher-input"
              placeholder="Enter code"
              autoCapitalize="characters"
              aria-describedby={
                voucherError
                  ? "firm-voucher-error"
                  : voucherPreview
                    ? "firm-voucher-status"
                    : undefined
              }
              value={voucherCode}
              onChange={(event) => {
                const next = event.target.value;
                setVoucherCode(next);
                if (next.trim() !== voucherChecked) {
                  setVoucherPreview(null);
                  setVoucherError(null);
                }
              }}
              disabled={upgrading || checkingVoucher}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn ghost mini"
              disabled={upgrading || checkingVoucher || !voucherCode.trim() || !selected}
              onClick={() => void applyVoucher()}
            >
              {checkingVoucher ? "Checking…" : "Apply"}
            </button>
          </div>
          {voucherError ? (
            <p
              id="firm-voucher-error"
              role="alert"
              style={{ margin: "8px 0 0", fontSize: 12, color: "var(--risk, #9b2c2c)" }}
            >
              {voucherError}
            </p>
          ) : null}
          {voucherPreview ? (
            <p
              id="firm-voucher-status"
              role="status"
              className="text-foreground"
              style={{ margin: "8px 0 0", fontSize: 13 }}
            >
              {voucherPreview}
            </p>
          ) : null}
        </details>
      ) : null}
      {canUpgrade && selected && onUpgrade ? (
        <button
          className="btn gold"
          type="button"
          style={{ marginTop: 16 }}
          disabled={upgrading || checkingVoucher}
          onClick={() => void continueUpgrade()}
        >
          {upgrading ? "Upgrading…" : upgradeButtonLabel(selected)}
        </button>
      ) : null}
      {canUpgrade && !selected ? (
        <p className="text-muted-foreground" style={{ margin: "12px 0 0", fontSize: 13 }}>
          You are on the largest self-serve band. Enterprise is a custom quote.
        </p>
      ) : null}
      {!canUpgrade ? (
        <p
          className="text-muted-foreground"
          style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.55 }}
        >
          {ASK_FIRM_OWNER_TO_UPGRADE}
        </p>
      ) : null}
    </div>
  );
}
