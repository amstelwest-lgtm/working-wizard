import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SourceDocumentsView } from "@/components/source-documents-panel";
import { buildSourceDocumentsModel, type SourceProposalRow } from "@/lib/source-documents-ui";
import "@/styles.css";

const CLIENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const proposal = (patch: Partial<SourceProposalRow> = {}): SourceProposalRow => ({
  id: "proposal-1",
  document_id: "doc-1",
  target_ledger: "qbo",
  doc_type: "bill",
  mode: "draft",
  draft_holding: "held_in_milon",
  status: "proposed",
  supplier_key: "acme",
  supplier_display_name: "Acme Supplies",
  document_number: "INV-14",
  amount: 1150,
  issued_on: "2026-10-01",
  payload: {
    contact: { name: "Acme Supplies", vat_number: "4123456789", create_new: false },
    invoice_number: "INV-14",
    issued_on: "2026-10-01",
    currency: "ZAR",
    amounts_are: "inclusive",
    lines: [{ description: "Paper", amount: "1000.00" }],
    tax_total: "150.00",
    total: "1150.00",
    mode: "draft",
  },
  flags: { final_locked: true },
  created_at: "2026-10-11T08:00:00.000Z",
  ...patch,
});

const view =
  new URLSearchParams(window.location.search).get("view") === "accountant" ? "accountant" : "owner";

const model =
  view === "accountant"
    ? buildSourceDocumentsModel({
        surface: "review",
        viewer: {
          clientHasFirm: true,
          isOwner: false,
          isFirmMemberWithAccess: true,
          name: "Ada Nkosi",
        },
        documents: [
          {
            id: "doc-1",
            storage_path: `${CLIENT}/acme-inv-14.pdf`,
            status: "proposed",
            received_at: "2026-10-11T08:00:00.000Z",
          },
          {
            id: "doc-2",
            storage_path: `${CLIENT}/northline-inv-9.pdf`,
            status: "proposed",
            received_at: "2026-10-02T08:00:00.000Z",
          },
        ],
        extractions: [],
        proposals: [
          proposal(),
          proposal({
            id: "proposal-2",
            document_id: "doc-2",
            target_ledger: "xero",
            draft_holding: "ledger_draft",
            status: "approved",
            supplier_key: "northline",
            supplier_display_name: "Northline Print",
            document_number: "INV-9",
            approved_by: "user-ada",
            approved_at: "2026-10-12T07:41:00.000Z",
            flags: { final_locked: false },
            payload: {
              contact: { name: "Northline Print", vat_number: null, create_new: false },
              invoice_number: "INV-9",
              issued_on: "2026-09-28",
              currency: "ZAR",
              amounts_are: "exclusive",
              lines: [{ description: "Print run", amount: "800.00" }],
              tax_total: "120.00",
              total: "920.00",
              mode: "draft",
            },
            created_at: "2026-10-02T08:00:00.000Z",
          }),
        ],
        trust: [
          { supplier_key: "acme", clean_approved_drafts: 1 },
          { supplier_key: "northline", clean_approved_drafts: 3 },
        ],
        names: { "user-ada": "Ada Nkosi" },
        connectedLedgers: ["qbo"],
        timeZone: "UTC",
      })
    : buildSourceDocumentsModel({
        surface: "upload",
        viewer: { clientHasFirm: true, isOwner: true, isFirmMemberWithAccess: false },
        documents: [
          {
            id: "doc-new",
            storage_path: `${CLIENT}/receipt-12-oct.pdf`,
            status: "received",
            received_at: "2026-10-12T09:00:00.000Z",
          },
          {
            id: "doc-1",
            storage_path: `${CLIENT}/acme-inv-14.pdf`,
            status: "proposed",
            received_at: "2026-10-11T08:00:00.000Z",
          },
        ],
        extractions: [],
        proposals: [proposal()],
        trust: [{ supplier_key: "acme", clean_approved_drafts: 1 }],
        duplicate: true,
        connectedLedgers: ["qbo"],
        timeZone: "UTC",
      });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main
      className="mx-auto min-h-screen max-w-3xl bg-white px-4 py-6 text-[#102A43] sm:px-6"
      data-source-docs-ready="true"
    >
      <SourceDocumentsView model={model} />
    </main>
  </StrictMode>,
);
