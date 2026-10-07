/**
 * Advisory pack PDF: filename, draft disclosure, sign-off stamp, and a real render.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/advisory-pack-pdf-test.mts
 */
import { createElement } from "react";
import { extractText, getDocumentProxy } from "unpdf";
import {
  ADVISORY_PACK_DRAFT_DISCLOSURE,
  advisoryPackPdfFilename,
  advisoryPackPdfPeriodLine,
  advisoryPackPdfStamp,
  pdfSafeText,
  signerNameForPackStamp,
} from "../src/lib/advisory-pack-pdf";
import type { AdvisoryPack } from "../src/lib/advisory-pack";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  ADVISORY_PACK_DRAFT_DISCLOSURE === "Draft for accountant review. Not sent.",
  "draft disclosure sentence",
);
assert(
  advisoryPackPdfFilename("QA US Test LLC", 1) === "QA_US_Test_LLC_Advisory_Pack_v1.pdf",
  "filename uses the client name",
);
assert(advisoryPackPdfFilename("  ", 2) === "Client_Advisory_Pack_v2.pdf", "empty name falls back");
assert(pdfSafeText("Prepared by MILŌN.") === "Prepared by Milon.", "macron is WinAnsi-safe");

assert(
  signerNameForPackStamp(
    { email: "alex@firm.test", user_metadata: { full_name: "Alex Accountant" } },
    "Brand Contact",
  ) === "Alex Accountant",
  "signup name wins over the firm contact",
);
assert(
  signerNameForPackStamp({ email: "alex@firm.test", user_metadata: {} }, "Brand Contact") ===
    "Brand Contact",
  "firm contact is the next name",
);

const signed = advisoryPackPdfStamp({
  status: "approved",
  reviewedAt: "2026-10-07T15:04:00.000Z",
  reviewedBy: "user-1",
  reviewedByKind: "accountant",
  userId: "user-1",
  signerName: "Alex Accountant",
  firmName: "North Books",
  signatureDataUrl: "data:image/png;base64,aaaa",
});
assert(signed?.signedOffByName === "Alex Accountant", "signer name is stamped");
assert(signed?.signedOffByInitials === "AA", "initials from the signer name");
assert(signed?.firmName === "North Books", "firm on the stamp");
assert(signed?.signedOffAt === "2026-10-07T15:04:00.000Z", "sign-off time is stamped");
assert(signed?.signatureData?.startsWith("data:image/"), "signer signature is copied");

const someoneElse = advisoryPackPdfStamp({
  status: "approved",
  reviewedAt: "2026-10-07T15:04:00.000Z",
  reviewedBy: "user-1",
  reviewedByKind: "accountant",
  userId: "user-2",
  signerName: "Someone Else",
  firmName: "North Books",
  signatureDataUrl: "data:image/png;base64,aaaa",
});
assert(someoneElse?.signedOffByName === "Accountant", "another user is not named as the signer");
assert(someoneElse?.signatureData == null, "another user's signature is not copied");

assert(
  advisoryPackPdfStamp({
    status: "draft",
    reviewedAt: null,
    reviewedBy: null,
    reviewedByKind: null,
    userId: "user-1",
    signerName: "Alex Accountant",
    firmName: "North Books",
    signatureDataUrl: null,
  }) === null,
  "a draft has no sign-off stamp",
);

const period = advisoryPackPdfPeriodLine({
  status: "draft",
  requires_review: true,
  period_label: "Sep 2026",
  version: 1,
  content: { periodLabel: null } as AdvisoryPack["content"],
});
assert(period === "v1 · Draft · Sep 2026", `period line: ${period}`);

async function textOf(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } finally {
    await pdf.destroy();
  }
}

const { renderToBuffer } = await import("@react-pdf/renderer");
const { AdvisoryPackPDF } = await import("../src/reports/advisory-pack");

const profile = {
  firmName: "North Books",
  logoUrl: null,
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "Alex Accountant",
  accountantEmail: "alex@northbooks.test",
  tagline: null,
  signatureDataUrl: null,
};

const draftBuf = await renderToBuffer(
  createElement(AdvisoryPackPDF, {
    smeData: { name: "QA US Test LLC", period },
    accountantProfile: profile,
    draftDisclosure: ADVISORY_PACK_DRAFT_DISCLOSURE,
    sections: [
      {
        title: "In one line",
        body: "Prepared by MILŌN from statement-level figures.",
        bullets: ["Debtor days are the number to move"],
      },
    ],
  }),
);
assert(draftBuf.length > 1000, "draft pdf rendered");
const draftText = await textOf(draftBuf);
assert(draftText.includes(ADVISORY_PACK_DRAFT_DISCLOSURE), "draft pdf contains the disclosure");
assert(draftText.includes("QA US Test LLC"), "draft pdf names the client");
assert(draftText.includes("Milon"), "product name survives Helvetica");
assert(!draftText.includes("Reviewed & signed off by"), "draft pdf has no sign-off stamp");
assert(!/claude|anthropic/i.test(draftText), "draft pdf hides vendor names");

const signedBuf = await renderToBuffer(
  createElement(AdvisoryPackPDF, {
    smeData: { name: "QA US Test LLC", period: "v1 · Signed off · Sep 2026" },
    accountantProfile: profile,
    reviewSignoff: { ...signed!, signatureData: null },
    sections: [
      {
        title: "In one line",
        body: "QA US Test LLC is healthy at 80/100.",
      },
    ],
  }),
);
const signedText = await textOf(signedBuf);
assert(signedText.includes("Alex Accountant"), "signed pdf stamps the accountant name");
assert(signedText.includes("Reviewed & signed off by"), "signed pdf uses the report footer stamp");
assert(
  !signedText.includes(ADVISORY_PACK_DRAFT_DISCLOSURE),
  "signed pdf drops the draft disclosure",
);
assert(signedText.includes("healthy at 80/100"), "signed pdf includes the pack body");

console.log("advisory-pack-pdf: all checks passed");
