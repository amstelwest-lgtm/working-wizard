import type { ReactNode } from "react";
import { FUNNEL_SOLO_FIRST } from "@/lib/funnel-timing";
import { ENTERPRISE_CONTACT_HREF, firmSignupHref } from "@/lib/firm-signup-copy";
import {
  PRICING_TRIAL_AFTER,
  PRICING_WATCHLIST_NOTE,
  SA_FOUNDING_LINE,
  SA_ZAR_LINE,
  SOLO_CARD_NOTE,
  SOLO_TRIAL_BUTTON,
} from "@/lib/landing-copy";
import {
  FIRM_BAND_TABLE,
  FIRM_TRIAL_SENTENCE,
  firmUsdListPrice,
  isFirmCheckoutBand,
  type FirmBand,
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

function pricedInterval(band: FirmBand, interval: FirmInterval): FirmInterval {
  return interval === "year" && band.yearlyUsdCents == null ? "month" : interval;
}

function bandPriceLabel(band: FirmBand, interval: FirmInterval): string {
  if (band.customQuote) return "Custom";
  const billed = pricedInterval(band, interval);
  if (interval === "year" && band.yearlyUsdCents == null) return "Monthly only";
  const price = firmUsdListPrice(band.id, billed);
  if (!price) return "Custom";
  return billed === "year" ? `${price}/yr` : `${price}/mo`;
}

function startLabel(band: FirmBand): string {
  return band.id === "solo" ? SOLO_TRIAL_BUTTON : `Start ${band.name}`;
}

function clientLabel(band: FirmBand, withActive: boolean): string {
  if (band.clientLimit == null) return withActive ? "Unlimited" : "Unlimited";
  return withActive ? `Up to ${band.clientLimit} active clients` : `Up to ${band.clientLimit}`;
}

type StartControl = (band: FirmBand, className: string) => ReactNode;

function BandTable({
  bands,
  interval,
  startControl,
}: {
  bands: FirmBand[];
  interval: FirmInterval;
  startControl: StartControl;
}) {
  return (
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
          {bands.map((band) => {
            const price = bandPriceLabel(band, interval);
            return (
              <tr
                key={band.id}
                className={band.id === "solo" ? "is-trial" : undefined}
                data-band={band.id}
              >
                <td className="firm-bands-name">
                  <strong>{band.name}</strong>
                </td>
                <td className="firm-bands-limit">{clientLabel(band, false)}</td>
                <td className="firm-bands-price">{price}</td>
                <td className="firm-bands-cta">
                  {startControl(band, band.id === "solo" ? "btn btn-gold" : "btn btn-ghost")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BandCards({
  bands,
  interval,
  startControl,
}: {
  bands: FirmBand[];
  interval: FirmInterval;
  startControl: StartControl;
}) {
  return (
    <ul className="firm-band-cards">
      {bands.map((band) => {
        const price = bandPriceLabel(band, interval);
        const solo = band.id === "solo";
        const enterprise = band.customQuote;
        return (
          <li
            key={band.id}
            className={solo ? "firm-band-card is-trial" : "firm-band-card"}
            data-band={band.id}
          >
            <div className="firm-band-card-top">
              <div>
                <p className="firm-band-card-name">{band.name}</p>
                <p className="firm-band-card-limit">
                  {enterprise ? "Unlimited · Custom" : clientLabel(band, true)}
                </p>
              </div>
              {enterprise ? null : <p className="firm-band-card-price">{price}</p>}
            </div>
            {startControl(band, solo ? "btn btn-gold" : "btn btn-ghost")}
            {solo ? <p className="firm-band-card-note">{SOLO_CARD_NOTE}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function FirmBandPricingTable({
  interval,
  onIntervalChange,
  onSelectBand,
  enterpriseHref = ENTERPRISE_CONTACT_HREF,
  compact = false,
  showSaPricing = false,
}: Props) {
  const bands = FIRM_BAND_TABLE.filter((band) => band.id !== "starter");
  const solo = bands.find((band) => band.id === "solo");
  const largerBands = solo ? bands.filter((band) => band.id !== solo.id) : bands;

  const startControl = (band: FirmBand, className: string) => {
    const billed = pricedInterval(band, interval);
    if (band.customQuote) {
      return (
        <a className={className} href={enterpriseHref}>
          Talk to us
        </a>
      );
    }
    const checkoutBand = band.id !== "enterprise" && (interval === "month" || band.yearlyUsdCents != null);
    if (checkoutBand && onSelectBand) {
      return (
        <button
          type="button"
          className={className}
          onClick={() => onSelectBand(band.id as FirmCheckoutBand, billed)}
        >
          {startLabel(band)}
        </button>
      );
    }
    return (
      <a
        className={className}
        href={isFirmCheckoutBand(band.id) ? firmSignupHref(band.id, billed) : firmSignupHref()}
      >
        Set up firm
      </a>
    );
  };

  return (
    <div className={compact ? "firm-bands firm-bands-compact" : "firm-bands"}>
      <div className="firm-trial-bar">
        <p className="firm-trial-bar-lead">{FIRM_TRIAL_SENTENCE}</p>
        <p className="firm-trial-bar-sub">{PRICING_TRIAL_AFTER}</p>
        {showSaPricing ? (
          <>
            <p className="firm-trial-bar-za">{SA_ZAR_LINE}</p>
            <p className="firm-trial-bar-za">{SA_FOUNDING_LINE}</p>
          </>
        ) : null}
      </div>
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
      <div data-funnel={FUNNEL_SOLO_FIRST}>
        {solo ? (
          <>
            <BandTable bands={[solo]} interval={interval} startControl={startControl} />
            <BandCards bands={[solo]} interval={interval} startControl={startControl} />
          </>
        ) : null}
        <details className="firm-bands-more">
          <summary>Larger bands, from Small to Scale</summary>
          <BandTable bands={largerBands} interval={interval} startControl={startControl} />
          <BandCards bands={largerBands} interval={interval} startControl={startControl} />
        </details>
      </div>
      <p className="firm-bands-watchlist">{PRICING_WATCHLIST_NOTE}</p>
    </div>
  );
}
