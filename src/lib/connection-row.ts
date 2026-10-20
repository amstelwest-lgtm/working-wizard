import { supabase } from "@/integrations/supabase/client";
import type { ConnectionRowFact } from "@/lib/connection-status-deadline";

export type LedgerProvider = "xero" | "qbo" | "sage";

const CONNECTION_TABLE = {
  xero: "xero_connections",
  qbo: "qbo_connections",
  sage: "sage_connections",
} as const;

/**
 * Direct row lookup. This is not the status server function, which waits on
 * an auth claim before it can say whether the client is connected.
 * A query error stays unknown so a connected client is not marked absent.
 */
export async function readLedgerConnectionRow(
  clientId: string,
  provider: LedgerProvider,
): Promise<Exclude<ConnectionRowFact, "unknown">> {
  const { data, error } = await supabase
    .from(CONNECTION_TABLE[provider])
    .select("id")
    .eq("client_id", clientId)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0 ? "present" : "absent";
}
