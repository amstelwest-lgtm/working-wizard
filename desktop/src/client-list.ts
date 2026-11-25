/**
 * Same client set as the practice board picker, plus client memberships
 * the owner workspace already loads. RLS still applies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "./paths";

export type ListedClient = { id: string; name: string };

function rows(data: unknown): ListedClient[] {
  if (!Array.isArray(data)) return [];
  const out: ListedClient[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as { id?: unknown; name?: unknown };
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!isUuid(id) || !name) continue;
    out.push({ id, name });
  }
  return out;
}

async function firstFirmId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const owned = await supabase
    .from("firms")
    .select("id")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  const ownedId = owned.data?.[0]?.id;
  if (!owned.error && typeof ownedId === "string" && isUuid(ownedId)) return ownedId;

  const mems = await supabase.from("firm_memberships").select("firm_id").eq("user_id", userId).limit(1);
  const memberId = mems.data?.[0]?.firm_id;
  if (!mems.error && typeof memberId === "string" && isUuid(memberId)) return memberId;
  return null;
}

export async function listPickerClients(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ clients: ListedClient[]; error: string | null }> {
  if (!isUuid(userId)) return { clients: [], error: "Sign in again." };
  const firmId = await firstFirmId(supabase, userId);
  let query = supabase.from("clients").select("id, name").order("name", { ascending: true });
  if (firmId) {
    query = query.or(`firm_id.eq.${firmId},and(firm_id.is.null,owner_user_id.eq.${userId})`);
  } else {
    query = query.eq("owner_user_id", userId);
  }
  const listed = await query.or("active.is.null,active.eq.true");
  if (listed.error) return { clients: [], error: "Clients could not be loaded." };

  const clients = rows(listed.data);
  const seen = new Set(clients.map((client) => client.id));
  const mems = await supabase.from("client_memberships").select("client_id").eq("user_id", userId);
  if (!mems.error) {
    const extra = (mems.data ?? [])
      .map((row) => (typeof row.client_id === "string" ? row.client_id : ""))
      .filter((id) => isUuid(id) && !seen.has(id));
    if (extra.length > 0) {
      const more = await supabase
        .from("clients")
        .select("id, name")
        .in("id", extra)
        .or("active.is.null,active.eq.true");
      if (!more.error) clients.push(...rows(more.data));
    }
  }
  clients.sort((a, b) => a.name.localeCompare(b.name));
  return { clients, error: null };
}
