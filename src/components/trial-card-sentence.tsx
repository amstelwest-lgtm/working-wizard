import { PRECARD_CAP_MESSAGE } from "@/lib/precard-cap";

/**
 * The pre-card sentence, then one price. The price is the USD catalog or
 * the server's rand label. This component does not name a rand amount.
 */
export function TrialCardSentence({
  priceLabel,
  line,
}: {
  priceLabel?: string | null;
  /** Count-aware trial sentence. The pre-card card leaves this unset. */
  line?: string | null;
}) {
  const price = (priceLabel ?? "").trim();
  const sentence = (line ?? "").trim() || PRECARD_CAP_MESSAGE;
  return (
    <>
      <p className="precard-cap-title">{sentence}</p>
      {price ? (
        <p className="precard-cap-price" data-trial-price="">
          {price}
        </p>
      ) : null}
    </>
  );
}
