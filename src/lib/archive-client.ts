/**
 * Soft-archive a practice client. Sets clients.active = false.
 * Never deletes the row, memberships, or books.
 */
import { supabase } from "@/integrations/supabase/client";

/** PostgREST: active IS DISTINCT FROM false. Null stays on the active list. */
export const ACTIVE_CLIENTS_OR = "active.is.null,active.eq.true";

export function removeClientConfirm(name: string): string {
  const label = name.trim() || "this client";
  return `Removes ${label} from your practice. Data kept; you can restore from Archived.`;
}

export function isActiveClient(row: { active?: boolean | null }): boolean {
  return row.active !== false;
}

export function visibleActiveClients<T extends { active?: boolean | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter(isActiveClient);
}

export function onlyActiveClients<Q extends { or: (filters: string) => unknown }>(query: Q): Q {
  query.or(ACTIVE_CLIENTS_OR);
  return query;
}

export type ClientsArchiveDb = {
  from: (table: "clients") => {
    update: (patch: { active: false }) => {
      eq: (
        column: "id",
        value: string,
      ) => {
        select: (columns: "id") => Promise<{
          data: Array<{ id: string }> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export async function archiveClient(
  clientId: string,
  db: ClientsArchiveDb = supabase as unknown as ClientsArchiveDb,
): Promise<void> {
  const id = clientId.trim();
  if (!id) throw new Error("Missing client");
  const { data, error } = await db
    .from("clients")
    .update({ active: false })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Could not remove this client");
}
