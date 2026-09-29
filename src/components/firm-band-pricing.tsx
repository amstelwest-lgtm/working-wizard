import { FOUNDING_CALLOUT, WATCHLIST_DEFINITION } from "@/lib/marketing-faq";
import {
  FIRM_BAND_TABLE,
  FIRM_TRIAL_SENTENCE,
  firmUsdListPrice,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

type Props = {
  interval: FirmInterval;
  onIntervalChange?: (interval: FirmInterval) => void;
  onSelectBand?: (band: FirmCheckoutBand, interval: FirmInterval) => void;
  enterpriseHref?: string;
  compact?: boolean;
};

export function FirmBandPricingTable({
  interval,
  onIntervalChange,
  onSelectBand,
  enterpriseHref = "/auth",
  compact = false,
}: Props) {
  return (
    <div className={compact ? "firm-bands firm-bands-compact" : "firm-bands"}>
      {onIntervalChange ? (
        <div className="firm-bands-toggle" role="group" aria-label="Billing interval">
          <button
            type="button"
            className={interval === "month" ? "on" : undefined}
            onClick={() => onIntervalChange("month")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={interval === "year" ? "on" : undefined}
            onClick={() => onIntervalChange("year")}
          >
            Annual · ~20% off
          </button>
        </div>
      ) : null}
      <p className="firm-bands-trial">
        {FIRM_TRIAL_SENTENCE}. Card required. After day 14, paid Solo+.
      </p>
      <p className="firm-bands-founding">{FOUNDING_CALLOUT}</p>
      <p className="firm-bands-note">
        USD list prices. South African firms can pay in ZAR at Checkout (Adaptive Pricing).{" "}
        {WATCHLIST_DEFINITION}
      </p>
      <div className="firm-bands-table-wrap">
        <table className="firm-bands-table">
          <thead>
            <tr>
              <th scope="col">Band</th>
              <th scope="col">Active clients</th>
              <th scope="col">{interval === "year" ? "Annual" : "Monthly"}</th>
              <th scope="col">Start</th>
            </tr>
          </thead>
          <tbody>
            {FIRM_BAND_TABLE.filter((band) => band.id !== "starter").map((band) => {
              const price = band.customQuote
                ? "Custom"
                : interval === "year" && band.yearlyUsdCents == null
                  ? "Monthly only"
                  : firmUsdListPrice(
                      band.id,
                      interval === "year" && band.yearlyUsdCents == null ? "month" : interval,
                    );
              const checkoutBand =
                band.id !== "enterprise" && (interval === "month" || band.yearlyUsdCents != null);
              return (
                <tr
                  key={band.id}
                  className={band.id === "solo" ? "is-trial" : undefined}
                  data-band={band.id}
                >
                  <td className="firm-bands-name">
                    <strong>{band.name}</strong>
                  </td>
                  <td className="firm-bands-limit">
                    {band.clientLimit == null ? "Unlimited" : `Up to ${band.clientLimit}`}
                  </td>
                  <td className="firm-bands-price">
                    {price === "Custom" || price === "Monthly only"
                      ? price
                      : interval === "year"
                        ? `${price}/yr`
                        : `${price}/mo`}
                  </td>
                  <td className="firm-bands-cta">
                    {band.customQuote ? (
                      <a className="btn btn-ghost" href={enterpriseHref}>
                        Talk to us
                      </a>
                    ) : checkoutBand && onSelectBand ? (
                      <button
                        type="button"
                        className={band.id === "solo" ? "btn btn-gold" : "btn btn-ghost"}
                        onClick={() =>
                          onSelectBand(
                            band.id as FirmCheckoutBand,
                            interval === "year" && band.yearlyUsdCents == null ? "month" : interval,
                          )
                        }
                      >
                        {band.id === "solo" ? "Start 14-day trial" : `Start ${band.name}`}
                      </button>
                    ) : (
                      <a className="btn btn-ghost" href="/auth">
                        Set up firm
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
