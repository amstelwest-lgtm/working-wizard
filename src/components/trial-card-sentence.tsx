import { PRECARD_CAP_MESSAGE } from "@/lib/precard-cap";

/**
 * The pre-card sentence, then one price. The price is the USD catalog or
 * the server's rand label. This component does not name a rand amount.
 */
export function TrialCardSentence({ priceLabel }: { priceLabel?: string | null }) {
  const price = (priceLabel ?? "").trim();
  return (
    <>
      <p className="precard-cap-title">{PRECARD_CAP_MESSAGE}</p>
      {price ? (
        <p className="precard-cap-price" data-trial-price="">
          {price}
        </p>
      ) : null}
    </>
  );
}
