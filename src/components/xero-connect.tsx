import { useEffect, useState } from "react";
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
import { formatIsoDateUTC, yearToDateTitle } from "@/lib/statement-period";

type Props = {
  clientId: string | null;
  /** Owner board should return to /app; accountant studio to /clients/:id. */
  returnPath?: string;
  /** Bump to reload status after a sync started from another card. */
  refreshToken?: number;
  onSyncComplete?: (
    inputs: Record<string, string>,
    summary: XeroSyncResult["summary"],
  ) => void;
};

function fmtDate(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
}): string[] {
  const window =
    input.from && input.to
      ? `Bank Summary ${formatIsoDateUTC(input.from)} – ${formatIsoDateUTC(input.to)}`
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

export function XeroConnectCard({ clientId, returnPath, refreshToken = 0, onSyncComplete }: Props) {
  const fetchStatus = useServerFn(getXeroStatus);
  const fetchAuthUrl = useServerFn(getXeroAuthUrl);
  const doSync = useServerFn(triggerXeroSync);
  const doDisconnect = useServerFn(disconnectXero);
  const checkConfig = useServerFn(getXeroConfig);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<XeroStatus>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [lastSync, setLastSync] = useState<XeroSyncResult["summary"] | null>(null);

  const load = async () => {
    if (!clientId) return;
    setLoadingStatus(true);
    try {
      const [cfg, s] = await Promise.all([
        checkConfig({ data: undefined as never }),
        fetchStatus({ data: { clientId } }),
      ]);
      setConfigured(cfg.configured);
      setStatus(s);
    } catch {
      // silent
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, refreshToken]);

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
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!clientId || !confirm("Disconnect Xero? Synced data stays in Milōn.")) return;
    setDisconnecting(true);
    try {
      await doDisconnect({ data: { clientId } });
      setStatus(null);
      setLastSync(null);
      toast.success("Xero disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  if (!clientId) return null;

  if (loadingStatus && configured === null) {
    return (
      <div className="ledger-connect ledger-connect--panel ledger-connect--row">
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
          Xero sync isn&apos;t switched on for this workspace yet. Export a P&amp;L and
          balance sheet from Xero and upload them — the board fills in the same way.
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
    });
    return (
      <div className={`ledger-connect ${isError ? "ledger-connect--error" : "ledger-connect--xero"}`}>
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
                : status.periodLabel
                  ? `Last sync ${fmtDate(status.lastSyncedAt)} · Month to date ${status.periodLabel}${
                      status.revenue != null ? ` · Revenue ${fmtExact(status.revenue)}` : ""
                    }${
                      status.ytdPeriodLabel
                        ? ` · ${yearToDateTitle(status.ytdBasis)} ${status.ytdPeriodLabel}${
                            status.ytdRevenue != null ? ` · Revenue ${fmtExact(status.ytdRevenue)}` : ""
                          }`
                        : ""
                    }`
                  : `Linked. Last sync ${fmtDate(status.lastSyncedAt)}. Sync again — the stored total has no period dates.`}
            </p>
            <p id="xero-sync-proof" className="ledger-connect__meta">
              {status.periodLabel ? `P&L month to date ${status.periodLabel}` : "P&L period not dated yet"}
              {status.ytdPeriodLabel
                ? ` · ${yearToDateTitle(status.ytdBasis)} ${status.ytdPeriodLabel}`
                : ""}
              <br />
              {`Balance sheet as of ${
                formatIsoDateUTC(lastSync?.bsAsOf ?? status.bsAsOf) || "the last sync"
              }`}
              <br />
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
            </p>
          </div>
          <div className="ledger-connect__actions">
            <button
              onClick={handleSync}
              disabled={syncing || disconnecting}
              title="Sync now"
              className="ledger-connect__sync"
            >
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
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

        {(lastSync || status.periodLabel) && (
          <div className="ledger-connect__stats ledger-connect__stats--xero">
            {[
              {
                label: "Month to date",
                value: lastSync?.periodLabel ?? status.periodLabel ?? "—",
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
                value: lastSync?.ytdPeriodLabel ?? status.ytdPeriodLabel ?? "—",
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
                value: formatIsoDateUTC(lastSync?.bsAsOf ?? status.bsAsOf) || "—",
              },
              {
                label: "Bank accounts",
                value:
                  (lastSync?.bankCount ?? status.bankCount) == null
                    ? "—"
                    : String(lastSync?.bankCount ?? status.bankCount),
              },
              { label: "Bank total", value: fmtExact(lastSync?.bankTotal ?? status.bankTotal) },
              { label: "Total assets", value: fmtExact(lastSync?.totalAssets ?? status.totalAssets) },
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
    <div className="ledger-connect ledger-connect--panel ledger-connect--split">
      <div>
        <p className="ledger-connect__kicker" style={{ marginBottom: 4 }}>
          Xero
        </p>
        <p className="ledger-connect__hint">
          Connect to sync P&amp;L, the balance sheet and bank balances into this client&apos;s figures
        </p>
      </div>
      <BrandConnectButton brand="xero" busy={connecting} onClick={handleConnect} />
    </div>
  );
}
