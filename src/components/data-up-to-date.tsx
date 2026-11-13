/**
 * Client Brain — first step of the reading path.
 * Confirms Xero, QuickBooks, Sage, or an upload before Health.
 * Dark uses portal ink. Light keeps the cream card.
 *
 * The title uses the same open-request kinds as Overview's next step:
 * statement gaps mean the data is not up to date; aged debtors/creditors
 * stay named while the statements themselves stay current.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ARAP_GOLD_BTN, ArapAnswerStrip } from "@/components/arap-answer-strip";
import { ConnectionsLibraryUpload } from "@/components/connections-library-upload";
import { QboConnectCard } from "@/components/qbo-connect";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { XeroConnectCard } from "@/components/xero-connect";
import { SageConnectCard } from "@/components/sage-connect";
import {
  booksHeaderSentence,
  booksDrawerHint,
  booksPrimaryKind,
  booksQueriesLabel,
} from "@/lib/books-answer";
import { dataSectionStatus, isOpenDataRequest, type DataRequestKind } from "@/lib/data-requests";
import { listDataRequests } from "@/lib/data-requests.functions";
import type { IngestSnapshotRow } from "@/lib/ledger-link-copy";
import type { SyncResult } from "@/lib/qbo.functions";
import type { XeroSyncResult } from "@/lib/xero.functions";

type Props = {
  clientId: string;
  returnPath: string;
  xeroRefresh?: number;
  qboRefresh?: number;
  sageRefresh?: number;
  onXeroSyncComplete?: (inputs: Record<string, string>, summary: XeroSyncResult["summary"]) => void;
  onQboSyncComplete?: (inputs: Record<string, string>, summary: SyncResult["summary"]) => void;
  onSageSyncComplete?: (inputs: Record<string, string>) => void;
  onUpload: () => void;
  onSageConnectionChange?: () => void;
  /** Last sync or snapshot period. Computed by the shell from live status. */
  freshness: string;
  /** Home chip name. Both connection rows stay "Xero and QuickBooks". */
  ledger?: string | null;
  /** `figureSourceChipLabel` of the statement already on the file. Blank omits the chip. */
  chip?: string | null;
  openQueries?: number;
  onOpenQueries?: () => void;
  /**
   * Display-only kinds. When set, the section does not ask the server again
   * and does not invent a request.
   */
  fixtureOpenKinds?: readonly DataRequestKind[];
  /** Snapshot rows already read for the client. Stamps the ledger cards. */
  ingestSnapshots?: readonly IngestSnapshotRow[];
  children?: ReactNode;
};

export function DataUpToDate({
  clientId,
  returnPath,
  xeroRefresh = 0,
  qboRefresh = 0,
  sageRefresh = 0,
  onXeroSyncComplete,
  onQboSyncComplete,
  onSageSyncComplete,
  onUpload,
  onSageConnectionChange,
  freshness,
  ledger,
  chip,
  openQueries = 0,
  onOpenQueries,
  fixtureOpenKinds,
  ingestSnapshots,
  children,
}: Props) {
  const list = useServerFn(listDataRequests);
  const [fetchedKinds, setFetchedKinds] = useState<DataRequestKind[]>([]);

  useEffect(() => {
    if (fixtureOpenKinds) return;
    let cancelled = false;
    void list({ data: { clientId } })
      .then((res) => {
        if (cancelled) return;
        setFetchedKinds(res.requests.filter(isOpenDataRequest).map((row) => row.kind));
      })
      .catch(() => {
        if (!cancelled) setFetchedKinds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, list, fixtureOpenKinds]);

  const openKinds = fixtureOpenKinds ?? fetchedKinds;
  const status = dataSectionStatus({ freshness, openKinds });
  const primaryKind = booksPrimaryKind({ freshness, openKinds, openQueries });
  const primary =
    primaryKind === "upload" ? (
      <button type="button" className={ARAP_GOLD_BTN} onClick={onUpload}>
        Upload statements
      </button>
    ) : primaryKind === "queries" && onOpenQueries ? (
      <button type="button" className={ARAP_GOLD_BTN} onClick={onOpenQueries}>
        {booksQueriesLabel(openQueries)}
      </button>
    ) : null;

  return (
    <section id="data-up-to-date" aria-label={status.title} data-data-fresh="">
      <ArapAnswerStrip
        heading="Books"
        sentence={booksHeaderSentence({ ledger, freshness, openKinds })}
        chip={ledger?.trim() ? ledger : chip}
        primary={primary}
      />
      <div id="accounting-connect" className="data-fresh__ledgers">
        <XeroConnectCard
          clientId={clientId}
          returnPath={returnPath}
          refreshToken={xeroRefresh}
          onSyncComplete={onXeroSyncComplete}
          ingestSnapshots={ingestSnapshots}
        />
        <QboConnectCard
          clientId={clientId}
          returnPath={returnPath}
          refreshToken={qboRefresh}
          onSyncComplete={onQboSyncComplete}
          ingestSnapshots={ingestSnapshots}
        />
        <SageConnectCard
          clientId={clientId}
          refreshToken={sageRefresh}
          onConnectionChange={onSageConnectionChange}
          onSyncComplete={onSageSyncComplete}
          buttonFirst
        />
        <ConnectionsLibraryUpload clientId={clientId} />
      </div>
      <ReviewInputsDrawer hint={booksDrawerHint(freshness)}>
        <div>
          <h2 className="data-fresh__title">{status.title}</h2>
          <p className="data-fresh__lede">
            Confirm Xero, QuickBooks, or Sage is current, or upload the statements.
          </p>
          {status.note ? <p className="data-fresh__note">{status.note}</p> : null}
          <p className="data-fresh__line" data-data-freshness="">
            {freshness}
          </p>
        </div>
        {primaryKind === "upload" ? null : (
          <button type="button" className="data-fresh__upload" onClick={onUpload}>
            Upload statements
          </button>
        )}
        {children}
      </ReviewInputsDrawer>
    </section>
  );
}
