import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getQboAuthUrl, getQboConfig } from "@/lib/qbo.functions";
import { getXeroAuthUrl, getXeroConfig } from "@/lib/xero.functions";
import {
  beginLedgerConnect,
  ledgerConnectError,
  unconfiguredLedgerMessage,
  type LedgerConnectKind,
} from "@/lib/connect-books-start";

/**
 * Home buttons start the portal's existing Xero and QuickBooks connects.
 * Sage stays on the Sage dialog; this hook does not collect Sage credentials.
 */
export function useHomeLedgerConnect(clientId: string) {
  const fetchXeroConfig = useServerFn(getXeroConfig);
  const fetchXeroAuthUrl = useServerFn(getXeroAuthUrl);
  const fetchQboConfig = useServerFn(getQboConfig);
  const fetchQboAuthUrl = useServerFn(getQboAuthUrl);
  const [busy, setBusy] = useState<LedgerConnectKind | null>(null);
  const busyRef = useRef<LedgerConnectKind | null>(null);
  const returnPath = `/clients/${clientId}`;

  async function start(kind: LedgerConnectKind) {
    if (busyRef.current) return;
    busyRef.current = kind;
    setBusy(kind);
    try {
      const result = await beginLedgerConnect({
        configured: async () => {
          if (kind === "xero") {
            const cfg = await fetchXeroConfig({ data: undefined as never });
            return cfg.configured;
          }
          const cfg = await fetchQboConfig({ data: undefined as never });
          return cfg.configured;
        },
        authUrl: async () => {
          if (kind === "xero") {
            const { authUrl } = await fetchXeroAuthUrl({ data: { clientId, returnPath } });
            return authUrl;
          }
          const { authUrl } = await fetchQboAuthUrl({ data: { clientId, returnPath } });
          return authUrl;
        },
        go: (authUrl) => {
          window.location.href = authUrl;
        },
      });
      if (result === "unconfigured") {
        toast.message(unconfiguredLedgerMessage(kind));
        busyRef.current = null;
        setBusy(null);
      }
    } catch (err) {
      toast.error(ledgerConnectError(kind, err));
      busyRef.current = null;
      setBusy(null);
    }
  }

  return {
    busy,
    startXero: () => void start("xero"),
    startQuickBooks: () => void start("qbo"),
  };
}
