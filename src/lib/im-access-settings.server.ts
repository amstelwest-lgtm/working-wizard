/**
 * Load IM access settings (picks, allowlist, revoke) from clients.deliverable_inputs.
 */
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  IM_ACCESS_SETTINGS_KEY,
  mergeImAccessIntoDeliverableInputs,
  parseImAccessSettings,
  type ImAccessSettings,
} from "@/lib/im-access-settings";

type LooseAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

function admin(): LooseAdmin | null {
  const client = getSupabaseAdminOrNull();
  return client ? (client as unknown as LooseAdmin) : null;
}

export async function loadImAccessSettings(clientId: string): Promise<ImAccessSettings | null> {
  const db = admin();
  if (!db) return null;
  const { data, error } = await db
    .from("clients")
    .select(`deliverable_inputs`)
    .eq("id", clientId);
  if (error || !data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { deliverable_inputs?: unknown } | undefined;
  if (!row) return null;
  const blob = row?.deliverable_inputs;
  const record =
    blob && typeof blob === "object" && !Array.isArray(blob)
      ? (blob as Record<string, unknown>)
      : {};
  return parseImAccessSettings(record[IM_ACCESS_SETTINGS_KEY]);
}

export async function saveImAccessSettings(clientId: string, patch: Partial<ImAccessSettings>): Promise<boolean> {
  const db = admin();
  if (!db) return false;
  const { data, error } = await db
    .from("clients")
    .select("deliverable_inputs")
    .eq("id", clientId);
  if (error || !data) return false;
  const row = (Array.isArray(data) ? data[0] : data) as { deliverable_inputs?: unknown } | undefined;
  if (!row) return false;
  const next = mergeImAccessIntoDeliverableInputs(row?.deliverable_inputs, patch);
  const { error: upErr } = await db.from("clients").update({ deliverable_inputs: next }).eq("id", clientId);
  return !upErr;
}

export async function listForwardingAliasesForDomain(
  domain: string,
): Promise<Array<{ clientId: string; firmId: string | null; settings: ImAccessSettings }>> {
  void domain;
  const db = admin();
  if (!db) return [];
  const { data, error } = await db.from("clients").select("id, firm_id, deliverable_inputs");
  if (error || !Array.isArray(data)) return [];
  const out: Array<{ clientId: string; firmId: string | null; settings: ImAccessSettings }> = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: string; firm_id?: string | null; deliverable_inputs?: unknown };
    if (typeof rec.id !== "string") continue;
    const blob = rec.deliverable_inputs;
    const record =
      blob && typeof blob === "object" && !Array.isArray(blob)
        ? (blob as Record<string, unknown>)
        : {};
    if (!(IM_ACCESS_SETTINGS_KEY in record)) continue;
    out.push({
      clientId: rec.id,
      firmId: typeof rec.firm_id === "string" ? rec.firm_id : null,
      settings: parseImAccessSettings(record[IM_ACCESS_SETTINGS_KEY]),
    });
  }
  return out;
}