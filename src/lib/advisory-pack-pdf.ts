/**
 * Advisory pack PDF — filename, draft disclosure, and sign-off stamp.
 *
 * The bytes are the same react-pdf shell as the other accountant reports
 * (`PDFDocument` + footer stamp). This module stays free of a top-level
 * react-pdf import so the pack panel can call it from the client.
 */
import type { AccountantProfile } from "@/contexts/accountant-profile";
import type { ResolvedMarket } from "@/lib/market";
import { packSectionsForPdf, type AdvisoryPack, type PackStatus } from "@/lib/advisory-pack";
import { packStatusLabel } from "@/lib/advisory-pack";
import { isSamplePracticeSignoff } from "@/lib/review-signoff-stamp";

/** Same shape as the report footer stamp. Kept local so this module does not import react-pdf. */
export type AdvisoryPackPdfStamp = {
  signedOffByName: string;
  signedOffByInitials: string | null;
  signedOffByTitle: string | null;
  firmName: string | null;
  signedOffAt: string;
  signatureData?: string | null;
};

/** Shown on every pack that has not been signed off. Exact sentence. */
export const ADVISORY_PACK_DRAFT_DISCLOSURE = "Draft for accountant review. Not sent.";

export type AdvisoryPackPdfSection = {
  title: string;
  body: string;
  bullets?: string[];
};

/**
 * Built-in Helvetica is WinAnsi. The macron in MILŌN and a few arrows
 * render blank, so the PDF uses the ASCII product spelling.
 */
export function pdfSafeText(value: string): string {
  return value
    .replace(/MILŌN/g, "Milon")
    .replace(/Milōn/g, "Milon")
    .replace(/\u014D/g, "o")
    .replace(/\u014C/g, "O")
    .replace(/\u2212/g, "-")
    .replace(/\u2192/g, " - ")
    .replace(/\u2190/g, " - ")
    .replace(/[\u2191\u2193\u25B2\u25BC]/g, "");
}

export function advisoryPackPdfFilename(clientName: string, version?: number | null): string {
  const raw = clientName.trim() || "Client";
  const slug = raw.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "Client";
  const v = version != null && version > 0 ? `_v${version}` : "";
  return `${slug}_Advisory_Pack${v}.pdf`;
}

/**
 * Name stamped on a pack the current user signed.
 * Signup name first (same source as other report sign-offs), then the firm
 * contact on the PDF header, then the email local-part.
 */
export function signerNameForPackStamp(
  user: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  } | null,
  accountantName: string,
): string | null {
  const meta = user?.user_metadata ?? {};
  const full = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  const brand = accountantName.trim();
  const email = user?.email?.split("@")[0]?.trim() ?? "";
  return full || name || brand || email || null;
}

function initialsFromName(name: string): string | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const initials = parts
    .map((p) => p[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
  return initials || null;
}

export function advisoryPackPdfStamp(input: {
  status: PackStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewedByKind: "accountant" | "owner" | null;
  userId: string | null;
  /** Resolved person name. Used only when this user is the signer and no DB name was recorded. */
  signerName: string | null;
  firmName: string;
  signatureDataUrl: string | null;
  /** DB-first name of the recorded signer. Wins over the viewer's profile. */
  recordedSignerName?: string | null;
  recordedFirmName?: string | null;
}): AdvisoryPackPdfStamp | null {
  if (input.status !== "approved" || !input.reviewedAt) return null;
  if (input.reviewedByKind !== "accountant" && input.reviewedByKind !== "owner") return null;

  const isSigner = Boolean(input.userId && input.reviewedBy && input.userId === input.reviewedBy);
  const personal = input.signerName?.trim() ?? "";
  const recordedName = input.recordedSignerName?.trim() ?? "";
  const recordedFirm = input.recordedFirmName?.trim() ?? "";
  const recordedOk =
    Boolean(recordedName) &&
    !isSamplePracticeSignoff({
      name: recordedName,
      firmName: recordedFirm || input.firmName,
    });
  const role = input.reviewedByKind === "owner" ? "Owner" : "Accountant";
  const signedOffByName = pdfSafeText(recordedOk ? recordedName : isSigner && personal ? personal : role);
  const signature =
    isSigner && input.signatureDataUrl?.startsWith("data:image/") ? input.signatureDataUrl : null;
  const firmRaw = recordedOk && recordedFirm ? recordedFirm : input.firmName.trim();

  return {
    signedOffByName,
    signedOffByInitials: initialsFromName(signedOffByName),
    signedOffByTitle: null,
    firmName: firmRaw ? pdfSafeText(firmRaw) : null,
    signedOffAt: input.reviewedAt,
    signatureData: signature,
  };
}

/** Status, version, and period under the PDF title. */
export function advisoryPackPdfPeriodLine(
  pack: Pick<AdvisoryPack, "status" | "requires_review" | "period_label" | "version" | "content">,
): string {
  const period = pack.period_label?.trim() || pack.content.periodLabel?.trim() || "";
  return pdfSafeText(
    [`v${pack.version}`, packStatusLabel(pack.status, pack.requires_review), period]
      .filter(Boolean)
      .join(" · "),
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadAdvisoryPackPdf(input: {
  pack: AdvisoryPack;
  profile: AccountantProfile;
  userId: string | null;
  user?: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  } | null;
  market?: ResolvedMarket;
  recordedSigner?: { name: string; firmName: string | null } | null;
  /** Fictional client. Stamps SAMPLE and keeps the live pack and the sign-off. */
  sample?: boolean;
}): Promise<{ blob: Blob; filename: string; signed: boolean }> {
  const [{ pdf }, { AdvisoryPackPDF }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/reports/advisory-pack"),
  ]);

  const clientName = input.pack.content.clientName.trim() || "Client";
  const filename = advisoryPackPdfFilename(clientName, input.pack.version);
  const stamp = advisoryPackPdfStamp({
    status: input.pack.status,
    reviewedAt: input.pack.reviewed_at,
    reviewedBy: input.pack.reviewed_by,
    reviewedByKind: input.pack.reviewed_by_kind,
    userId: input.userId,
    signerName: signerNameForPackStamp(input.user ?? null, input.profile.accountantName),
    firmName: input.profile.firmName,
    signatureDataUrl: input.profile.signatureDataUrl,
    recordedSignerName: input.recordedSigner?.name ?? null,
    recordedFirmName: input.recordedSigner?.firmName ?? null,
  });
  const sections: AdvisoryPackPdfSection[] = packSectionsForPdf(input.pack.content.sections, {
    signed: Boolean(stamp),
    firmName: stamp?.firmName ?? input.profile.firmName,
  }).map((s) => ({
    title: s.title,
    body: s.body,
    bullets: s.bullets,
  }));

  const blob = await pdf(
    AdvisoryPackPDF({
      smeData: { name: pdfSafeText(clientName), period: advisoryPackPdfPeriodLine(input.pack) },
      accountantProfile: input.profile,
      sections,
      draftDisclosure: stamp ? null : ADVISORY_PACK_DRAFT_DISCLOSURE,
      reviewSignoff: stamp,
      sample: input.sample,
      market: input.market,
    }) as Parameters<typeof pdf>[0],
  ).toBlob();

  triggerDownload(blob, filename);
  return { blob, filename, signed: Boolean(stamp) };
}
