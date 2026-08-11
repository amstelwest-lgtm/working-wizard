import { supabase } from "@/integrations/supabase/client";

/**
 * Unresolved contextual notes = open queries for portfolio triage.
 * Returns 0 when the notes table isn't migrated yet.
 */
export async function countOpenQueriesByClient(
  clientIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of clientIds) out[id] = 0;
  if (clientIds.length === 0) return out;

  try {
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          in: (col: string, vals: string[]) => {
            eq: (col: string, val: boolean) => Promise<{
              data: { client_id: string }[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    })
      .from("client_notes")
      .select("client_id")
      .in("client_id", clientIds)
      .eq("resolved", false);

    if (error) {
      const msg = error.message ?? "";
      if (!/does not exist|relation|client_notes/i.test(msg)) {
        console.warn("open queries count:", msg);
      }
      return out;
    }
    for (const row of data ?? []) {
      out[row.client_id] = (out[row.client_id] ?? 0) + 1;
    }
  } catch (e) {
    console.warn("open queries count failed", e);
  }
  return out;
}

export async function countOpenQueriesForClient(clientId: string): Promise<number> {
  const map = await countOpenQueriesByClient([clientId]);
  return map[clientId] ?? 0;
}
