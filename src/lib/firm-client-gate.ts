/**
 * How many firm clients the signed-in owner can see, for the billing path gate.
 * The browser query is RLS-scoped. A failed read must not wall the first file.
 */

import { supabase } from "@/integrations/supabase/client";

export type FirmClientGateContext = {
  /** Null when the count could not be loaded. 2 means two or more. */
  firmClientCount: number | null;
  firstClientId: string | null;
};

export async function loadFirmClientGateContext(): Promise<FirmClientGateContext> {
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("id")
      .not("firm_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(2);
    if (error) return { firmClientCount: null, firstClientId: null };
    const rows = data ?? [];
    const first = rows[0]?.id;
    return {
      firmClientCount: rows.length >= 2 ? 2 : rows.length,
      firstClientId: typeof first === "string" && first ? first : null,
    };
  } catch {
    return { firmClientCount: null, firstClientId: null };
  }
}
