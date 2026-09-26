import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getQboStatus,
  getQboAuthUrl,
  triggerQboSync,
  disconnectQbo,
  getQboConfig,
  type QboStatus,
  type SyncResult,
} from "@/lib/qbo.functions";
import { RefreshCw, Unlink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { BrandConnectButton } from "@/components/brand-connect-button";
import { yearToDateTitle } from "@/lib/statement-period";

type Props = {
  clientId: string | null;
  /** Owner board should return to /app; accountant studio to /clients/:id. */
  returnPath?: string;
  /** Bump to reload status after a sync started from another card. */
  refreshToken?: number;
  onSyncComplete?: (inputs: Record<string, string>, summary: SyncResult["summary"]) => void;
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

export function QboConnectCard({ clientId, returnPath, refreshToken = 0, onSyncComplete }: Props) {
  const fetchStatus = useServerFn(getQboStatus);
  const fetchAuthUrl = useServerFn(getQboAuthUrl);
  const doSync = useServerFn(triggerQboSync);
  const doDisconnect = useServerFn(disconnectQbo);
  const checkConfig = useServerFn(getQboConfig);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<QboStatus>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult["summary"] | null>(null);

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
      const { authUrl } = await fetchAuthUrl({ data: { clientId, returnPath } });
      window.location.href = authUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start OAuth flow");
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
      toast.success("QuickBooks sync complete — P&L and balance sheet updated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!clientId || !confirm("Disconnect QuickBooks? Synced data stays in Milōn.")) return;
    setDisconnecting(true);
    try {
      await doDisconnect({ data: { clientId } });
      setStatus(null);
      setLastSync(null);
      toast.success("QuickBooks disconnected");
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
        <span className="ledger-connect__hint">Checking QuickBooks…</span>
      </div>
    );
  }

  if (configured === false) {
    return (
      <div className="ledger-connect ledger-connect--dashed">
        <p className="ledger-connect__kicker">QuickBooks Online</p>
        <p className="ledger-connect__body">
          QuickBooks sync isn&apos;t switched on for this workspace yet. You are not stuck: export a
          P&amp;L and balance sheet from QuickBooks (Excel, CSV or PDF) and upload them — the board
          fills in the same way.
        </p>
        <p className="ledger-connect__meta">
          Admins: set <code className="ledger-connect__code">QBO_CLIENT_ID</code>,{" "}
          <code className="ledger-connect__code">QBO_CLIENT_SECRET</code> and{" "}
          <code className="ledger-connect__code">QBO_REDIRECT_URI</code> to enable live sync.
        </p>
      </div>
    );
  }

  if (status) {
    const isError = status.syncStatus === "error";
    const periodLabel = lastSync?.periodLabel ?? status.periodLabel;
    const ytdPeriodLabel = lastSync?.ytdPeriodLabel ?? status.ytdPeriodLabel;
    const ytdBasis = lastSync?.ytdBasis ?? status.ytdBasis;
    return (
      <div className={`ledger-connect ${isError ? "ledger-connect--error" : "ledger-connect--ok"}`}>
        <div className="ledger-connect__head">
          <div className="ledger-connect__identity">
            <div className="ledger-connect__title-row">
              <p className="ledger-connect__kicker" style={{ marginBottom: 0 }}>
                QuickBooks Online
              </p>
              {isError ? (
                <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
            <p className="ledger-connect__name">
              {status.companyName ?? `Realm ${status.realmId}`}
            </p>
            <p className="ledger-connect__meta ledger-connect__meta--flush">
              {isError
                ? `Error: ${status.syncError?.slice(0, 80) ?? "unknown"}`
                : periodLabel
                  ? `Last sync ${fmtDate(status.lastSyncedAt)} · Month to date ${periodLabel}${
                      (lastSync?.revenue ?? status.revenue) != null
                        ? ` · Revenue ${fmtExact(lastSync?.revenue ?? status.revenue)}`
                        : ""
                    }${
                      ytdPeriodLabel
                        ? ` · ${yearToDateTitle(ytdBasis)} ${ytdPeriodLabel}${
                            (lastSync?.ytdRevenue ?? status.ytdRevenue) != null
                              ? ` · Revenue ${fmtExact(lastSync?.ytdRevenue ?? status.ytdRevenue)}`
                              : ""
                          }`
                        : ""
                    }`
                  : `Linked. Last sync ${fmtDate(status.lastSyncedAt)}. Sync again — the stored total has no period dates.`}
            </p>
            <p id="qbo-aged-ar-status" className="ledger-connect__meta">
              {lastSync?.agedArLine ?? status.agedArLine}
            </p>
            <p id="qbo-aged-ap-status" className="ledger-connect__meta">
              {lastSync?.agedApLine ?? status.agedApLine}
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
              title="Disconnect QuickBooks"
              className="ledger-connect__disconnect"
            >
              <Unlink className="h-3 w-3" />
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </div>
        </div>

        {(lastSync || status.periodLabel) && (
          <div className="ledger-connect__stats ledger-connect__stats--ok">
            {[
              { label: "Month to date", value: periodLabel ?? "—" },
              { label: "Revenue", value: fmtExact(lastSync?.revenue ?? status.revenue) },
              { label: "Net income", value: fmtExact(lastSync?.netIncome ?? status.netIncome) },
              { label: yearToDateTitle(ytdBasis), value: ytdPeriodLabel ?? "—" },
              { label: "Year revenue", value: fmtExact(lastSync?.ytdRevenue ?? status.ytdRevenue) },
              {
                label: "Year net income",
                value: fmtExact(lastSync?.ytdNetIncome ?? status.ytdNetIncome),
              },
              { label: "Cash (BS)", value: fmtExact(lastSync?.cash ?? status.cash) },
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
    <div className="ledger-connect ledger-connect--panel ledger-connect--split">
      <div>
        <p className="ledger-connect__kicker" style={{ marginBottom: 4 }}>
          QuickBooks Online
        </p>
        <p className="ledger-connect__hint">
          Connect to sync P&amp;L and balance sheet into this client&apos;s figures
        </p>
      </div>
      <BrandConnectButton brand="quickbooks" busy={connecting} onClick={handleConnect} />
    </div>
  );
}
