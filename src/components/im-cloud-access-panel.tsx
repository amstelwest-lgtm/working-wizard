/**
 * Firm Documents card: one client picker, calm status, connect only when configured.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { DocumentsCardView, type DocumentClientOption } from "@/components/im-documents-card";
import { supabase } from "@/integrations/supabase/client";
import {
  imCloudConnectVisible,
  imCloudStatusPill,
  imDocumentsShowComingSoon,
  type ImCloudPill,
} from "@/lib/im-documents-status";
import {
  disconnectImCloud,
  getImCloudAuthUrl,
  getImCloudConfig,
  getImCloudStatus,
  saveImCloudAllowedSenders,
} from "@/lib/im-cloud.functions";

type Props = {
  /** Books page: this client only, no picker. */
  clientId?: string;
  /** Setup page: one card for the firm, with a client picker. */
  firmId?: string;
};

export function ImCloudAccessPanel({ clientId, firmId }: Props) {
  const loadConfig = useServerFn(getImCloudConfig);
  const loadStatus = useServerFn(getImCloudStatus);
  const startAuth = useServerFn(getImCloudAuthUrl);
  const saveSendersFn = useServerFn(saveImCloudAllowedSenders);
  const disconnect = useServerFn(disconnectImCloud);

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<DocumentClientOption[]>([]);
  const [selectedId, setSelectedId] = useState(clientId ?? "");
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [connected, setConnected] = useState({ google: false, microsoft: false });
  const [senders, setSenders] = useState("");
  const [configured, setConfigured] = useState({
    google: false,
    microsoft: false,
    oauthSqlReady: false,
    tokenKeyReady: false,
  });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!firmId) return;
    let cancel = false;
    void supabase
      .from("clients")
      .select("id, name")
      .eq("firm_id", firmId)
      .order("name", { ascending: true })
      .limit(40)
      .then(({ data }) => {
        if (cancel) return;
        const rows: DocumentClientOption[] = [];
        for (const row of data ?? []) {
          const id = typeof row.id === "string" ? row.id : "";
          if (!id) continue;
          const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Client";
          rows.push({ id, name });
        }
        setClients(rows);
      });
    return () => {
      cancel = true;
    };
  }, [firmId]);

  useEffect(() => {
    if (clientId && !firmId) {
      setSelectedId(clientId);
      return;
    }
    setSelectedId((current) => {
      if (current && clients.some((row) => row.id === current)) return current;
      return clients[0]?.id ?? "";
    });
  }, [clientId, clients, firmId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await loadConfig({ data: undefined as never });
      setConfigured({
        google: cfg.google,
        microsoft: cfg.microsoft,
        oauthSqlReady: cfg.oauthSqlReady,
        tokenKeyReady: Boolean(cfg.tokenKeyReady),
      });
      if (!selectedId) {
        setForwarding(null);
        setRevoked(false);
        setConnected({ google: false, microsoft: false });
        setSenders("");
        return;
      }
      const status = await loadStatus({ data: { clientId: selectedId } });
      setForwarding(status.forwardingAddress);
      setRevoked(status.revoked);
      setConnected({ google: status.googleConnected, microsoft: status.microsoftConnected });
      setSenders(status.allowedSenders.join(", "));
    } catch {
      setConfigured({
        google: false,
        microsoft: false,
        oauthSqlReady: false,
        tokenKeyReady: false,
      });
      setForwarding(null);
    } finally {
      setLoading(false);
    }
  }, [loadConfig, loadStatus, selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const googleConnect = imCloudConnectVisible({
    credentials: configured.google,
    oauthSqlReady: configured.oauthSqlReady,
    tokenKeyReady: configured.tokenKeyReady,
  });
  const microsoftConnect = imCloudConnectVisible({
    credentials: configured.microsoft,
    oauthSqlReady: configured.oauthSqlReady,
    tokenKeyReady: configured.tokenKeyReady,
  });
  const googlePill: ImCloudPill = imCloudStatusPill({
    connectVisible: googleConnect,
    connected: connected.google,
    paused: revoked,
  });
  const microsoftPill: ImCloudPill = imCloudStatusPill({
    connectVisible: microsoftConnect,
    connected: connected.microsoft,
    paused: revoked,
  });

  const startConnect = async (provider: "google" | "microsoft") => {
    if (!selectedId) return;
    setSaving(true);
    setNote(null);
    try {
      const result = await startAuth({
        data: { clientId: selectedId, provider, returnPath: `/clients/${selectedId}` },
      });
      if (!result.authUrl) {
        setNote("Could not start the connection.");
        return;
      }
      window.location.assign(result.authUrl);
    } catch {
      setNote("Could not start the connection.");
    } finally {
      setSaving(false);
    }
  };

  const saveSenderList = async () => {
    if (!selectedId) return;
    setSaving(true);
    setNote(null);
    try {
      const allowedSenders = senders
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      await saveSendersFn({ data: { clientId: selectedId, allowedSenders } });
      await refresh();
    } catch {
      setNote("Could not save allowed senders.");
    } finally {
      setSaving(false);
    }
  };

  const revokeAll = async () => {
    if (!selectedId) return;
    setSaving(true);
    setNote(null);
    try {
      await disconnect({ data: { clientId: selectedId, provider: "all" } });
      await refresh();
    } catch {
      setNote("Could not pause ingest.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="im-cloud-access" data-im-cloud="loading" data-im-documents="loading">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="sr-only">Loading documents</span>
      </div>
    );
  }

  return (
    <DocumentsCardView
      clients={firmId ? clients : []}
      clientId={selectedId}
      showClientPicker={Boolean(firmId)}
      comingSoon={imDocumentsShowComingSoon([googlePill, microsoftPill])}
      providers={[
        {
          provider: "google",
          label: "Google Drive",
          pill: googlePill,
          connectLabel: googleConnect && selectedId ? "Connect Google Drive" : null,
        },
        {
          provider: "microsoft",
          label: "OneDrive",
          pill: microsoftPill,
          connectLabel: microsoftConnect && selectedId ? "Connect OneDrive" : null,
        },
      ]}
      paused={revoked}
      forwarding={forwarding}
      senders={senders}
      saving={saving}
      showDisconnect={connected.google || connected.microsoft}
      note={note}
      onClientId={setSelectedId}
      onConnect={(provider) => void startConnect(provider)}
      onDisconnect={() => void revokeAll()}
      onSendersChange={setSenders}
      onSaveSenders={() => void saveSenderList()}
    />
  );
}
