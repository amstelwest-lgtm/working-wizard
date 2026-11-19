import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionCard } from "@/components/primitives";
import { SettingsShell } from "@/components/settings-shell";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { supabase } from "@/integrations/supabase/client";
import { onlyActiveClients } from "@/lib/archive-client";
import { desktopSyncClientReady } from "@/lib/desktop-sync-ready";
import {
  disableDesktopSync,
  enableDesktopSync,
  loadDesktopSyncStatus,
  mintDesktopPairingCode,
  revokeDesktopDevice,
  type DesktopSyncStatus,
} from "@/lib/desktop-sync.functions";

export const Route = createFileRoute("/_authenticated/settings/desktop-sync")({
  component: DesktopSyncSettingsPage,
  head: () => ({
    meta: [{ title: "Desktop folder sync — Milōn" }],
  }),
});

function DesktopSyncSettingsPage() {
  const { firmId, profile } = useAccountantProfile();
  const loadStatus = useServerFn(loadDesktopSyncStatus);
  const enableFn = useServerFn(enableDesktopSync);
  const disableFn = useServerFn(disableDesktopSync);
  const pairFn = useServerFn(mintDesktopPairingCode);
  const revokeFn = useServerFn(revokeDesktopDevice);

  const [status, setStatus] = useState<DesktopSyncStatus | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [maps, setMaps] = useState<Array<{ folderLabel: string; clientId: string }>>([
    { folderLabel: "", clientId: "" },
  ]);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!firmId) return;
      setLoading(true);
      const [nextStatus, clientRows] = await Promise.all([
        loadStatus({ data: { firmId } }),
        supabase.from("clients").select("id, name, archived_at").eq("firm_id", firmId),
      ]);
      if (cancelled) return;
      setStatus(nextStatus);
      setMaps(
        nextStatus.folderMaps.length > 0
          ? nextStatus.folderMaps
          : [{ folderLabel: "", clientId: "" }],
      );
      const active = onlyActiveClients(clientRows.data ?? []).map((row) => ({
        id: row.id,
        name: row.name?.trim() || "Client",
      }));
      setClients(active);
      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [firmId, loadStatus]);

  const practiceName = profile.practiceName || profile.firmName || "Your practice";

  const sortedActivity = useMemo(() => status?.activity ?? [], [status]);

  async function onEnable() {
    if (!firmId) return;
    const payload = maps
      .map((row) => ({
        folderLabel: row.folderLabel.trim(),
        clientId: row.clientId.trim(),
      }))
      .filter((row) => row.folderLabel && row.clientId);
    const result = await enableFn({ data: { firmId, folderMaps: payload } });
    if (!result.ok) {
      toast.error("Turn on folder sync after you name at least one folder per client.");
      return;
    }
    toast.success("Desktop folder sync is on for this practice.");
    setStatus(await loadStatus({ data: { firmId } }));
  }

  async function onDisable() {
    if (!firmId) return;
    await disableFn({ data: { firmId } });
    toast.success("Desktop folder sync is off. Paired computers can no longer upload.");
    setPairingCode(null);
    setStatus(await loadStatus({ data: { firmId } }));
  }

  async function onPair() {
    if (!firmId) return;
    const label = deviceLabel.trim() || "Practice PC";
    const result = await pairFn({ data: { firmId, deviceLabel: label } });
    if (!result.ok) {
      toast.error("Could not create a pairing code.");
      return;
    }
    setPairingCode(result.code);
    toast.message(`Pairing code ${result.code} — paste it into the desktop agent within 10 minutes.`);
  }

  async function onRevoke(deviceId: string) {
    if (!firmId) return;
    await revokeFn({ data: { firmId, deviceId } });
    toast.success("This computer is disconnected.");
    setStatus(await loadStatus({ data: { firmId } }));
  }

  return (
    <SettingsShell>
      <div className="settings-page" data-settings-page="desktop-sync">
        <BackLink to="/settings" label="Settings" />
        <PageHeader
          title="Desktop folder sync"
          subtitle="Optional. Watches folders you name on one computer and uploads into client source documents for review."
        />

        {!desktopSyncClientReady() || status?.sqlPending ? (
          <SectionCard title="Coming soon">
            <p className="text-sm text-[var(--ink-muted)]">
              Desktop folder sync will appear here after the database migration is applied and
              enabled for this environment. Nothing is watching your computer yet.
            </p>
          </SectionCard>
        ) : loading ? (
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        ) : !status?.available ? (
          <SectionCard title="Not available">
            <p className="text-sm text-[var(--ink-muted)]">
              Desktop folder sync is not enabled for {practiceName} yet.
            </p>
          </SectionCard>
        ) : (
          <>
            <SectionCard title="POPIA notice">
              <p className="text-sm leading-relaxed text-[var(--ink-muted)]">{status.notice}</p>
              {!status.enabled ? (
                <p className="mt-3 text-sm text-[var(--ink-faint)]">
                  Off by default. Only a firm owner can turn this on after accepting the notice.
                </p>
              ) : null}
            </SectionCard>

            <SectionCard title="Folder map">
              <p className="mb-4 text-sm text-[var(--ink-muted)]">
                One client per folder. The agent sends a folder label only — not the full path on disk.
              </p>
              <div className="space-y-3">
                {maps.map((row, index) => (
                  <div
                    key={`map-${index}`}
                    className="grid gap-3 md:grid-cols-2"
                    data-desktop-sync-map=""
                  >
                    <div>
                      <Label className="settings-label">Folder label</Label>
                      <Input
                        value={row.folderLabel}
                        disabled={status.enabled}
                        onChange={(e) => {
                          const next = [...maps];
                          next[index] = { ...row, folderLabel: e.target.value };
                          setMaps(next);
                        }}
                        placeholder="VAT 2026 submissions"
                      />
                    </div>
                    <div>
                      <Label className="settings-label">Client</Label>
                      <select
                        className="settings-select h-10 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm"
                        disabled={status.enabled}
                        value={row.clientId}
                        onChange={(e) => {
                          const next = [...maps];
                          next[index] = { ...row, clientId: e.target.value };
                          setMaps(next);
                        }}
                      >
                        <option value="">Choose client</option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
              {!status.enabled ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMaps([...maps, { folderLabel: "", clientId: "" }])}
                  >
                    Add folder
                  </Button>
                  <Button type="button" onClick={() => void onEnable()}>
                    Turn on folder sync
                  </Button>
                </div>
              ) : (
                <div className="mt-4">
                  <Button type="button" variant="destructive" onClick={() => void onDisable()}>
                    Turn off for entire practice
                  </Button>
                </div>
              )}
            </SectionCard>

            {status.enabled ? (
              <SectionCard title="Pair a computer">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label className="settings-label">Computer name</Label>
                    <Input
                      value={deviceLabel}
                      onChange={(e) => setDeviceLabel(e.target.value)}
                      placeholder="Front desk PC"
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void onPair()}>
                    Get pairing code
                  </Button>
                  {pairingCode ? (
                    <p className="text-sm font-mono" data-desktop-sync-pairing-code="">
                      {pairingCode}
                    </p>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-[var(--ink-faint)]">
                  Install the desktop agent from the repo <code>desktop-sync/</code> package. Pairing
                  uses this code — no password in the agent.
                </p>
              </SectionCard>
            ) : null}

            {status.enabled && status.devices.length > 0 ? (
              <SectionCard title="Paired computers">
                <ul className="space-y-2">
                  {status.devices.map((device) => (
                    <li
                      key={device.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{device.deviceLabel}</p>
                        <p className="text-xs text-[var(--ink-faint)]">
                          Paired {new Date(device.pairedAt).toLocaleString()}
                          {device.revokedAt ? " · Disconnected" : ""}
                        </p>
                      </div>
                      {!device.revokedAt ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void onRevoke(device.id)}
                        >
                          Disconnect this computer
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : null}

            {sortedActivity.length > 0 ? (
              <SectionCard title="Activity">
                <ul className="space-y-2 text-sm">
                  {sortedActivity.map((row, index) => (
                    <li key={`act-${index}`} className="border-b border-[var(--line)] pb-2">
                      <span className="font-medium">{row.kind}</span>
                      <span className="text-[var(--ink-faint)]">
                        {" "}
                        · {new Date(row.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : null}

            <p className="text-xs text-[var(--ink-faint)]">
              Policy reference: approved POPIA notice in docs (PR F).{" "}
              <Link to="/settings" className="underline">
                Back to settings
              </Link>
            </p>
          </>
        )}
      </div>
    </SettingsShell>
  );
}