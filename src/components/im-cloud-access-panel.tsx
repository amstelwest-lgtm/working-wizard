/**
 * IM access ladder rungs 3–4: Google Drive / OneDrive picks + forwarding inbox.
 * Read-only cloud connect; OAuth token table pending SQL approval.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, FolderOpen } from "lucide-react";
import {
  disconnectImCloud,
  getImCloudConfig,
  getImCloudStatus,
  saveImCloudAllowedSenders,
  saveImCloudPicks,
} from "@/lib/im-cloud.functions";

type Props = {
  clientId: string;
};

export function ImCloudAccessPanel({ clientId }: Props) {
  const loadConfig = useServerFn(getImCloudConfig);
  const loadStatus = useServerFn(getImCloudStatus);
  const savePicks = useServerFn(saveImCloudPicks);
  const saveSenders = useServerFn(saveImCloudAllowedSenders);
  const disconnect = useServerFn(disconnectImCloud);

  const [loading, setLoading] = useState(true);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [googlePick, setGooglePick] = useState("");
  const [microsoftPick, setMicrosoftPick] = useState("");
  const [senders, setSenders] = useState("");
  const [configured, setConfigured] = useState({ google: false, microsoft: false, inbound: false });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, status] = await Promise.all([
        loadConfig({ data: undefined as never }),
        loadStatus({ data: { clientId } }),
      ]);
      setConfigured({
        google: cfg.google,
        microsoft: cfg.microsoft,
        inbound: Boolean(cfg.inboundDomain),
      });
      setForwarding(status.forwardingAddress);
      setRevoked(status.revoked);
      const g = status.picks.find((p) => p.provider === "google");
      const m = status.picks.find((p) => p.provider === "microsoft");
      setGooglePick(g?.folderId ?? "");
      setMicrosoftPick(m?.folderId ?? "");
      setSenders(status.allowedSenders.join(", "));
    } finally {
      setLoading(false);
    }
  }, [clientId, loadConfig, loadStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveFolderPicks = async () => {
    setSaving(true);
    try {
      const picks = [];
      if (googlePick.trim()) picks.push({ provider: "google" as const, folderId: googlePick.trim() });
      if (microsoftPick.trim()) picks.push({ provider: "microsoft" as const, folderId: microsoftPick.trim() });
      await savePicks({ data: { clientId, picks } });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const saveSenderList = async () => {
    setSaving(true);
    try {
      const allowedSenders = senders
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await saveSenders({ data: { clientId, allowedSenders } });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const revokeAll = async () => {
    setSaving(true);
    try {
      await disconnect({ data: { clientId, provider: "all" } });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="im-cloud-access" data-im-cloud="loading">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="sr-only">Loading document connections</span>
      </div>
    );
  }

  return (
    <section className="im-cloud-access" aria-label="Document folders and inbox" data-im-cloud="">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Folders and inbox</h3>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Pick read-only folders for Google Drive or OneDrive. New files land in Review — nothing posts to a ledger.
      </p>
      {revoked ? (
        <p className="text-xs text-amber-800 dark:text-amber-200" role="status">
          Ingest is paused after disconnect. Save picks again when OAuth is enabled.
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="flex items-center gap-1 font-medium">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            Google Drive folder id
          </span>
          <input
            type="text"
            className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
            value={googlePick}
            onChange={(e) => setGooglePick(e.target.value)}
            disabled={!configured.google}
            placeholder={configured.google ? "From the Google Picker" : "OAuth not configured"}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="flex items-center gap-1 font-medium">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            OneDrive folder id
          </span>
          <input
            type="text"
            className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
            value={microsoftPick}
            onChange={(e) => setMicrosoftPick(e.target.value)}
            disabled={!configured.microsoft}
            placeholder={configured.microsoft ? "From the Microsoft picker" : "OAuth not configured"}
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          disabled={saving}
          onClick={() => void saveFolderPicks()}
        >
          Save folder picks
        </button>
        <button
          type="button"
          className="text-xs text-slate-600 underline dark:text-slate-400"
          disabled={saving}
          onClick={() => void revokeAll()}
        >
          Disconnect and pause ingest
        </button>
      </div>
      <motionMail
        forwarding={forwarding}
        configured={configured.inbound}
        senders={senders}
        onSendersChange={setSenders}
        onSaveSenders={() => void saveSenderList()}
        saving={saving}
      />
    </section>
  );
}

function motionMail({
  forwarding,
  configured,
  senders,
  onSendersChange,
  onSaveSenders,
  saving,
}: {
  forwarding: string | null;
  configured: boolean;
  senders: string;
  onSendersChange: (v: string) => void;
  onSaveSenders: () => void;
  saving: boolean;
}) {
  return (
    <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
      <p className="flex items-center gap-1 text-xs font-medium text-slate-800 dark:text-slate-200">
        <Mail className="h-3.5 w-3.5" aria-hidden />
        Forwarding inbox
      </p>
      {configured && forwarding ? (
        <p className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-300">{forwarding}</p>
      ) : (
        <p className="mt-1 text-xs text-slate-500">Set MILON_SOURCE_INBOUND_DOMAIN to enable addresses.</p>
      )}
      <label className="mt-2 flex flex-col gap-1 text-xs">
        Allowed senders (comma-separated, empty = any)
        <input
          type="text"
          className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
          value={senders}
          onChange={(e) => onSendersChange(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        disabled={saving}
        onClick={onSaveSenders}
      >
        Save allowed senders
      </button>
    </div>
  );
}