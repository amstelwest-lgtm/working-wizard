/**
 * Map a current (non-stale) ClientReviewSignoff onto the PDF footer stamp type.
 * The stamp is only that client's own firm sign-off. Sample/demo practice
 * identities are never a fallback, and a stamp from another firm is dropped.
 * No real sign-off means no line — the caller must not fill one from a profile.
 */

import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import type { ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { formatReviewDateTime } from "@/lib/market";
import type { ResolvedMarket } from "@/lib/market";

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
  const firm = (input.firmName ?? "").trim();
  if (/^sample practice\b/i.test(firm)) return true;
  if (/^a\.?\s*sample\b/i.test(name)) return true;
  return false;
}

/**
 * In-app accountant sign-off line. Name and firm come from the sign-off row.
 * A sample persona is not a sign-off. The clock is the shared zoned formatter.
 */
export function inAppAccountantSignoffLine(input: {
  name?: string | null;
  firmName?: string | null;
  signedOffAt?: string | null;
  market?: Pick<ResolvedMarket, "locale" | "timezone">;
  firmTimeZone?: string | null;
}): string | null {
  const name = (input.name ?? "").trim();
  const firm = (input.firmName ?? "").trim();
  const signedOffAt = (input.signedOffAt ?? "").trim();
  if (!name || !signedOffAt) return null;
  if (isSamplePracticeSignoff({ name, firmName: firm || null })) return null;
  const when = formatReviewDateTime(signedOffAt, input.market, {
    firmTimeZone: input.firmTimeZone,
  });
  if (!when || when === "—") return null;
  return firm ? `Signed off by ${name} · ${firm} · ${when}` : `Signed off by ${name} · ${when}`;
}

/**
 * Line under the pack header when this version's sign-off still holds.
 * Accountant packs name the recorded signer. Owner packs stay role-only.
 */
export function packHeldSignoffLine(input: {
  signedOff: boolean;
  reviewedByKind?: string | null;
  reviewedAt?: string | null;
  name?: string | null;
  firmName?: string | null;
  market?: Pick<ResolvedMarket, "locale" | "timezone">;
  firmTimeZone?: string | null;
}): string | null {
  if (!input.signedOff) return null;
  if (input.reviewedByKind === "owner") {
    const when = (input.reviewedAt ?? "").trim();
    if (!when) return null;
    const clock = formatReviewDateTime(when, input.market, {
      firmTimeZone: input.firmTimeZone,
    });
    if (!clock || clock === "—") return null;
    return `Accepted by the owner ${clock}`;
  }
  return inAppAccountantSignoffLine({
    name: input.name,
    firmName: input.firmName,
    signedOffAt: input.reviewedAt,
    market: input.market,
    firmTimeZone: input.firmTimeZone,
  });
}

/** Trail actor. Name and firm when they were recorded; otherwise the role. */
export function reviewActorLabel(input: {
  name?: string | null;
  firmName?: string | null;
  actorKind?: string | null;
}): string {
  const name = (input.name ?? "").trim();
  const firm = (input.firmName ?? "").trim();
  if (name && !isSamplePracticeSignoff({ name, firmName: firm || null })) {
    return firm ? `${name} · ${firm}` : name;
  }
  const kind = (input.actorKind ?? "system").trim().replace(/_/g, " ");
  if (!kind) return "System";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function firmMatchesClient(stampFirm: string | null, clientFirmName: string | null | undefined): boolean {
  const client = normFirm(clientFirmName);
  if (!client) return true;
  const stamp = normFirm(stampFirm);
  if (!stamp) return false;
  return stamp === client;
}

/**
 * Page-1 sign-off line. Name and firm from the stamp; the clock is the shared
 * zoned formatter (no seconds, no leading zero on the hour).
 * Example: "Reviewed & signed off · James Fleming · Ben Accountants · Oct 7, 2026, 7:01 PM EDT"
 */
export function pdfSignoffBadgeLine(
  stamp: {
    signedOffByName: string;
    firmName?: string | null;
    signedOffAt: string;
  },
  market?: Pick<ResolvedMarket, "locale" | "timezone">,
): string {
  const name = stamp.signedOffByName.trim();
  const when = formatReviewDateTime(stamp.signedOffAt, market);
  const parts = ["Reviewed & signed off", name];
  const firm = stamp.firmName?.trim();
  if (firm) parts.push(firm);
  if (when && when !== "—") parts.push(when);
  return parts.join(" · ");
}

/**
 * Footer segments. Each segment after the first carries its separator so a
 * wrap starts with "· " instead of leaving a hanging dot at the end of the line.
 */
export function signoffFooterSegments(
  stamp: {
    signedOffByName: string;
    signedOffByInitials?: string | null;
    signedOffByTitle?: string | null;
    firmName?: string | null;
  },
  when: string,
): string[] {
  const titled = stamp.signedOffByTitle?.trim()
    ? `${stamp.signedOffByName.trim()}, ${stamp.signedOffByTitle.trim()}`
    : stamp.signedOffByName.trim();
  const parts = ["Reviewed & signed off by"];
  const initials = stamp.signedOffByInitials?.trim();
  if (initials) parts.push(initials);
  parts.push(titled);
  const firm = stamp.firmName?.trim();
  if (firm) parts.push(firm);
  if (when.trim()) parts.push(when.trim());
  return parts.map((part, index) => (index === 0 ? part : `·\u00A0${part}`));
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
