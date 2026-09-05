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
import { RefreshCw, Link2, Unlink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type Props = {
  clientId: string | null;
  /** Called after a successful sync with the numeric financial inputs to auto-fill the ratio form. */
  onSyncComplete?: (inputs: Record<string, number>, summary: SyncResult["summary"]) => void;
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

const codeStyle = {
  fontSize: 11,
  background: "#1e293b",
  padding: "1px 5px",
  borderRadius: 4,
} as const;

function fmtMoney(n: number) {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

export function QboConnectCard({ clientId, onSyncComplete }: Props) {
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
  }, [clientId]);

  const handleConnect = async () => {
    if (!clientId) return;
    setConnecting(true);
    try {
      const { authUrl } = await fetchAuthUrl({ data: { clientId } });
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
      onSyncComplete?.(result.mappedInputs, result.summary);
      toast.success("QuickBooks sync complete — financial inputs updated");
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

  // ── Skeleton while loading ──────────────────────────────────────────────────
  if (loadingStatus && configured === null) {
    return (
      <div
        style={{
          border: "1px solid #1e293b",
          borderRadius: 10,
          background: "rgba(15,23,42,0.6)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        <span style={{ fontSize: 12, color: "#64748b" }}>Checking QuickBooks…</span>
      </div>
    );
  }

  // ── QBO credentials not configured in env ──────────────────────────────────
  if (configured === false) {
    return (
      <div
        style={{
          border: "1px dashed #334155",
          borderRadius: 10,
          background: "rgba(15,23,42,0.4)",
          padding: "14px 16px",
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#475569",
            marginBottom: 6,
          }}
        >
          QuickBooks Online
        </p>
        <p style={{ fontSize: 12, color: "#94a3b8" }}>
          QuickBooks sync isn&apos;t switched on for this workspace yet. You are not stuck: export a
          P&amp;L and balance sheet from QuickBooks (Excel, CSV or PDF) and upload them — the board
          fills in the same way.
        </p>
        <p style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
          Admins: set <code style={codeStyle}>QBO_CLIENT_ID</code>,{" "}
          <code style={codeStyle}>QBO_CLIENT_SECRET</code> and{" "}
          <code style={codeStyle}>QBO_REDIRECT_URI</code> to enable live sync.
        </p>
      </div>
    );
  }

  // ── Connected ───────────────────────────────────────────────────────────────
  if (status) {
    const isError = status.syncStatus === "error";
    return (
      <div
        style={{
          border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
          borderRadius: 10,
          background: isError ? "rgba(239,68,68,0.05)" : "rgba(16,185,129,0.05)",
          padding: "14px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#475569",
                }}
              >
                QuickBooks Online
              </p>
              {isError ? (
                <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {status.companyName ?? `Realm ${status.realmId}`}
            </p>
            <p style={{ fontSize: 11, color: "#64748b" }}>
              {isError
                ? `Error: ${status.syncError?.slice(0, 80) ?? "unknown"}`
                : `Last sync: ${fmtDate(status.lastSyncedAt)}`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              onClick={handleSync}
              disabled={syncing || disconnecting}
              title="Sync now"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: "#94a3b8",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 7,
                padding: "6px 10px",
                cursor: syncing ? "default" : "pointer",
                opacity: syncing || disconnecting ? 0.6 : 1,
                fontFamily: "inherit",
              }}
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
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "#ef4444",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: 7,
                padding: "6px 10px",
                cursor: disconnecting ? "default" : "pointer",
                opacity: syncing || disconnecting ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            >
              <Unlink className="h-3 w-3" />
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </div>
        </div>

        {/* Sync result preview */}
        {lastSync && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid rgba(16,185,129,0.15)",
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
            }}
          >
            {[
              { label: "Revenue", value: fmtMoney(lastSync.revenue) },
              { label: "Net income", value: fmtMoney(lastSync.netIncome) },
              { label: "Op. cashflow", value: fmtMoney(lastSync.operatingCashflow) },
              { label: "Total assets", value: fmtMoney(lastSync.totalAssets) },
              { label: "Equity", value: fmtMoney(lastSync.equity) },
              { label: `${lastSync.accountsCount} accounts · ${lastSync.transactionsCount} txns`, value: "" },
            ].map((item) => (
              <div key={item.label}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {item.label}
                </div>
                {item.value && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
                    {item.value}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Not connected ───────────────────────────────────────────────────────────
  return (
    <div
      style={{
        border: "1px solid #1e293b",
        borderRadius: 10,
        background: "rgba(15,23,42,0.6)",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#475569",
            marginBottom: 4,
          }}
        >
          QuickBooks Online
        </p>
        <p style={{ fontSize: 12, color: "#64748b" }}>
          Connect to auto-sync P&L, Balance Sheet, Cash Flow & transactions
        </p>
      </div>
      <button
        onClick={handleConnect}
        disabled={connecting}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 700,
          color: "#07090f",
          background: "#2CA01C", // Intuit green
          border: "none",
          borderRadius: 8,
          padding: "8px 16px",
          cursor: connecting ? "default" : "pointer",
          opacity: connecting ? 0.7 : 1,
          fontFamily: "inherit",
          flexShrink: 0,
          transition: "filter 150ms",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.1)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.filter = "none")
        }
      >
        {connecting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
        {connecting ? "Opening QuickBooks…" : "Connect QuickBooks"}
      </button>
    </div>
  );
}
