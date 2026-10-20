import { useEffect, useRef, useState } from "react";
import {
  connectionRestingPhase,
  enqueueConnectionCheck,
  type ConnectionPhase,
  type ConnectionStatusView,
} from "@/lib/connection-status-deadline";

export type LedgerProbe<T> = {
  configured: boolean | null;
  status: T | null;
};

/**
 * One ledger card's status read. With no stored row the card paints
 * "Not connected" (or Sage coming soon) on the first render. Sibling probes
 * still start together. A slow or failed auth claim must not put "Checking…"
 * back on screen.
 */
export function useConnectionProbe<T>(input: {
  clientId: string | null;
  refreshToken: number;
  id: string;
  comingSoon?: boolean;
  probe: () => Promise<LedgerProbe<T>>;
}): {
  gate: ConnectionPhase;
  configured: boolean | null;
  status: T | null;
  reload: () => Promise<void>;
  clear: () => void;
} {
  const resting = connectionRestingPhase(input.comingSoon);
  const [gate, setGate] = useState<ConnectionPhase>(resting);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<T | null>(null);
  const held = useRef<LedgerProbe<T> | null>(null);
  const probeRef = useRef(input.probe);
  probeRef.current = input.probe;
  const run = useRef(0);

  const apply = (next: ConnectionStatusView<LedgerProbe<T>>) => {
    if (next.phase === "checking") return;
    if ((next.phase === "live" || next.phase === "stored") && next.value?.status) {
      setGate(next.phase);
      setConfigured(next.value.configured);
      setStatus(next.value.status);
      held.current = next.value;
      return;
    }
    if ((next.phase === "live" || next.phase === "stored") && next.value) {
      setConfigured(next.value.configured);
      setStatus(null);
      if (input.comingSoon && next.value.configured !== true) {
        setGate("coming_soon");
        return;
      }
      setGate("none");
      return;
    }
    setStatus(null);
    setGate(input.comingSoon ? "coming_soon" : "none");
  };

  const reload = () => {
    if (!input.clientId) return Promise.resolve();
    const token = ++run.current;
    return enqueueConnectionCheck<LedgerProbe<T>>(
      {
        id: `${input.id}:${input.clientId}:${token}`,
        stored: held.current,
        comingSoon: input.comingSoon,
        probe: () => probeRef.current(),
      },
      (next) => {
        if (run.current !== token) return;
        apply(next);
      },
    ).then(() => undefined);
  };

  useEffect(() => {
    if (!input.clientId) return;
    const token = ++run.current;
    let cancelled = false;
    void enqueueConnectionCheck<LedgerProbe<T>>(
      {
        id: `${input.id}:${input.clientId}:${input.refreshToken}`,
        stored: held.current,
        comingSoon: input.comingSoon,
        probe: () => probeRef.current(),
      },
      (next) => {
        if (cancelled || run.current !== token) return;
        apply(next);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [input.clientId, input.refreshToken, input.id, input.comingSoon]);

  const clear = () => {
    run.current += 1;
    held.current = null;
    setStatus(null);
    setGate("none");
  };

  return { gate, configured, status, reload, clear };
}
