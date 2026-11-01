/**
 * Harness preview for the Tax Specialist panel on the client profile and
 * the drafted tax pack the accountant reviews. SAMPLE fixture data only —
 * no database, no model call, no real client, no tokens.
 */
import { SendAgentCard } from "@/components/send-agent-panel";
import { TaxPackCard, type TaxPackDraftRow } from "@/components/tax-pack-panel";
import { sampleTaxPackBody, sampleTaxPackChecks } from "@/lib/tax-deliverable-fixture";

const noop = () => undefined;

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
          country="ZA"
          market={{ locale: "en-ZA", timezone: "Africa/Johannesburg" }}
          agents={["financial_manager", "analyst", "advisor", "tax_specialist"]}
          missions={[]}
          agent={null}
          missionKey={null}
          firmNote=""
          firstName=""
          email=""
          sends={[]}
          open={null}
          busy={false}
          ready
          loaded
          notice={null}
          onAgent={noop}
          onMission={noop}
          onFirmNote={noop}
          onFirstName={noop}
          onEmail={noop}
          onMint={noop}
          onResend={noop}
          onRevoke={noop}
          onReview={noop}
          onOpenDocument={noop}
        />
        {taxPack}
      </div>
    </main>
  );
}
