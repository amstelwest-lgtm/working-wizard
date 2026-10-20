import type { ReactNode } from "react";
import { FUNNEL_SOLO_FIRST } from "@/lib/funnel-timing";
import { ENTERPRISE_CONTACT_HREF, firmSignupHref } from "@/lib/firm-signup-copy";
import {
  PRICING_TRIAL_AFTER,
  SOLO_CARD_NOTE,
  SOLO_TRIAL_BUTTON,
} from "@/lib/landing-copy";
import {
  FIRM_BAND_TABLE,
  FIRM_TRIAL_SENTENCE,
  firmUsdPublicLine,
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
  /** Server geo only. Defaults off so a missed prop cannot show local prices. */
  showSaPricing?: boolean;
  /** Server-built lines. Absent unless the edge is ZA. */
  saLabels?: Partial<Record<string, { month: string; year: string }>> | null;
  /** Rand line under the trial sentence. Absent unless the edge is ZA. */
  trialAfter?: string | null;
};

function pricedInterval(band: FirmBand, interval: FirmInterval): FirmInterval {
  return interval === "year" && band.yearlyUsdCents == null ? "month" : interval;
}

function bandPriceLabel(
  band: FirmBand,
  interval: FirmInterval,
  saLabels?: Partial<Record<string, { month: string; year: string }>> | null,
): string {
  if (band.customQuote) return "Custom";
  const billed = pricedInterval(band, interval);
  const local = saLabels?.[band.id]?.[billed];
  if (local) return local;
  if (interval === "year" && band.yearlyUsdCents == null) return "Monthly only";
  return firmUsdPublicLine(band.id, billed) ?? "Custom";
}

function startLabel(band: FirmBand): string {
  return band.id === "starter" ? SOLO_TRIAL_BUTTON : `Start ${band.name}`;
}

/** Amount stays on one line. The per-client clause wraps under it. */
function FirmPrice({ price }: { price: string }) {
  const splitAt = price.indexOf(" · ");
  if (splitAt === -1) return <span className="firm-price-amount">{price}</span>;
  return (
    <>
      <span className="firm-price-amount">{price.slice(0, splitAt)}</span>
      <span className="firm-price-per">{price.slice(splitAt + 3)}</span>
    </>
  );
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
  saLabels,
}: {
  bands: FirmBand[];
  interval: FirmInterval;
  startControl: StartControl;
  saLabels?: Partial<Record<string, { month: string; year: string }>> | null;
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
            const price = bandPriceLabel(band, interval, saLabels);
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
                <td className="firm-bands-price">
                  <FirmPrice price={price} />
                </td>
                <td className="firm-bands-cta">
                  {startControl(band, band.id === "solo" ? "btn btn-cobalt" : "btn btn-ghost")}
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
  saLabels,
  className = "firm-band-cards firm-bands-featured",
}: {
  bands: FirmBand[];
  interval: FirmInterval;
  startControl: StartControl;
  saLabels?: Partial<Record<string, { month: string; year: string }>> | null;
  className?: string;
}) {
  return (
    <ul className={className}>
      {bands.map((band) => {
        const price = bandPriceLabel(band, interval, saLabels);
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
              {enterprise ? null : (
                <p className="firm-band-card-price">
                  <FirmPrice price={price} />
                </p>
              )}
            </div>
            {startControl(band, solo ? "btn btn-cobalt" : "btn btn-ghost")}
            {solo && SOLO_CARD_NOTE ? <p className="firm-band-card-note">{SOLO_CARD_NOTE}</p> : null}
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
  saLabels = null,
  trialAfter = null,
}: Props) {
  const labels = showSaPricing ? saLabels : null;
  const bands = FIRM_BAND_TABLE;
  const featured = bands.filter(
    (band) => band.id === "starter" || band.id === "solo" || band.id === "growing",
  );

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
      <div className={labels ? "firm-trial-bar firm-trial-bar-za" : "firm-trial-bar"}>
        <p className="firm-trial-bar-lead">{FIRM_TRIAL_SENTENCE}</p>
        <p className="firm-trial-bar-sub">
          {showSaPricing ? trialAfter || "On Starter. A card is required at signup." : PRICING_TRIAL_AFTER}
        </p>
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
        <BandCards bands={featured} interval={interval} startControl={startControl} saLabels={labels} />
        <details className="firm-bands-more">
          <summary>See all plans</summary>
          <BandCards
            bands={bands}
            interval={interval}
            startControl={startControl}
            saLabels={labels}
            className="firm-band-cards firm-bands-stack"
          />
          <BandTable bands={bands} interval={interval} startControl={startControl} saLabels={labels} />
        </details>
      </div>
    </div>
  );
}
