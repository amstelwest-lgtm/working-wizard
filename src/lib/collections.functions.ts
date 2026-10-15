/**
 * Read the aged-receivables cache written by Xero / QuickBooks Sync.
 * Service role: `*_sync_data` is RLS deny-all. Access is checked first.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  agedArProofLine,
  chooseCollections,
  collectionsFromSalesInvoices,
  readCollectionsSnapshot,
  salesInvoiceFactFromExtraction,
  type CollectionsSnapshot,
} from "@/lib/collections";

export type CollectionsView = {
  snapshot: CollectionsSnapshot | null;
  line: string;
};

async function readAged(
  table: "xero_sync_data" | "qbo_sync_data" | "sage_sync_data",
  clientId: string,
) {
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data } = await admin
    .from(table)
    .select("raw_data")
    .eq("client_id", clientId)
    .eq("data_type", "aged_ar")
    .maybeSingle();
  return readCollectionsSnapshot(data?.raw_data);
}

export const getCollections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CollectionsView> => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const [xero, qbo, sage] = await Promise.all([
      readAged("xero_sync_data", data.clientId),
      readAged("qbo_sync_data", data.clientId),
      readAged("sage_sync_data", data.clientId),
    ]);
    const ledger = chooseCollections([xero, qbo, sage]);
    const named =
      ledger != null && ledger.status === "applied" && ledger.contacts.some((contact) => contact.name.trim());
    if (named) return { snapshot: ledger, line: agedArProofLine(ledger) };

    const invoices = await salesInvoicesForClient(data.clientId);
    if (invoices) return { snapshot: invoices, line: agedArProofLine(invoices) };
    return { snapshot: ledger, line: agedArProofLine(ledger) };
  });

type SalesExtractionRow = { fields: unknown; created_at: string | null };

async function salesInvoicesForClient(clientId: string): Promise<CollectionsSnapshot | null> {
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const query = (admin.from as (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          order: (column: string, options: { ascending: boolean }) => {
            limit: (count: number) => Promise<{
              data: SalesExtractionRow[] | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  })("document_extractions")
    .select("fields, created_at")
    .eq("client_id", clientId)
    .eq("doc_type", "sales_invoice")
    .order("created_at", { ascending: false })
    .limit(500);
  const { data, error } = await query;
  if (error || !data?.length) return null;
  const facts = data.flatMap((row) => {
    const fact = salesInvoiceFactFromExtraction(row.fields);
    return fact ? [fact] : [];
  });
  const syncedAt = data[0]?.created_at || new Date().toISOString();
  return collectionsFromSalesInvoices(facts, syncedAt, new Date().toISOString().slice(0, 10));
}
