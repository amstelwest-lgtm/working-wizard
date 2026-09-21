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
import { RefreshCw, Link2, Unlink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

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

const codeStyle = {
  fontSize: 11,
  background: "#1e293b",
  padding: "1px 5px",
  borderRadius: 4,
} as const;

function fmtExact(n: number | null) {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      toast.success("Xero sync complete — P&L and balance sheet updated");
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
        <span style={{ fontSize: 12, color: "#64748b" }}>Checking Xero…</span>
      </div>
    );
  }

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
          Xero
        </p>
        <p style={{ fontSize: 12, color: "#94a3b8" }}>
          Xero sync isn&apos;t switched on for this workspace yet. Export a P&amp;L and
          balance sheet from Xero and upload them — the board fills in the same way.
        </p>
        <p style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
          Admins: set <code style={codeStyle}>XERO_CLIENT_ID</code>,{" "}
          <code style={codeStyle}>XERO_CLIENT_SECRET</code> and{" "}
          <code style={codeStyle}>XERO_REDIRECT_URI</code> to enable live sync.
        </p>
      </div>
    );
  }

  if (status) {
    const isError = status.syncStatus === "error" || status.phase === "error";
    return (
      <div
        style={{
          border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(19,181,234,0.35)"}`,
          borderRadius: 10,
          background: isError ? "rgba(239,68,68,0.05)" : "rgba(19,181,234,0.06)",
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
                Xero
              </p>
              {isError ? (
                <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-sky-400" />
              )}
            </div>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#f1f5f9",
                marginBottom: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {status.tenantName ?? `Tenant ${status.tenantId.slice(0, 8)}`}
            </p>
            <p style={{ fontSize: 11, color: "#64748b" }}>
              {isError
                ? `Error: ${status.syncError?.slice(0, 80) ?? "unknown"}`
                : status.periodLabel
                  ? `Last sync ${fmtDate(status.lastSyncedAt)} · ${status.periodLabel}${
                      status.revenue != null ? ` · Revenue ${fmtExact(status.revenue)}` : ""
                    }`
                  : `Linked. Last sync ${fmtDate(status.lastSyncedAt)}. Sync again to load the latest month onto Profitability.`}
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
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={syncing || disconnecting}
              title="Disconnect Xero"
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

        {lastSync && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid rgba(19,181,234,0.2)",
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
            }}
          >
            {[
              { label: "Period", value: lastSync.periodLabel ?? "—" },
              { label: "Revenue", value: fmtExact(lastSync.revenue) },
              { label: "Net income", value: fmtExact(lastSync.netIncome) },
              { label: "Cash (BS)", value: fmtExact(lastSync.cash) },
              { label: "Total assets", value: fmtExact(lastSync.totalAssets) },
              { label: "Equity", value: fmtExact(lastSync.equity) },
            ].map((item) => (
              <div key={item.label}>
                <div
                  style={{
                    fontSize: 10,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {item.label}
                </div>
                {item.value && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{item.value}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

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
          Xero
        </p>
        <p style={{ fontSize: 12, color: "#64748b" }}>
          Connect to sync P&amp;L and balance sheet into this client&apos;s figures
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
          color: "#07212b",
          background: "#13B5EA",
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
          ((e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.08)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.filter = "none")
        }
      >
        {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        {connecting ? "Opening Xero…" : "Connect Xero"}
      </button>
    </div>
  );
}
