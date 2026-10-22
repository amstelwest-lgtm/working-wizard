/**
 * Harness preview for the Tax Specialist panel on the client profile and
 * the drafted tax pack the accountant reviews. SAMPLE fixture data only —
 * no database, no model call, no real client, no tokens.
 */
import { AccountantSendFileList } from "@/components/accountant-send-files";
import { SendAgentCard } from "@/components/send-agent-panel";
import { TaxPackCard, type TaxPackDraftRow } from "@/components/tax-pack-panel";
import { SEND_DEFAULT_ITEM_KEYS } from "@/lib/client-agent-send";
import type { AgentSendRow } from "@/lib/client-agent-send.functions";
import { sampleTaxPackBody, sampleTaxPackChecks } from "@/lib/tax-deliverable-fixture";

const noop = () => undefined;

const RECEIVED_SEND: AgentSendRow = {
  id: "11111111-2222-4333-8444-555555555555",
  expiresAt: "2026-11-05T12:00:00.000Z",
  revokedAt: null,
  consentAt: "2026-10-18T09:00:00.000Z",
  completedAt: "2026-10-20T10:30:00.000Z",
  reviewedAt: null,
  open: false,
  items: [
    {
      itemKey: "practice_income_expenses",
      label: null,
      totalsOnly: false,
      status: "received",
      quality: "good",
      explanation: null,
      documentPaths: ["harness-client/sample-practice-income.pdf"],
    },
    {
      itemKey: "medical_aid_certificate",
      label: null,
      totalsOnly: true,
      status: "received",
      quality: "good",
      explanation: null,
      documentPaths: ["harness-client/sample-medical-aid-certificate.pdf"],
    },
    {
      itemKey: "ra_contribution_certificate",
      label: null,
      totalsOnly: false,
      status: "received",
      quality: "good",
      explanation: null,
      documentPaths: ["harness-client/sample-ra-certificate.pdf"],
    },
    {
      itemKey: "travel_logbook",
      label: null,
      totalsOnly: false,
      status: "received",
      quality: "incomplete",
      explanation: "No vehicle was used for the practice this year.",
      documentPaths: [],
    },
  ],
  files: [
    {
      id: "file-income",
      itemKey: "practice_income_expenses",
      displayName: "sample-practice-income-2026.pdf",
      hasPassword: false,
    },
    {
      id: "file-medical",
      itemKey: "medical_aid_certificate",
      displayName: "sample-medical-aid-certificate.pdf",
      hasPassword: true,
    },
  ],
};

function sampleDrafts(): TaxPackDraftRow[] {
  return [
    {
      id: "sample-tax-pack",
      body: sampleTaxPackBody(),
      status: "draft",
      checks: sampleTaxPackChecks(),
    },
  ];
}

export function TaxPackPreview({ view }: { view: "profile" | "draft" }) {
  const taxPack = (
    <TaxPackCard
      drafts={sampleDrafts()}
      canDraft={view === "profile"}
      busy={false}
      notice={null}
      onDraft={noop}
      onApprove={noop}
      onDiscard={noop}
    />
  );
  if (view === "draft") {
    return (
      <main className="min-h-screen bg-white p-4 text-[#102A43]">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.16em]">Fixture proof — not a client file</p>
          {taxPack}
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-white p-4 text-[#102A43]">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.16em]">Fixture proof — not a client file</p>
        <SendAgentCard
          market={{ locale: "en-ZA", timezone: "Africa/Johannesburg" }}
          fresh={null}
          open={null}
          busy={false}
          ready
          loaded
          notice={null}
          firstName=""
          email=""
          selectedKeys={[...SEND_DEFAULT_ITEM_KEYS]}
          otherLabel=""
          onFirstName={noop}
          onEmail={noop}
          onToggleItem={noop}
          onOtherLabel={noop}
          onMint={noop}
          onCopy={noop}
          onRevoke={noop}
          received={RECEIVED_SEND}
          onOpenDocument={noop}
          onReview={noop}
          fileList={
            <AccountantSendFileList
              files={RECEIVED_SEND.files}
              revealed={null}
              busyFileId={null}
              onShow={noop}
              onToggleVisible={noop}
              onCopy={noop}
            />
          }
          taxPack={taxPack}
        />
      </div>
    </main>
  );
}
