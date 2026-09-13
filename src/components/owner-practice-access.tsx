import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/primitives";
import {
  listOwnerPracticeAccess,
  ownerDisconnectFirm,
  ownerRevokePracticeAccess,
  type OwnerFirmConnection,
  type OwnerPracticePerson,
} from "@/lib/practice-access.functions";
import { CLASSIFICATION_LABELS } from "@/lib/practice-access";

function formatGranted(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function OwnerPracticeAccessCard() {
  const load = useServerFn(listOwnerPracticeAccess);
  const revoke = useServerFn(ownerRevokePracticeAccess);
  const disconnect = useServerFn(ownerDisconnectFirm);
  const [people, setPeople] = useState<OwnerPracticePerson[]>([]);
  const [connections, setConnections] = useState<OwnerFirmConnection[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const next = await load();
      setPeople(next.people);
      setConnections(next.connections);
      setHint(next.migrationHint);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load practice access");
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const firms = useMemo(() => {
    if (connections.length) return connections;
    const map = new Map<string, OwnerFirmConnection>();
    for (const p of people) {
      const key = `${p.clientId}:${p.firmId}`;
      if (!map.has(key)) {
        map.set(key, {
          firmId: p.firmId,
          firmName: p.firmName,
          clientId: p.clientId,
          clientName: p.clientName,
        });
      }
    }
    return [...map.values()];
  }, [people, connections]);

  if (busy && people.length === 0 && connections.length === 0 && !hint) {
    return (
      <SectionCard
        className="mb-6 !rounded-2xl !border-slate-800 !bg-slate-900/60"
        eyebrow="Practice access"
        description="Loading the people at your firm who can see this business…"
      />
    );
  }

  if (!busy && people.length === 0 && firms.length === 0 && connections.length === 0 && !hint) {
    return null;
  }

  return (
    <SectionCard
      className="mb-6 !rounded-2xl !border-slate-800 !bg-slate-900/60"
      eyebrow={
        <span className="inline-flex items-center gap-2">
          <Building2 className="h-4 w-4 text-[var(--brand-gold-ui,#d4a550)]" />
          Practice access
        </span>
      }
      description="You approved this practice once. Anyone they assign is listed here. Revoke a person, or disconnect the firm, at any time."
    >
      {hint ? <p className="mb-3 text-xs text-amber-200">{hint}</p> : null}
      <ul className="space-y-2">
        {people.map((p) => (
          <li
            key={p.accessId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 px-3 py-2.5"
          >
            <div>
              <div className="text-sm font-medium text-slate-100">{p.name}</div>
              <div className="text-xs text-slate-500">
                {p.email} · {CLASSIFICATION_LABELS[p.classification]} · {p.firmName}
                {p.clientName ? ` · ${p.clientName}` : ""} · since {formatGranted(p.grantedAt)}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-rose-300 hover:text-rose-200"
              onClick={() =>
                void revoke({ data: { accessId: p.accessId } })
                  .then(() => {
                    toast.success(`${p.name} no longer has access`);
                    return refresh();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Revoke failed"))
              }
            >
              <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      {firms.map((f) => (
        <Button
          key={`${f.clientId}-${f.firmId}`}
          type="button"
          variant="outline"
          className="mt-3 w-full justify-start border-rose-900/50 text-rose-200 hover:bg-rose-950/30"
          onClick={() => {
            if (!window.confirm(`Disconnect ${f.firmName} from ${f.clientName}? Everyone at the firm loses access immediately.`)) {
              return;
            }
            void disconnect({ data: { clientId: f.clientId } })
              .then(() => {
                toast.success(`${f.firmName} disconnected`);
                return refresh();
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : "Disconnect failed"));
          }}
        >
          Disconnect {f.firmName}
          {firms.length > 1 ? ` · ${f.clientName}` : ""}
        </Button>
      ))}
    </SectionCard>
  );
}
