import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  connectSage,
  disconnectSage,
  getSageConfig,
  getSageStatus,
  triggerSageSync,
  type SageStatus,
} from "@/lib/sage.functions";
import { Unlink, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { BrandConnectButton } from "@/components/brand-connect-button";
import { SAGE_CONNECTION_UNAVAILABLE, sageSyncPopulatedFields } from "@/lib/sage";
import { SAGE_NOT_SYNCED_HINT } from "@/lib/connect-books-copy";
import { useConnectionProbe } from "@/lib/use-connection-probe";

type Props = {
  clientId: string | null;
  /** Bump to reload status after a connect from another card. */
  refreshToken?: number;
  /**
   * Eng1: call this only when Sync returns real statement fields.
   * The stub never calls it, so Health and ratios stay unchanged.
   */
  onSyncComplete?: (inputs: Record<string, string>) => void;
  /** Other cards on the page reload after connect or disconnect. */
  onConnectionChange?: () => void;
  /** Show the branded Connect to Sage button first, like Xero and QuickBooks. The form opens on click. */
  buttonFirst?: boolean;
};

export function SageConnectCard({
  clientId,
  refreshToken = 0,
  onSyncComplete,
  onConnectionChange,
  buttonFirst = false,
}: Props) {
  const fetchStatus = useServerFn(getSageStatus);
  const checkConfig = useServerFn(getSageConfig);
  const doConnect = useServerFn(connectSage);
  const doDisconnect = useServerFn(disconnectSage);
  const doSync = useServerFn(triggerSageSync);

  const { gate, configured, status, reload, clear } = useConnectionProbe<SageStatus>({
    clientId,
    refreshToken,
    id: "sage",
    comingSoon: true,
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
  const [emptySyncMessage, setEmptySyncMessage] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [showForm, setShowForm] = useState(!buttonFirst);

  const handleConnect = async (event: FormEvent) => {
    event.preventDefault();
    if (!clientId) return;
    setConnecting(true);
    try {
      await doConnect({
        data: {
          clientId,
          username: username.trim(),
          password,
          companyId: companyId.trim(),
        },
      });
      setPassword("");
      setEmptySyncMessage(null);
      toast.success("Sage connected. Sync will not change figures until a statement is available.");
      onConnectionChange?.();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect Sage");
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    if (!clientId) return;
    setSyncing(true);
    try {
      const result = await doSync({ data: { clientId } });
      const fields = sageSyncPopulatedFields(result);
      if (fields) {
        setEmptySyncMessage(null);
        onSyncComplete?.(fields);
        toast.success("Sage sync complete — figures updated");
      } else {
        const message =
          "message" in result && typeof result.message === "string" && result.message.trim()
            ? result.message
            : "Sage is connected, but no statement has been synced. Overview figures were left unchanged.";
        setEmptySyncMessage(message);
        toast.message(message);
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
      await reload();
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!clientId || !confirm("Disconnect Sage? Figures already on the board stay.")) return;
    setDisconnecting(true);
    try {
      await doDisconnect({ data: { clientId } });
      clear();
      setEmptySyncMessage(null);
      onConnectionChange?.();
      toast.success("Sage disconnected");
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
        <span className="ledger-connect__hint">Checking Sage…</span>
      </div>
    );
  }

  if (gate === "coming_soon" || configured === false) {
    return (
      <div className="ledger-connect ledger-connect--dashed" data-sage-connect="soon" data-connection-state="coming_soon">
        <p className="ledger-connect__kicker">Sage Accounting</p>
        <p className="ledger-connect__body">{SAGE_CONNECTION_UNAVAILABLE}</p>
      </div>
    );
  }

  if (status) {
    const isError = status.syncStatus === "error";
    return (
      <div className={`ledger-connect ${isError ? "ledger-connect--error" : "ledger-connect--sage"}`}>
        <div className="ledger-connect__head">
          <div className="ledger-connect__identity">
            <div className="ledger-connect__title-row">
              <p className="ledger-connect__kicker" style={{ marginBottom: 0 }}>
                Sage Accounting
              </p>
              {isError ? (
                <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
            <p className="ledger-connect__name">
              {status.companyName ?? `Company ${status.companyId}`}
            </p>
            <p className="ledger-connect__meta ledger-connect__meta--flush">
              {isError
                ? `Error: ${status.syncError?.slice(0, 80) ?? "unknown"}`
                : status.syncError?.trim() || "Connected. No Sage statement yet."}
            </p>
            <p id="sage-empty-sync" className="ledger-connect__meta">
              {emptySyncMessage ??
                "Sync does not fill Health or ratios until a Sage statement is available."}
            </p>
          </div>
          <div className="ledger-connect__actions">
            <button
              type="button"
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
              type="button"
              onClick={handleDisconnect}
              disabled={syncing || disconnecting}
              title="Disconnect Sage"
              className="ledger-connect__disconnect"
            >
              <Unlink className="h-3 w-3" />
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!showForm) {
    return (
      <div className="ledger-connect ledger-connect--panel" data-sage-connect="start">
        <p className="ledger-connect__kicker">Sage Accounting</p>
        <p className="ledger-connect__hint">{SAGE_NOT_SYNCED_HINT}</p>
        <div style={{ marginTop: 12 }}>
          <BrandConnectButton brand="sage" onClick={() => setShowForm(true)} />
        </div>
      </div>
    );
  }

  return (
    <form
      className="ledger-connect ledger-connect--panel"
      onSubmit={handleConnect}
      data-sage-connect="form"
    >
      <p className="ledger-connect__kicker">Sage Accounting</p>
      <p className="ledger-connect__hint">
        South African Sage Business Cloud Accounting. Email, password, and Company ID. Milōn
        checks the login with Sage and does not pull figures yet.
      </p>
      <div className="ledger-connect__fields">
        <label className="ledger-connect__label">
          Email
          <input
            className="ledger-connect__input"
            type="email"
            name="sage-email"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="ledger-connect__label">
          Password
          <input
            className="ledger-connect__input"
            type="password"
            name="sage-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="ledger-connect__label">
          Company ID
          <input
            className="ledger-connect__input"
            type="text"
            name="sage-company-id"
            inputMode="numeric"
            autoComplete="off"
            required
            pattern="[0-9]{1,18}"
            title="The numeric Company ID from Sage"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
          />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <BrandConnectButton brand="sage" type="submit" busy={connecting} busyLabel="Checking Sage…" />
      </div>
    </form>
  );
}
