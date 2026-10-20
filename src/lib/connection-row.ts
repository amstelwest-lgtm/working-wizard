import type { ConnectionRowFact } from "@/lib/connection-status-deadline";
import {
  httpStatusOf,
  rowFactFromPresenceResponse,
  type LedgerPresence,
  type LedgerProvider,
} from "@/lib/ledger-presence";

export type { LedgerProvider } from "@/lib/ledger-presence";

const inflight = new Map<string, Promise<LedgerPresence>>();

/**
 * Asks the server action. A 401, 403, or any other failure stays unknown.
 * The browser must not query the ledger connection tables; RLS with no
 * policy returns zero rows and no error, which is not "absent".
 */
export async function readLedgerConnectionRow(
  clientId: string,
  provider: LedgerProvider,
  fetchPresence: (clientId: string) => Promise<LedgerPresence>,
): Promise<ConnectionRowFact> {
  let pending = inflight.get(clientId);
  if (!pending) {
    pending = Promise.resolve().then(() => fetchPresence(clientId));
    inflight.set(clientId, pending);
    void pending
      .finally(() => {
        if (inflight.get(clientId) === pending) inflight.delete(clientId);
      })
      .catch(() => undefined);
  }
  try {
    const body = await pending;
    return rowFactFromPresenceResponse({ status: 200, body }, provider);
  } catch (err) {
    return rowFactFromPresenceResponse({ status: httpStatusOf(err), body: null }, provider);
  }
}
