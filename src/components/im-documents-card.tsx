/**
 * Firm Documents card. Presentational only — the access panel loads data.
 */
import type { ImCloudPill } from "@/lib/im-documents-status";
import { IM_DOCUMENTS_COMING_SOON } from "@/lib/im-documents-status";

export type DocumentClientOption = { id: string; name: string };

export type DocumentProviderRow = {
  provider: "google" | "microsoft";
  label: string;
  pill: ImCloudPill;
  connectLabel: string | null;
};

export function DocumentsCardView({
  clients,
  clientId,
  showClientPicker,
  comingSoon,
  providers,
  paused,
  forwarding,
  senders,
  saving,
  showDisconnect,
  note,
  onClientId,
  onConnect,
  onDisconnect,
  onSendersChange,
  onSaveSenders,
}: {
  clients: readonly DocumentClientOption[];
  clientId: string;
  showClientPicker: boolean;
  comingSoon: boolean;
  providers: readonly DocumentProviderRow[];
  paused: boolean;
  forwarding: string | null;
  senders: string;
  saving?: boolean;
  showDisconnect?: boolean;
  note?: string | null;
  onClientId?: (id: string) => void;
  onConnect?: (provider: "google" | "microsoft") => void;
  onDisconnect?: () => void;
  onSendersChange?: (value: string) => void;
  onSaveSenders?: () => void;
}) {
  return (
    <section
      className="im-card im-cloud-access rounded-2xl border border-[#DBEAFE] bg-white p-5 text-[#102A43] shadow-[0_8px_24px_rgba(16,42,67,0.06)]"
      aria-label="Documents"
      data-im-documents=""
    >
      <h2 className="im-card__title mb-3.5 text-base font-bold text-[#102A43]">Documents</h2>
      {showClientPicker && clients.length > 0 ? (
        <label className="im-cloud-access__client mb-3 flex flex-col gap-1.5 text-xs font-semibold text-[#334E68]">
          Client
          <select
            className="rounded-lg border border-[#DBEAFE] bg-white px-2.5 py-2 text-sm font-medium text-[#102A43]"
            value={clientId}
            onChange={(event) => onClientId?.(event.target.value)}
            data-im-documents-client=""
          >
            {clients.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {comingSoon ? (
        <p className="im-muted m-0 text-sm leading-6 text-[#627D98]" data-im-documents-soon="">
          {IM_DOCUMENTS_COMING_SOON}
        </p>
      ) : (
        <p className="im-muted m-0 text-sm leading-6 text-[#627D98]">
          New files land in Review. Nothing is posted to a ledger.
        </p>
      )}
      {paused ? (
        <p className="im-muted" role="status">
          Ingest is paused.
        </p>
      ) : null}
      <ul className="im-cloud-access__rows m-0 mt-3.5 flex list-none flex-col gap-3 p-0">
        {providers.map((row) => (
          <li key={row.provider} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{row.label}</span>
            <span
              className="im-status inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-[#627D98]"
              data-im-pill={row.provider}
              data-im-pill-state={row.pill}
            >
              {row.pill}
            </span>
            {row.connectLabel ? (
              <button
                type="button"
                className="im-cloud-access__connect rounded-lg bg-[#0B5FFF] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                data-im-connect={row.provider}
                disabled={saving || !clientId}
                onClick={() => onConnect?.(row.provider)}
              >
                {row.connectLabel}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {forwarding ? (
        <div className="im-cloud-access__inbox" data-im-forwarding="">
          <p className="im-cloud-access__inbox-label">Forwarding inbox</p>
          <p className="im-cloud-access__address">{forwarding}</p>
          <label className="im-cloud-access__client mb-3 flex flex-col gap-1.5 text-xs font-semibold text-[#334E68]">
            Allowed senders (comma-separated, empty means any)
            <input
              className="rounded-lg border border-[#DBEAFE] bg-white px-2.5 py-2 text-sm font-medium text-[#102A43]"
              type="text"
              value={senders}
              onChange={(event) => onSendersChange?.(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="im-cloud-access__connect rounded-lg bg-[#0B5FFF] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
            disabled={saving}
            onClick={() => onSaveSenders?.()}
          >
            Save allowed senders
          </button>
        </div>
      ) : null}
      {showDisconnect ? (
        <button
          type="button"
          className="im-cloud-access__text"
          disabled={saving}
          onClick={() => onDisconnect?.()}
        >
          Disconnect and pause ingest
        </button>
      ) : null}
      {note ? (
        <p className="im-muted" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}
