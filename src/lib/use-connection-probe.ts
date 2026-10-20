import { useEffect, useRef, useState } from "react";
import {
  connectionRestingPhase,
  enqueueConnectionCheck,
  type ConnectionPhase,
  type ConnectionRowFact,
  type ConnectionStatusView,
} from "@/lib/connection-status-deadline";
import { readLedgerConnectionRow, type LedgerProvider } from "@/lib/connection-row";

export type LedgerProbe<T> = {
  configured: boolean | null;
  status: T | null;
};

/**
 * One ledger card's status read. The card starts on a skeleton. "Not connected"
 * is painted only after the cheap connection-row select finds no row. A failed
 * status probe keeps a present row as Connected (unverified).
 */
export function useConnectionProbe<T>(input: {
  clientId: string | null;
  refreshToken: number;
  id: string;
  provider: LedgerProvider;
  comingSoon?: boolean;
  probe: () => Promise<LedgerProbe<T>>;
  readRow?: (clientId: string, provider: LedgerProvider) => Promise<"present" | "absent">;
}): {
  gate: ConnectionPhase;
  configured: boolean | null;
  status: T | null;
  reload: () => Promise<void>;
  clear: () => void;
} {
  const readRow = input.readRow ?? readLedgerConnectionRow;
  const [gate, setGate] = useState<ConnectionPhase>(connectionRestingPhase({ row: "unknown" }));
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState<T | null>(null);
  const held = useRef<LedgerProbe<T> | null>(null);
  const rowFact = useRef<ConnectionRowFact>("unknown");
  const probeRef = useRef(input.probe);
  probeRef.current = input.probe;
  const readRowRef = useRef(readRow);
  readRowRef.current = readRow;
  const run = useRef(0);

  const paintRow = (fact: ConnectionRowFact) => {
    rowFact.current = fact;
    setGate((current) => {
      if (current === "live" || current === "stored") return current;
      if (fact === "absent") return input.comingSoon ? "coming_soon" : "none";
      if (fact === "present" && (current === "none" || current === "retry" || current === "coming_soon")) {
        return "unverified";
      }
      return current;
    });
  };

  const apply = (next: ConnectionStatusView<LedgerProbe<T>>) => {
    if (next.phase === "checking") return;
    if (rowFact.current === "present" && (next.phase === "none" || next.phase === "coming_soon")) {
      setGate("unverified");
      setStatus(null);
      return;
    }
    if ((next.phase === "live" || next.phase === "stored") && next.value?.status) {
      setGate(next.phase);
      setConfigured(next.value.configured);
      setStatus(next.value.status);
      held.current = next.value;
      return;
    }
    if (next.phase === "unverified") {
      setGate("unverified");
      setStatus(null);
      if (next.value) setConfigured(next.value.configured);
      return;
    }
    if (next.phase === "retry") {
      setGate(rowFact.current === "present" ? "unverified" : "retry");
      setStatus(null);
      return;
    }
    if ((next.phase === "live" || next.phase === "stored") && next.value) {
      setConfigured(next.value.configured);
      setStatus(null);
      if (rowFact.current === "present") {
        setGate("unverified");
        return;
      }
      if (input.comingSoon && next.value.configured !== true) {
        setGate("coming_soon");
        return;
      }
      if (rowFact.current === "absent") {
        setGate(input.comingSoon ? "coming_soon" : "none");
        return;
      }
      setGate("retry");
      return;
    }
    if (next.phase === "coming_soon") {
      setGate("coming_soon");
      setStatus(null);
      return;
    }
    if (rowFact.current !== "absent") {
      setGate(rowFact.current === "present" ? "unverified" : "retry");
      setStatus(null);
      return;
    }
    setStatus(null);
    setGate(input.comingSoon ? "coming_soon" : "none");
  };

  const reload = () => {
    if (!input.clientId) return Promise.resolve();
    const token = ++run.current;
    const clientId = input.clientId;
    setGate(connectionRestingPhase({ comingSoon: input.comingSoon, row: rowFact.current }));
    void readRowRef.current(clientId, input.provider).then(
      (fact) => {
        if (run.current !== token) return;
        paintRow(fact);
      },
      () => undefined,
    );
    return enqueueConnectionCheck<LedgerProbe<T>>(
      {
        id: `${input.id}:${clientId}:${token}`,
        stored: held.current,
        comingSoon: input.comingSoon,
        rowFact,
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
    const clientId = input.clientId;
    let cancelled = false;
    rowFact.current = "unknown";
    held.current = null;
    setStatus(null);
    setConfigured(null);
    setGate(connectionRestingPhase({ comingSoon: input.comingSoon, row: "unknown" }));
    void readRowRef.current(clientId, input.provider).then(
      (fact) => {
        if (cancelled || run.current !== token) return;
        paintRow(fact);
      },
      () => undefined,
    );
    void enqueueConnectionCheck<LedgerProbe<T>>(
      {
        id: `${input.id}:${clientId}:${input.refreshToken}`,
        stored: held.current,
        comingSoon: input.comingSoon,
        rowFact,
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
  }, [input.clientId, input.refreshToken, input.id, input.provider, input.comingSoon]);

  const clear = () => {
    run.current += 1;
    held.current = null;
    rowFact.current = "absent";
    setStatus(null);
    setConfigured(null);
    setGate("none");
  };

  return { gate, configured, status, reload, clear };
}
