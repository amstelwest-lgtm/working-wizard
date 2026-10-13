/**
 * Put a Next move on the active action plan, once per move key.
 * The caller assigns the row. This does not choose an owner.
 */
import { supabase } from "@/integrations/supabase/client";

function defaultPeriodLabel() {
  const now = new Date();
  return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
}

function defaultTargetDate() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return new Date(now.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10);
}

export async function ensureStrategicMoveItem(input: {
  clientId: string;
  moveKey: string;
  title: string;
  outcomeWhy?: string;
}): Promise<{ ok: true; actionItemId: string } | { ok: false; error: string }> {
  const { data: plans, error: planError } = await supabase
    .from("action_plans")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (planError) return { ok: false, error: planError.message };
  let planId = plans?.[0]?.id as string | undefined;
  if (!planId) {
    const { data: created, error: createError } = await supabase
      .from("action_plans")
      .insert({
        client_id: input.clientId,
        period_label: defaultPeriodLabel(),
        outcome_goal: "Set your outcome goal for this quarter",
        target_date: defaultTargetDate(),
      })
      .select("id")
      .single();
    if (createError || !created?.id) {
      return { ok: false, error: createError?.message ?? "Couldn't open the action plan." };
    }
    planId = created.id as string;
  }

  const { data: existing, error: existingError } = await supabase
    .from("action_items")
    .select("id")
    .eq("plan_id", planId)
    .eq("source_move_key", input.moveKey)
    .limit(1);
  if (existingError) return { ok: false, error: existingError.message };
  const already = existing?.[0]?.id;
  if (typeof already === "string" && already) return { ok: true, actionItemId: already };

  const { data: maxSeq } = await supabase
    .from("action_items")
    .select("seq")
    .eq("plan_id", planId)
    .order("seq", { ascending: false })
    .limit(1);
  const seq = ((maxSeq?.[0]?.seq as number | undefined) ?? 0) + 1;
  const { data: inserted, error: insertError } = await supabase
    .from("action_items")
    .insert({
      plan_id: planId,
      client_id: input.clientId,
      seq,
      title: input.title,
      outcome_why: input.outcomeWhy ?? null,
      source: "strategic_move",
      source_move_key: input.moveKey,
      driver_key: input.moveKey,
    })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    return { ok: false, error: insertError?.message ?? "Couldn't add the move to the plan." };
  }
  return { ok: true, actionItemId: inserted.id as string };
}
