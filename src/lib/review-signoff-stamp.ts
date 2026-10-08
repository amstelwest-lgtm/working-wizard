/**
 * Map a current (non-stale) ClientReviewSignoff onto the PDF footer stamp type.
 * The stamp is only that client's own firm sign-off. Sample/demo practice
 * identities are never a fallback, and a stamp from another firm is dropped.
 * No real sign-off means no line — the caller must not fill one from a profile.
 */

import { formatReviewDateTime } from "./market/format.ts";
import type { ResolvedMarket } from "./market/types.ts";
import { signoffStatusLine } from "./signoff-status.ts";

/**
 * Fields the stamp reads from a review sign-off row. Kept here so this module
 * does not import the server function or the PDF document.
 */
type StampSignoff = {
  signed_off_by_name: string;
  signed_off_by_initials?: string | null;
  signed_off_by_title?: string | null;
  firm_name?: string | null;
  signature_data?: string | null;
  signed_off_at: string;
};

type StampResult = {
  signedOffByName: string;
  signedOffByInitials: string | null;
  signedOffByTitle: string | null;
  firmName: string | null;
  signedOffAt: string;
  signatureData?: string | null;
  figuresChanged?: boolean;
};

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

/** Appended when an approval is still on file but Overview has moved. */
export const STALE_SIGNOFF_CLAUSE = "figures have changed since; regenerate and re-review";

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

/**
 * Header and PDF line for a stored approval. A pack whose figures moved
 * keeps the signer and says so. It is never relabelled as a plain draft.
 */
export function packDisplayedSignoffLine(input: {
  signedOff: boolean;
  figuresChanged?: boolean;
  reviewedByKind?: string | null;
  reviewedAt?: string | null;
  name?: string | null;
  firmName?: string | null;
  market?: Pick<ResolvedMarket, "locale" | "timezone">;
  firmTimeZone?: string | null;
}): string | null {
  const base = packHeldSignoffLine(input);
  if (!base) return null;
  if (!input.figuresChanged) return base;
  return `${base} — ${STALE_SIGNOFF_CLAUSE}`;
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

function firmMatchesClient(
  stampFirm: string | null,
  clientFirmName: string | null | undefined,
): boolean {
  const client = normFirm(clientFirmName);
  if (!client) return true;
  const stamp = normFirm(stampFirm);
  if (!stamp) return false;
  return stamp === client;
}

/**
 * Page-1 status line. Same words as the tab: a signed-by line, or the
 * figures-changed line when the stamp is still on file but the figures moved.
 */
export function pdfSignoffBadgeLine(
  stamp: {
    signedOffByName: string;
    firmName?: string | null;
    signedOffAt: string;
    figuresChanged?: boolean;
  },
  market?: Pick<ResolvedMarket, "locale" | "timezone">,
): string {
  const name = stamp.signedOffByName.trim();
  if (stamp.figuresChanged) return signoffStatusLine({ kind: "stale", name });
  const when = formatReviewDateTime(stamp.signedOffAt, market);
  return signoffStatusLine({
    kind: "signed",
    name,
    date: when && when !== "—" ? when : null,
  });
}

/**
 * Footer lines. Initials stay off this line. The firm is its own line, with
 * no leading dot, so a wrap cannot start with "·".
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
  const parts = ["Reviewed & signed off", titled];
  if (when.trim()) parts.push(when.trim());
  const lines = [parts.join(" · ")];
  const firm = stamp.firmName?.trim();
  if (firm) lines.push(firm);
  return lines;
}

export function stampFromSignoff(
  signoff: StampSignoff | null | undefined,
  isStale: boolean,
  context?: SignoffStampContext,
): StampResult | null {
  if (!signoff) return null;
  if (
    isSamplePracticeSignoff({
      name: signoff.signed_off_by_name,
      firmName: signoff.firm_name,
    })
  ) {
    return null;
  }
  if (!firmMatchesClient(signoff.firm_name ?? null, context?.clientFirmName)) return null;
  return {
    signedOffByName: signoff.signed_off_by_name,
    signedOffByInitials: signoff.signed_off_by_initials ?? null,
    signedOffByTitle: signoff.signed_off_by_title ?? null,
    firmName: signoff.firm_name ?? null,
    signedOffAt: signoff.signed_off_at,
    signatureData: signoff.signature_data ?? null,
    figuresChanged: isStale,
  };
}
