/**
 * Client Brain — first step of the reading path.
 * Confirms Xero, QuickBooks, or an upload before Health.
 * Dark uses portal ink. Light keeps the cream card.
 *
 * The title uses the same open-request kinds as Overview's next step:
 * statement gaps mean the data is not up to date; aged debtors/creditors
 * stay named while the statements themselves stay current.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QboConnectCard } from "@/components/qbo-connect";
import { XeroConnectCard } from "@/components/xero-connect";
import { dataSectionStatus, isOpenDataRequest, type DataRequestKind } from "@/lib/data-requests";
import { listDataRequests } from "@/lib/data-requests.functions";
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
  const list = useServerFn(listDataRequests);
  const [openKinds, setOpenKinds] = useState<DataRequestKind[]>([]);

  useEffect(() => {
    let cancelled = false;
    void list({ data: { clientId } })
      .then((res) => {
        if (cancelled) return;
        setOpenKinds(
          res.requests.filter(isOpenDataRequest).map((row) => row.kind),
        );
      })
      .catch(() => {
        if (!cancelled) setOpenKinds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, list]);

  const status = dataSectionStatus({ freshness, openKinds });

  return (
    <section
      id="data-up-to-date"
      className="data-fresh"
      aria-label={status.title}
      data-data-fresh=""
    >
      <span className="data-fresh__kicker">Data</span>
      <h2 className="data-fresh__title">{status.title}</h2>
      <p className="data-fresh__lede">
        Confirm Xero or QuickBooks is current, or upload the statements. Then continue to Health.
      </p>
      {status.note ? <p className="data-fresh__note">{status.note}</p> : null}
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
