/**
 * Map a current (non-stale) ClientReviewSignoff onto the PDF footer stamp type.
 */

import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import type { ReportSignoffStamp } from "@/components/pdf/pdf-document";

export function stampFromSignoff(
  signoff: ClientReviewSignoff | null | undefined,
  isStale: boolean,
): ReportSignoffStamp | null {
  if (!signoff || isStale) return null;
  return {
    signedOffByName: signoff.signed_off_by_name,
    signedOffByInitials: signoff.signed_off_by_initials ?? null,
    signedOffByTitle: signoff.signed_off_by_title,
    firmName: signoff.firm_name,
    signedOffAt: signoff.signed_off_at,
    signatureData: signoff.signature_data ?? null,
  };
}
