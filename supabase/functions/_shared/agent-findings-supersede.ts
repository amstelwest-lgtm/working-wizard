/**
 * After a finding is written, older open rows from the same agent on the same
 * client with the same title key point at it through superseded_by.
 * Nothing is deleted. Approved and dismissed rows are left alone.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findingTitleKey } from "../../../src/lib/finding-title-key.ts";

export function supersededFindingIds(
  keep: { id: string; title: string },
  rows: ReadonlyArray<{ id: unknown; title: unknown; status?: unknown }>,
): string[] {
  const key = findingTitleKey(keep.title);
  if (!key) return [];
  return rows
    .filter(
      (row) =>
        String(row.id) !== keep.id &&
        row.status !== "approved" &&
        row.status !== "dismissed" &&
        typeof row.title === "string" &&
        findingTitleKey(row.title) === key,
    )
    .map((row) => String(row.id));
}

export async function supersedeOlderFindings(
  db: SupabaseClient,
  input: { clientId: string; agent: string; keepId: string; title: string },
): Promise<{ superseded: string[]; error?: string }> {
  const { data, error } = await db
    .from("agent_findings")
    .select("id, title, status")
    .eq("client_id", input.clientId)
    .eq("agent", input.agent)
    .is("superseded_by", null)
    .is("dismissed_reason", null)
    .neq("id", input.keepId)
    .limit(200);
  if (error) return { superseded: [], error: error.message };
  const ids = supersededFindingIds({ id: input.keepId, title: input.title }, data ?? []);
  if (ids.length === 0) return { superseded: [] };
  const { error: updateError } = await db
    .from("agent_findings")
    .update({ superseded_by: input.keepId })
    .in("id", ids)
    .is("superseded_by", null);
  if (updateError) return { superseded: [], error: updateError.message };
  return { superseded: ids };
}
