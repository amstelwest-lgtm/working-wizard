import { ENTERPRISE_CONTACT_HREF, firmSignupHref } from "@/lib/firm-signup-copy";
import { SA_FOUNDING_LINE, SA_ZAR_LINE } from "@/lib/landing-copy";
import { WATCHLIST_DEFINITION } from "@/lib/marketing-faq";
import {
  FIRM_BAND_TABLE,
  FIRM_TRIAL_SENTENCE,
  firmUsdListPrice,
  isFirmCheckoutBand,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";

type Props = {
  interval: FirmInterval;
  onIntervalChange?: (interval: FirmInterval) => void;
  onSelectBand?: (band: FirmCheckoutBand, interval: FirmInterval) => void;
  enterpriseHref?: string;
  compact?: boolean;
  /** Server geo only. Defaults off so a missed prop cannot leak the SA discount. */
  showSaPricing?: boolean;
};

export function FirmBandPricingTable({
  interval,
  onIntervalChange,
  onSelectBand,
  enterpriseHref = ENTERPRISE_CONTACT_HREF,
  compact = false,
  showSaPricing = false,
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
      {showSaPricing ? (
        <>
          <p className="firm-bands-founding">{SA_ZAR_LINE}</p>
          <p className="firm-bands-founding">{SA_FOUNDING_LINE}</p>
        </>
      ) : null}
      <p className="firm-bands-note">USD list prices. {WATCHLIST_DEFINITION}</p>
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
                      <a
                        className="btn btn-ghost"
                        href={
                          isFirmCheckoutBand(band.id)
                            ? firmSignupHref(
                                band.id,
                                interval === "year" && band.yearlyUsdCents == null
                                  ? "month"
                                  : interval,
                              )
                            : firmSignupHref()
                        }
                      >
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
