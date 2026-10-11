/**
 * One subtle sign-off for the owner tabs. Nothing when the tab is unsigned.
 * The date is the calendar day of the stored sign-off, without the clock.
 */
import { isSamplePracticeSignoff } from "@/lib/review-signoff-stamp";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { formatDate } from "@/lib/market/format";
import { useMarketFormat } from "@/contexts/market";

export const OWNER_SIGNOFF_STALE_CHIP = "Figures changed · re-review";

/** "1 Sep 2026". Month is the three-letter form, day has no leading zero. */
export function ownerSignoffDate(iso: string, timeZone = "UTC"): string {
  const formatted = formatDate(
    iso,
    { locale: "en-GB", timezone: timeZone },
    { day: "numeric", month: "short", year: "numeric", timeZone },
  )
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ");
  return formatted.replace(/\bSept\b/g, "Sep");
}

export function ownerSignoffLine(name: string, date: string): string {
  const who = name.trim();
  const when = date.trim();
  if (who && when && when !== "—") return `Signed off by ${who} · ${when}`;
  if (who) return `Signed off by ${who}`;
  return "Signed off";
}

export function OwnerSignoffMark({
  signoff,
  isStale,
  align = "end",
  className = "",
}: {
  signoff: ClientReviewSignoff | null;
  isStale: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  const { market } = useMarketFormat();
  if (
    !signoff ||
    isSamplePracticeSignoff({
      name: signoff.signed_off_by_name,
      firmName: signoff.firm_name,
    })
  ) {
    return null;
  }
  const date = signoff.signed_off_at
    ? ownerSignoffDate(signoff.signed_off_at, market.timezone)
    : "";
  const line = ownerSignoffLine(signoff.signed_off_by_name, date);
  return (
    <div
      data-owner-signoff
      data-signoff-stale={isStale ? "true" : "false"}
      className={`flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 ${
        align === "start" ? "justify-start" : "justify-end"
      } ${className}`}
    >
      {signoff.signature_data ? (
        <img
          src={signoff.signature_data}
          alt=""
          className="h-5 w-auto max-w-[4.5rem] object-contain object-left"
        />
      ) : null}
      <p className="text-[12px] font-medium leading-snug text-[#102A43]">{line}</p>
      {isStale ? (
        <span
          data-signoff-stale-chip
          className="inline-flex items-center rounded-full bg-[#B7791F]/12 px-2 py-0.5 text-[11px] font-semibold leading-none text-[#B7791F]"
        >
          {OWNER_SIGNOFF_STALE_CHIP}
        </span>
      ) : null}
    </div>
  );
}
