/**
 * Client Brain — first step of the reading path.
 * Confirms Xero, QuickBooks, or an upload before Health.
 * Cream surface, dark text, so the block stays readable in light mode.
 */
import { QboConnectCard } from "@/components/qbo-connect";
import { XeroConnectCard } from "@/components/xero-connect";
import type { SyncResult } from "@/lib/qbo.functions";
import type { XeroSyncResult } from "@/lib/xero.functions";

type Props = {
  clientId: string;
  returnPath: string;
  xeroRefresh?: number;
  qboRefresh?: number;
  onXeroSyncComplete?: (inputs: Record<string, string>, summary: XeroSyncResult["summary"]) => void;
  onQboSyncComplete?: (inputs: Record<string, string>, summary: SyncResult["summary"]) => void;
  onUpload: () => void;
  /** Last sync or snapshot period. Computed by the shell from live status. */
  freshness: string;
};

export function DataUpToDate({
  clientId,
  returnPath,
  xeroRefresh = 0,
  qboRefresh = 0,
  onXeroSyncComplete,
  onQboSyncComplete,
  onUpload,
  freshness,
}: Props) {
  return (
    <section
      id="data-up-to-date"
      className="data-fresh"
      aria-label="Data up to date"
      data-data-fresh=""
    >
      <span className="data-fresh__kicker">Data</span>
      <h2 className="data-fresh__title">Data up to date</h2>
      <p className="data-fresh__lede">
        Confirm Xero or QuickBooks is current, or upload the statements. Then continue to Health.
      </p>
      <p className="data-fresh__line" data-data-freshness="">
        {freshness}
      </p>
      <div className="data-fresh__ledgers">
        <XeroConnectCard
          clientId={clientId}
          returnPath={returnPath}
          refreshToken={xeroRefresh}
          onSyncComplete={onXeroSyncComplete}
        />
        <QboConnectCard
          clientId={clientId}
          returnPath={returnPath}
          refreshToken={qboRefresh}
          onSyncComplete={onQboSyncComplete}
        />
      </div>
      <button type="button" className="data-fresh__upload" onClick={onUpload}>
        Upload statements
      </button>
    </section>
  );
}
