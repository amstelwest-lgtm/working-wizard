import { useEffect, useRef, useState } from "react";
import { useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { useAuth } from "@/hooks/use-auth";
import type { FinderClient } from "@/lib/feature-finder-clients";
import { listFirmClients } from "@/lib/firm-client-list";

/**
 * Clients for the command palette. Loads the signed-in firm's book with the
 * same user-scoped query as the dashboard, then the palette filters that
 * list in memory — no request per keystroke.
 *
 * `enabled` is false on owner accounts. A failed read returns an empty list
 * so the feature jump list still works.
 */
export function useFirmClients(
  enabled: boolean,
  refreshKey = 0,
): { clients: FinderClient[]; loading: boolean } {
  const { user } = useAuth();
  const profile = useOptionalAccountantProfile();
  const firmId = profile?.firmId ?? null;
  const waitingForFirm = Boolean(profile?.brandLoading);
  const [clients, setClients] = useState<FinderClient[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !user?.id) {
      loadedKey.current = null;
      setClients([]);
      setLoading(false);
      return;
    }
    if (waitingForFirm) {
      setLoading(true);
      return;
    }

    const scopeKey = `${user.id}:${firmId ?? ""}`;
    const scopeChanged = loadedKey.current !== scopeKey;
    if (scopeChanged) {
      setClients([]);
      setLoading(true);
    }

    let cancelled = false;
    void listFirmClients({ userId: user.id, firmId })
      .then((rows) => {
        if (cancelled) return;
        loadedKey.current = scopeKey;
        setClients(rows);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        if (scopeChanged) {
          loadedKey.current = null;
          setClients([]);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, user?.id, firmId, waitingForFirm, refreshKey]);

  if (!enabled) return { clients: [], loading: false };
  return { clients, loading };
}
