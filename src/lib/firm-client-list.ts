/**
 * Firm client list for the feature finder.
 *
 * Same scope as the practice dashboard load (`dashboard.tsx`): the signed-in
 * firm's clients, plus legacy rows that still have a null firm_id and are
 * owned by this user. The browser Supabase client applies RLS
 * (`has_client_access`); this is not a service-role read.
 */
import { supabase } from "@/integrations/supabase/client";
import type { FinderClient } from "@/lib/feature-finder-clients";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST `or` filter copied from the dashboard client query. */
export function firmClientOrFilter(firmId: string, userId: string): string {
  return `firm_id.eq.${firmId},and(firm_id.is.null,owner_user_id.eq.${userId})`;
}

export async function listFirmClients(input: {
  userId: string;
  firmId: string | null;
}): Promise<FinderClient[]> {
  const userId = input.userId.trim();
  const firmId = input.firmId?.trim() || null;
  if (!UUID_RE.test(userId)) return [];
  if (firmId && !UUID_RE.test(firmId)) return [];

  try {
    let query = supabase
      .from("clients")
      .select("id, name, client_code")
      .order("created_at", { ascending: false });
    if (firmId) {
      query = query.or(firmClientOrFilter(firmId, userId));
    } else {
      query = query.eq("owner_user_id", userId);
    }
    const { data, error } = await query;
    if (error) {
      console.error("feature finder clients:", error.message);
      return [];
    }
    const rows: FinderClient[] = [];
    for (const row of data ?? []) {
      const name = row.name?.trim();
      if (!row.id || !name) continue;
      rows.push({
        id: row.id,
        name,
        clientCode: row.client_code?.trim() || null,
      });
    }
    return rows;
  } catch (err) {
    console.error("feature finder clients:", err);
    return [];
  }
}
