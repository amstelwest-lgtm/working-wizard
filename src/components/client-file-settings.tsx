/**
 * Client-file Settings. Practice billing and team stay on /settings.
 */
import { ClientSubpageFrame } from "@/components/client-subpage";

export function ClientFileSettings({
  clientName,
  onInvite,
  onPracticeSettings,
}: {
  clientName: string;
  onInvite: () => void;
  onPracticeSettings: () => void;
}) {
  return (
    <ClientSubpageFrame
      id="settings"
      eyebrow="File"
      title="Settings"
      subtitle={`Owner access for ${clientName}. Practice billing, brand, and team stay in practice settings.`}
    >
      <section
        className="rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]"
        data-client-settings=""
      >
        <h2 className="text-sm font-semibold text-[#102A43] dark:text-[#F4F7FB]">Owner</h2>
        <p className="mt-1 text-sm text-[#3D5270] dark:text-[#C5D4E4]">
          Invite the owner of this client. Copy a link, or email it.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn gold" data-invite-owner-entry="" onClick={onInvite}>
            Invite owner
          </button>
          <button type="button" className="btn ghost" onClick={onPracticeSettings}>
            Practice settings
          </button>
        </div>
      </section>
    </ClientSubpageFrame>
  );
}
