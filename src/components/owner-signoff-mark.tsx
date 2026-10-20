/**
 * One subtle sign-off for the owner tabs. Nothing when the tab is unsigned.
 * The date is the calendar day of the stored sign-off, without the clock.
 */
import { isSamplePracticeSignoff } from "@/lib/review-signoff-stamp";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { formatDate } from "@/lib/market/format";
import { useMarketFormat } from "@/contexts/market";

export const OWNER_SIGNOFF_STALE_CHIP = "Figures changed · re-review";

/** Calendar day of the stored sign-off. ZA "1 Sep 2026". US "Sep 1, 2026". */
export function ownerSignoffDate(
  iso: string,
  timeZone = "UTC",
  market?: { locale?: string; timezone?: string },
): string {
  const locale =
    market?.locale ?? (timeZone.startsWith("America/") ? "en-US" : "en-ZA");
  return formatDate(iso, { locale, timezone: market?.timezone ?? timeZone });
}

export function ownerSignoffLine(name: string, date: string, scopeLabel?: string | null): string {
  const who = name.trim();
  const when = date.trim();
  const body =
    who && when && when !== "—"
      ? `Signed off by ${who} · ${when}`
      : who
        ? `Signed off by ${who}`
        : "Signed off";
  const scope = scopeLabel?.trim() || "";
  if (!scope) return body;
  return `${scope}: ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
}

export function OwnerSignoffMark({
  signoff,
  isStale,
  align = "end",
  className = "",
  scopeLabel = null,
}: {
  signoff: ClientReviewSignoff | null;
  isStale: boolean;
  align?: "start" | "end";
  className?: string;
  /** Scope word, e.g. Financials on Health. Omitted leaves the signer line as it is. */
  scopeLabel?: string | null;
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
    ? ownerSignoffDate(signoff.signed_off_at, market.timezone, market)
    : "";
  const line = ownerSignoffLine(signoff.signed_off_by_name, date, scopeLabel);
  return (
    <div
      data-owner-signoff
      data-signoff-stale={isStale ? "true" : "false"}
      className={`flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 ${
        align === "start" ? "justify-start" : "justify-start sm:justify-end"
      } ${className}`}
    >
      {signoff.signature_data ? (
        <img
          src={signoff.signature_data}
          alt=""
          className="h-5 w-auto max-w-[4.5rem] object-contain object-left"
        />
      ) : null}
      <p className="min-w-0 whitespace-normal text-[12px] font-medium leading-snug text-[#102A43] [overflow-wrap:break-word]">
        {line}
      </p>
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
