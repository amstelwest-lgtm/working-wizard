import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getXeroStatus,
  getXeroAuthUrl,
  triggerXeroSync,
  disconnectXero,
  getXeroConfig,
  type XeroStatus,
  type XeroSyncResult,
} from "@/lib/xero.functions";
import { RefreshCw, Unlink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { BrandConnectButton } from "@/components/brand-connect-button";
import { formatDateRange } from "@/lib/market/format";
import { formatIsoDateUTC, statementSpanLabel, yearToDateTitle } from "@/lib/statement-period";
import { useMarketFormat } from "@/contexts/market";
import { describeLedgerLink } from "@/lib/ledger-link-copy";
import { ratiosAgedReadLine } from "@/lib/deliverable-input-config";
import type { MoneyMarket } from "@/lib/market/format";
import { CONNECTION_NOT_CONNECTED } from "@/lib/connection-status-deadline";
import { useConnectionProbe } from "@/lib/use-connection-probe";

type Props = {
  clientId: string | null;
  /** Owner board should return to /app; accountant studio to /clients/:id. */
  returnPath?: string;
  /** Bump to reload status after a sync started from another card. */
  refreshToken?: number;
  onSyncComplete?: (inputs: Record<string, string>, summary: XeroSyncResult["summary"]) => void;
  /** Statement figures Collections uses. Empty aged pulls must not hide them. */
  financials?: Record<string, unknown> | null;
  market?: MoneyMarket;
};

function fmtExact(n: number | null) {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bankSummaryLines(input: {
  from: string | null;
  to: string | null;
  count: number | null;
  total: number | null;
  warning: string | null;
  openingNote: string | null;
  linesNote: string | null;
  market: { locale?: string | null };
}): string[] {
  const window =
    input.from && input.to
      ? `Bank Summary ${formatDateRange(input.from, input.to, input.market)}`
      : null;
  const accounts =
    input.count == null
      ? null
      : `${input.count} bank ${input.count === 1 ? "account" : "accounts"}${
          input.total != null ? ` · ${fmtExact(input.total)}` : ""
        }`;
  return [window, accounts, input.warning, input.openingNote, input.linesNote].filter(
    (line): line is string => Boolean(line),
  );
}

export function XeroConnectCard({
  clientId,
  returnPath,
  refreshToken = 0,
  onSyncComplete,
  financials,
  market,
}: Props) {
  const { dateTime, market: contextMarket } = useMarketFormat();
  const dateMarket = market ?? contextMarket;
  const fetchStatus = useServerFn(getXeroStatus);
  const fetchAuthUrl = useServerFn(getXeroAuthUrl);
  const doSync = useServerFn(triggerXeroSync);
  const doDisconnect = useServerFn(disconnectXero);
  const checkConfig = useServerFn(getXeroConfig);

  const { gate, configured, status, reload, clear } = useConnectionProbe<XeroStatus>({
    clientId,
    refreshToken,
    id: "xero",
    probe: async () => {
      const [cfg, next] = await Promise.all([
        checkConfig({ data: undefined as never }),
        fetchStatus({ data: { clientId: clientId! } }),
      ]);
      return { configured: cfg.configured, status: next };
    },
  });
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [lastSync, setLastSync] = useState<XeroSyncResult["summary"] | null>(null);

  const handleConnect = async () => {
    if (!clientId) return;
    setConnecting(true);
    try {
      const { authUrl } = await fetchAuthUrl({
        data: { clientId, returnPath },
      });
      window.location.href = authUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start Xero OAuth");
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    if (!clientId) return;
    setSyncing(true);
    try {
      const result = await doSync({ data: { clientId } });
      setLastSync(result.summary);
      onSyncComplete?.(result.fields, result.summary);
      const bankStatus = [
        result.summary.openingCashNote,
        result.summary.forecastLinesNote,
        result.summary.bankWarning,
      ]
        .filter((line): line is string => Boolean(line))
        .join(" ");
      toast.success(
        result.summary.bankWarning
          ? "Xero sync saved the P&L and balance sheet."
          : "Xero sync complete.",
        bankStatus ? { description: bankStatus } : undefined,
      );
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
      await reload();
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!clientId || !confirm("Disconnect Xero? Synced data stays in Milōn.")) return;
    setDisconnecting(true);
    try {
      await doDisconnect({ data: { clientId } });
      clear();
      setLastSync(null);
      toast.success("Xero disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  if (!clientId) return null;

  if (gate === "checking") {
    return (
      <div className="ledger-connect ledger-connect--panel ledger-connect--row" data-connection-state="checking">
        <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        <span className="ledger-connect__hint">Checking Xero…</span>
      </div>
    );
  }

  if (configured === false) {
    return (
      <div className="ledger-connect ledger-connect--dashed">
        <p className="ledger-connect__kicker">Xero</p>
        <p className="ledger-connect__body">
          Xero sync isn&apos;t switched on for this workspace yet. Export a P&amp;L and balance
          sheet from Xero and upload them — the board fills in the same way.
        </p>
        <p className="ledger-connect__meta">
          Admins: set <code className="ledger-connect__code">XERO_CLIENT_ID</code>,{" "}
          <code className="ledger-connect__code">XERO_CLIENT_SECRET</code> and{" "}
          <code className="ledger-connect__code">XERO_REDIRECT_URI</code> to enable live sync.
        </p>
      </div>
    );
  }

  if (status) {
    const isError = status.syncStatus === "error" || status.phase === "error";
    const bankLines = bankSummaryLines({
      from: lastSync?.bankFrom ?? status.bankFrom,
      to: lastSync?.bankTo ?? status.bankTo,
      count: lastSync?.bankCount ?? status.bankCount,
      total: lastSync?.bankTotal ?? status.bankTotal,
      warning: lastSync?.bankWarning ?? status.bankWarning,
      openingNote: lastSync?.openingCashNote ?? status.openingCashNote,
      linesNote: lastSync?.forecastLinesNote ?? status.forecastLinesNote,
      market: dateMarket,
    });
    const mtdLabel = statementSpanLabel({
      periodStart: lastSync?.periodStart ?? status.periodStart,
      periodEnd: lastSync?.periodEnd ?? status.periodEnd,
      periodLabel: lastSync?.periodLabel ?? status.syncFigures?.periodLabel ?? status.periodLabel,
      market: dateMarket,
    });
    const ytdLabel = statementSpanLabel({
      periodLabel: lastSync?.ytdPeriodLabel ?? status.syncFigures?.ytdPeriodLabel ?? status.ytdPeriodLabel,
      market: dateMarket,
    });
    const linkCopy = describeLedgerLink(
      {
        provider: "xero",
        lastSyncedAt: status.lastSyncedAt,
        syncStatus: isError ? "error" : status.syncStatus,
        figuresFromThisSync: Boolean(lastSync) || status.figuresFromThisSync,
        own: lastSync
          ? {
              periodLabel: mtdLabel,
              revenue: lastSync.revenue,
              ytdPeriodLabel: ytdLabel,
              ytdRevenue: lastSync.ytdRevenue,
              ytdBasis: lastSync.ytdBasis,
              cash: lastSync.cash,
            }
          : status.syncFigures
            ? { ...status.syncFigures, periodLabel: mtdLabel, ytdPeriodLabel: ytdLabel }
            : null,
        board: status.boardFigures,
      },
      dateTime,
    );
    const ownPeriod = mtdLabel;
    return (
      <div
        className={`ledger-connect ${isError ? "ledger-connect--error" : "ledger-connect--xero"}`}
      >
        <div className="ledger-connect__head">
          <div className="ledger-connect__identity">
            <div className="ledger-connect__title-row">
              <p className="ledger-connect__kicker" style={{ marginBottom: 0 }}>
                Xero
              </p>
              {isError ? (
                <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-sky-400" />
              )}
            </div>
            <p className="ledger-connect__name">
              {status.tenantName ?? `Tenant ${status.tenantId.slice(0, 8)}`}
            </p>
            <p className="ledger-connect__meta ledger-connect__meta--flush">
              {isError
                ? `Error: ${status.syncError?.slice(0, 80) ?? "unknown"}`
                : linkCopy.statusLine}
              {!isError && linkCopy.figuresLine ? (
                <>
                  <br />
                  {linkCopy.figuresLine}
                </>
              ) : null}
            </p>
            <p id="xero-sync-proof" className="ledger-connect__meta">
              {linkCopy.showOwnStats && ownPeriod ? (
                <>
                  {`P&L month to date ${ownPeriod}`}
                  {ytdLabel
                    ? ` · ${yearToDateTitle(lastSync?.ytdBasis ?? status.ytdBasis)} ${ytdLabel}`
                    : ""}
                  <br />
                </>
              ) : !linkCopy.figuresLine ? (
                <>
                  P&amp;L period not dated yet
                  <br />
                </>
              ) : null}
              {lastSync?.bsAsOf || status.bsAsOf ? (
                <>
                  {`Balance sheet as of ${formatIsoDateUTC(lastSync?.bsAsOf ?? status.bsAsOf, dateMarket)}`}
                  <br />
                </>
              ) : null}
              <span id="xero-bank-summary-status">
                {bankLines.length
                  ? bankLines.map((line, index) => (
                      <span key={`${index}-${line}`}>
                        {index > 0 ? <br /> : null}
                        {line}
                      </span>
                    ))
                  : "Bank balances appear after the next Sync"}
              </span>
              <br />
              <span id="xero-aged-ar-status">
                {ratiosAgedReadLine(
                  lastSync?.agedArLine ?? status.agedArLine,
                  "ar",
                  financials,
                  dateMarket,
                )}
              </span>
              <br />
              <span id="xero-aged-ap-status">
                {ratiosAgedReadLine(
                  lastSync?.agedApLine ?? status.agedApLine,
                  "ap",
                  financials,
                  dateMarket,
                )}
              </span>
            </p>
          </div>
          <div className="ledger-connect__actions">
            <button
              onClick={handleSync}
              disabled={syncing || disconnecting}
              title="Sync now"
              className="ledger-connect__sync"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={syncing || disconnecting}
              title="Disconnect Xero"
              className="ledger-connect__disconnect"
            >
              <Unlink className="h-3 w-3" />
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </div>
        </div>

        {(lastSync || linkCopy.showOwnStats) && (
          <div className="ledger-connect__stats ledger-connect__stats--xero">
            {[
              {
                label: "Month to date",
                value: mtdLabel ?? "—",
              },
              {
                label: "Revenue",
                value: fmtExact(lastSync?.revenue ?? status.revenue),
              },
              {
                label: "Net income",
                value: fmtExact(lastSync?.netIncome ?? status.netIncome),
              },
              {
                label: yearToDateTitle(lastSync?.ytdBasis ?? status.ytdBasis),
                value: ytdLabel ?? "—",
              },
              {
                label: "Year revenue",
                value: fmtExact(lastSync?.ytdRevenue ?? status.ytdRevenue),
              },
              {
                label: "Year net income",
                value: fmtExact(lastSync?.ytdNetIncome ?? status.ytdNetIncome),
              },
              { label: "Cash", value: fmtExact(lastSync?.cash ?? status.cash) },
              {
                label: "Balance sheet",
                value: formatIsoDateUTC(lastSync?.bsAsOf ?? status.bsAsOf, dateMarket) || "—",
              },
              {
                label: "Bank accounts",
                value:
                  (lastSync?.bankCount ?? status.bankCount) == null
                    ? "—"
                    : String(lastSync?.bankCount ?? status.bankCount),
              },
              { label: "Bank total", value: fmtExact(lastSync?.bankTotal ?? status.bankTotal) },
              {
                label: "Total assets",
                value: fmtExact(lastSync?.totalAssets ?? status.totalAssets),
              },
              { label: "Equity", value: fmtExact(lastSync?.equity ?? status.equity) },
            ].map((item) => (
              <div key={item.label}>
                <div className="ledger-connect__stat-label">{item.label}</div>
                {item.value && <div className="ledger-connect__stat-value">{item.value}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ledger-connect ledger-connect--panel ledger-connect--split" data-connection-state="none">
      <div>
        <p className="ledger-connect__kicker" style={{ marginBottom: 4 }}>
          Xero
        </p>
        <p className="ledger-connect__meta">{CONNECTION_NOT_CONNECTED}</p>
        <p className="ledger-connect__hint">
          Connect to sync P&amp;L, the balance sheet and bank balances into this client&apos;s
          figures
        </p>
      </div>
      <BrandConnectButton brand="xero" busy={connecting} onClick={handleConnect} />
    </div>
  );
}
