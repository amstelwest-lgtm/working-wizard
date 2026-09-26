/**
 * Read the aged-payables cache written by Xero / QuickBooks Sync.
 * Service role: `*_sync_data` is RLS deny-all. Access is checked first.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  agedApProofLine,
  choosePayables,
  readPayablesSnapshot,
  type PayablesSnapshot,
} from "@/lib/payables";

export type PayablesView = {
  snapshot: PayablesSnapshot | null;
  line: string;
};

async function readAged(table: "xero_sync_data" | "qbo_sync_data", clientId: string) {
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data } = await admin
    .from(table)
    .select("raw_data")
    .eq("client_id", clientId)
    .eq("data_type", "aged_ap")
    .maybeSingle();
  return readPayablesSnapshot(data?.raw_data);
}

export const getPayables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PayablesView> => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const [xero, qbo] = await Promise.all([
      readAged("xero_sync_data", data.clientId),
      readAged("qbo_sync_data", data.clientId),
    ]);
    const snapshot = choosePayables([xero, qbo]);
    return { snapshot, line: agedApProofLine(snapshot) };
  });
