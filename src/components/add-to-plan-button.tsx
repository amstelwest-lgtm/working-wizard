import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

function defaultPeriodLabel() {
  const now = new Date();
  return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
}
function defaultTargetDate() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return new Date(now.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10);
}

interface Props {
  clientId: string | null | undefined;
  /** Stable key for the move — used to prevent duplicate Action Plan items. */
  moveKey: string;
  title: string;
  outcomeWhy?: string;
  /** Called when the user taps "Assign" after the item exists — should switch to the Action Plan tab focused on this move. */
  onAssign: (moveKey: string) => void;
}

/**
 * "Add to Action Plan" — creates an Action Plan item from a Next Move
 * (deduped by source_move_key), then surfaces an "Assign" affordance that
 * hands over to the Action Plan tab's existing assignment workflow.
 */
export function AddToPlanButton({ clientId, moveKey, title, outcomeWhy, onAssign }: Props) {
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");

  const add = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clientId) { toast.error("Link a client first to build an action plan"); return; }
    setState("adding");
    try {
      // Find (or create) the active plan — mirrors the Action Plan tab.
      const { data: plans, error: pErr } = await supabase
        .from("action_plans").select("id")
        .eq("client_id", clientId).eq("is_active", true)
        .order("created_at", { ascending: false }).limit(1);
      if (pErr) throw pErr;
      let planId = plans?.[0]?.id as string | undefined;
      if (!planId) {
        const { data: created, error: cErr } = await supabase
          .from("action_plans")
          .insert({
            client_id: clientId,
            period_label: defaultPeriodLabel(),
            outcome_goal: "Set your outcome goal for this quarter",
            target_date: defaultTargetDate(),
          })
          .select("id").single();
        if (cErr) throw cErr;
        planId = created!.id as string;
      }

      // Duplicate guard: one item per move key per plan.
      const { data: existing, error: eErr } = await supabase
        .from("action_items").select("id")
        .eq("plan_id", planId).eq("source_move_key", moveKey).limit(1);
      if (eErr) throw eErr;
      if (existing && existing.length > 0) {
        toast.info("Already in your Action Plan");
        setState("added");
        return;
      }

      const { data: maxSeq } = await supabase
        .from("action_items").select("seq")
        .eq("plan_id", planId).order("seq", { ascending: false }).limit(1);
      const seq = ((maxSeq?.[0]?.seq as number | undefined) ?? 0) + 1;

      const { error: iErr } = await supabase.from("action_items").insert({
        plan_id: planId,
        client_id: clientId,
        seq,
        title,
        outcome_why: outcomeWhy ?? null,
        source: "strategic_move",
        source_move_key: moveKey,
        driver_key: moveKey,
      });
      if (iErr) throw iErr;
      toast.success("Added to Action Plan");
      setState("added");
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't add to Action Plan");
      setState("idle");
    }
  };

  if (state === "added") {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAssign(moveKey); }}
        title="Assign in the Action Plan"
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-1 text-[10px] text-emerald-700 transition hover:bg-emerald-500/25 dark:text-emerald-300"
      >
        <span className="font-bold uppercase tracking-wider">Assign</span>
        <ArrowRight className="h-3 w-3" />
      </button>
    );
  }

  return (
    <button
      onClick={add}
      disabled={state === "adding"}
      title="Add to Action Plan"
      className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-1 text-[10px] text-sky-700 transition hover:bg-sky-500/25 disabled:opacity-60 dark:text-sky-200"
    >
      {state === "adding"
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <ListPlus className="h-3 w-3" />}
      <span className="font-bold uppercase tracking-wider">
        {state === "adding" ? "Adding…" : "Add to plan"}
      </span>
    </button>
  );
}
