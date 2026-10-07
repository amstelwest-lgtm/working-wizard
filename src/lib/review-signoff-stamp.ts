/**
 * Map a current (non-stale) ClientReviewSignoff onto the PDF footer stamp type.
 * The stamp is only that client's own firm sign-off. Sample/demo practice
 * identities are never a fallback, and a stamp from another firm is dropped.
 * No real sign-off means no line — the caller must not fill one from a profile.
 */

import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import type { ReportSignoffStamp } from "@/components/pdf/pdf-document";

export type SignoffStampContext = {
  /** Firm row name for this client. A stamp that names a different firm is dropped. */
  clientFirmName?: string | null;
};

function normFirm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Demo persona used by sample practices. Never a real client's sign-off. */
export function isSamplePracticeSignoff(input: {
  name?: string | null;
  firmName?: string | null;
}): boolean {
  const name = (input.name ?? "").trim();
  const firm = normFirm(input.firmName);
  if (firm === "sample practice" || firm.startsWith("sample practice ")) return true;
  if (/^a\.?\s+sample$/i.test(name)) return true;
  return false;
}

function firmMatchesClient(stampFirm: string | null, clientFirmName: string | null | undefined): boolean {
  const client = normFirm(clientFirmName);
  if (!client) return true;
  const stamp = normFirm(stampFirm);
  if (!stamp) return false;
  return stamp === client;
}

export function stampFromSignoff(
  signoff: ClientReviewSignoff | null | undefined,
  isStale: boolean,
  context?: SignoffStampContext,
): ReportSignoffStamp | null {
  if (!signoff || isStale) return null;
  if (
    isSamplePracticeSignoff({
      name: signoff.signed_off_by_name,
      firmName: signoff.firm_name,
    })
  ) {
    return null;
  }
  if (!firmMatchesClient(signoff.firm_name, context?.clientFirmName)) return null;
  return {
    signedOffByName: signoff.signed_off_by_name,
    signedOffByInitials: signoff.signed_off_by_initials ?? null,
    signedOffByTitle: signoff.signed_off_by_title,
    firmName: signoff.firm_name,
    signedOffAt: signoff.signed_off_at,
    signatureData: signoff.signature_data ?? null,
  };
}
