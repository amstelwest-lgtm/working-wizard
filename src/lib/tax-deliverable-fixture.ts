/**
 * Deterministic SAMPLE data for the tax pack — tests and previews only.
 * Every name and figure is invented for the fixture; nothing here comes
 * from a real client, a real document, or a real send.
 */
import {
  parseTaxPackPayload,
  renderTaxPackBody,
  taxPackAssumptions,
  withExtraQueries,
  type TaxPackDraft,
  type TaxPackSourceFile,
} from "@/lib/tax-deliverable";

export const SAMPLE_TAX_PACK_SEND_ID = "11111111-2222-4333-8444-555555555555";
export const SAMPLE_TAX_PACK_CLIENT_NAME = "Sample Physio Practice (fixture)";

export const SAMPLE_TAX_PACK_FILES: TaxPackSourceFile[] = [
  {
    fileId: "file-income",
    itemKey: "practice_income_expenses",
    displayName: "sample-practice-income-2026.pdf",
  },
  {
    fileId: "file-medical",
    itemKey: "medical_aid_certificate",
    displayName: "sample-medical-aid-certificate.pdf",
  },
  {
    fileId: "file-ra",
    itemKey: "ra_contribution_certificate",
    displayName: "sample-ra-certificate.pdf",
  },
  { fileId: "file-irp5", itemKey: "irp5", displayName: "sample-irp5.pdf" },
];

/** A reply shaped the way the model is told to answer. */
export const SAMPLE_TAX_PACK_REPLY = JSON.stringify({
  period_label: "2026 year of assessment (sample)",
  income: [
    {
      label: "Practice turnover (sample)",
      amount_cents: 48_230_000,
      file_id: "file-income",
      confidence: "stated",
      note: "",
    },
  ],
  expenses: [
    {
      label: "Practice expenses per schedule (sample)",
      amount_cents: 21_148_050,
      file_id: "file-income",
      confidence: "stated",
      note: "",
    },
  ],
  medical_aid: [
    {
      label: "Medical scheme contributions, totals only (sample)",
      amount_cents: 2_894_400,
      file_id: "file-medical",
      confidence: "stated",
      note: "",
    },
  ],
  retirement_annuity: [
    {
      label: "Retirement annuity contributions (sample)",
      amount_cents: 3_600_000,
      file_id: "file-ra",
      confidence: "stated",
      note: "",
    },
  ],
  worksheet: [
    {
      label: "ITR12 — employment income per IRP5 code 3601 (sample)",
      amount_cents: 18_000_000,
      file_id: "file-irp5",
      confidence: "uncertain",
      note: "The certificate copy is faint; confirm against the original.",
    },
  ],
  queries: ["The travel logbook was not sent, so no travel figure appears."],
});

export function sampleTaxPackDraft(): TaxPackDraft {
  const parsed = parseTaxPackPayload(SAMPLE_TAX_PACK_REPLY, SAMPLE_TAX_PACK_FILES);
  if (!parsed) throw new Error("fixture reply must parse");
  return withExtraQueries(parsed, [
    "sample-bank-statement.pdf is password-protected and could not be opened. Ask the client to confirm the password.",
  ]);
}

export function sampleTaxPackBody(): string {
  return renderTaxPackBody({
    draft: sampleTaxPackDraft(),
    files: SAMPLE_TAX_PACK_FILES,
    clientName: SAMPLE_TAX_PACK_CLIENT_NAME,
    sendId: SAMPLE_TAX_PACK_SEND_ID,
  });
}

export function sampleTaxPackChecks(): Array<{ id: string; text: string; checked: boolean }> {
  return taxPackAssumptions(sampleTaxPackDraft(), SAMPLE_TAX_PACK_FILES);
}
