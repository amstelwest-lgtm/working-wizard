import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

/**
 * A ledger status check that is still running.
 * "checking" is the spinner. "waiting" is the honest line after 8 seconds.
 * The request is not cancelled: a late reply still replaces this.
 */
export function ledgerCheckView(
  checking: boolean,
  elapsedMs: number,
  timeoutMs = SHELL_GATE_TIMEOUT_MS,
): "checking" | "waiting" | "settled" {
  if (!checking) return "settled";
  if (Number.isFinite(elapsedMs) && elapsedMs >= timeoutMs) return "waiting";
  return "checking";
}

export function useLedgerCheckSlow(checking: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!checking) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), SHELL_GATE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [checking]);
  return slow;
}

export function LedgerCheckPending({ name, slow }: { name: string; slow: boolean }) {
  if (slow) {
    return (
      <div className="ledger-connect ledger-connect--panel">
        <p className="ledger-connect__kicker">{name}</p>
        <p className="ledger-connect__hint">
          {name} hasn&apos;t answered yet. The connection will show here when the check finishes.
        </p>
      </div>
    );
  }
  return (
    <div className="ledger-connect ledger-connect--panel ledger-connect--row">
      <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
      <span className="ledger-connect__hint">Checking {name}…</span>
    </div>
  );
}
