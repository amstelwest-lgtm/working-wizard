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
import {
  FIRM_BAND_TABLE,
  FIRM_BAND_IDS,
  firmClientLimitLabel,
  isFirmCheckoutBand,
  type FirmBandId,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

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
  onUpgrade?: (band: FirmCheckoutBand, interval: FirmInterval) => void;
};

function rowPrice(
  bandId: FirmBandId,
  interval: FirmInterval,
  currency: FirmPriceCurrency,
  zarByBand: Partial<Record<FirmBandId, ZarBandAmounts>> | undefined,
  customQuote: boolean,
  yearlyUsdCents: number | null,
): string {
  if (customQuote) return "Custom";
  const pricedInterval: FirmInterval =
    interval === "year" && yearlyUsdCents == null ? "month" : interval;
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
  onUpgrade,
}: Props) {
  const [interval, setInterval] = useState<FirmInterval>(intervalFromPlan);
  const [selected, setSelected] = useState<FirmCheckoutBand | null>(() =>
    nextBandUp(currentBand, clientCount),
  );

  useEffect(() => {
    setInterval(intervalFromPlan);
  }, [intervalFromPlan]);

  useEffect(() => {
    setSelected(nextBandUp(currentBand, clientCount));
  }, [currentBand, clientCount]);

  const currentIdx = currentBand ? FIRM_BAND_IDS.indexOf(currentBand) : -1;

  return (
    <div>
      {usageLabel ? (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink)" }}>{usageLabel}</p>
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
          );
          return (
            <label
              key={band.id}
              aria-current={isCurrent ? "true" : undefined}
              style={{
                display: "grid",
                gridTemplateColumns: selectable ? "20px 1fr auto" : "1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 0",
                borderTop: "1px solid var(--line, rgba(0,0,0,.08))",
                fontSize: 13,
                color: "var(--ink)",
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
                <span style={{ display: "block", color: "var(--ink-dim)", fontSize: 12 }}>
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
      {canUpgrade && selected && onUpgrade ? (
        <button
          className="btn gold"
          type="button"
          style={{ marginTop: 16 }}
          disabled={upgrading}
          onClick={() => onUpgrade(selected, interval)}
        >
          {upgrading ? "Upgrading…" : upgradeButtonLabel(selected)}
        </button>
      ) : null}
      {canUpgrade && !selected ? (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--ink-dim)" }}>
          You are on the largest self-serve band. Enterprise is a custom quote.
        </p>
      ) : null}
      {!canUpgrade ? (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.55 }}>
          {ASK_FIRM_OWNER_TO_UPGRADE}
        </p>
      ) : null}
    </div>
  );
}
