/**
 * Server copy of the per-deliverable input checklist on clients.deliverable_inputs.
 * Browser storage stays the fast path; this makes the notes follow the client
 * to another browser or colleague. A missing column is not an error.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeliverableInputId, DeliverableInputState } from "@/lib/deliverable-input-config";
import {
  parseStoredDeliverableInputs,
  type StoredDeliverableInputs,
} from "@/lib/deliverable-input-config.store";

const MISSING_COLUMN = /deliverable_inputs|42703/;

type ServerRead = { ok: true; value: StoredDeliverableInputs | null } | { ok: false };

async function readServer(clientId: string): Promise<ServerRead> {
  const { data, error } = await supabase
    .from("clients")
    .select("deliverable_inputs")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    if (!MISSING_COLUMN.test(error.message ?? "")) {
      console.warn("deliverable_inputs load:", error.message);
    }
    return { ok: false };
  }
  const raw = data?.deliverable_inputs;
  return { ok: true, value: raw ? parseStoredDeliverableInputs(raw) : null };
}

export async function loadServerDeliverableInputs(
  clientId: string,
): Promise<StoredDeliverableInputs | null> {
  if (!clientId.trim()) return null;
  const read = await readServer(clientId);
  return read.ok ? read.value : null;
}

export async function saveServerDeliverableInput(
  clientId: string,
  id: DeliverableInputId,
  state: DeliverableInputState,
): Promise<void> {
  if (!clientId.trim()) return;
  const read = await readServer(clientId);
  // A failed read would overwrite other deliverables' notes with only this one.
  if (!read.ok) return;
  const next = { ...(read.value ?? {}), [id]: state };
  const { error } = await supabase
    .from("clients")
    .update({ deliverable_inputs: next as never })
    .eq("id", clientId);
  if (error && !MISSING_COLUMN.test(error.message ?? "")) {
    console.warn("deliverable_inputs save:", error.message);
  }
}
