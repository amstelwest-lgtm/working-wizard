/**
 * Dedupe key for an agent finding title: lowercase, digits removed, spaces
 * collapsed. "Gross margin is 42%." and "Gross margin is 40%." share a key.
 * No imports: the agent_findings writers in supabase/functions use it too,
 * and the supersede migration mirrors it in SQL.
 */
export function findingTitleKey(title: string): string {
  return title.toLowerCase().replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
}
