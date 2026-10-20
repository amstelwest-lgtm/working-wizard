import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SIGNOFF_GOLD_BTN } from "@/components/review-signoff";
import { currentQuarterLabel, defaultTargetDate } from "@/lib/action-plan-counts";

const STRIP_GOLD_BTN = `${SIGNOFF_GOLD_BTN} answer-strip__primary`;

interface Props {
  clientId: string | null | undefined;
  /** Stable key for the move — used to prevent duplicate Action Plan items. */
  moveKey: string;
  title: string;
  outcomeWhy?: string;
  /** Called when the user taps "Assign" after the item exists — should switch to the Action Plan tab focused on this move. */
  onAssign: (moveKey: string) => void;
  /** Studio gold button on the accountant Moves tab. Owner board keeps the compact chip. */
  variant?: "owner" | "studio";
  /** `strip` is the one gold primary. `quiet` is a later row. */
  tone?: "strip" | "quiet";
}

/** Find or create the action item for a next move. The same row Hand to assigns. */
export async function ensureMoveActionItem(input: {
  clientId: string;
  moveKey: string;
  title: string;
  outcomeWhy?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const { data: plans, error: pErr } = await supabase
    .from("action_plans")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (pErr) throw pErr;
  let planId = plans?.[0]?.id as string | undefined;
  if (!planId) {
    const { data: created, error: cErr } = await supabase
      .from("action_plans")
      .insert({
        client_id: input.clientId,
        period_label: currentQuarterLabel(),
        outcome_goal: "Set your outcome goal for this quarter",
        target_date: defaultTargetDate(),
      })
      .select("id")
      .single();
    if (cErr) throw cErr;
    planId = created!.id as string;
  }

  const { data: existing, error: eErr } = await supabase
    .from("action_items")
    .select("id")
    .eq("plan_id", planId)
    .eq("source_move_key", input.moveKey)
    .limit(1);
  if (eErr) throw eErr;
  const existingId = existing?.[0]?.id as string | undefined;
  if (existingId) return { id: existingId, created: false };

  const { data: maxSeq } = await supabase
    .from("action_items")
    .select("seq")
    .eq("plan_id", planId)
    .order("seq", { ascending: false })
    .limit(1);
  const seq = ((maxSeq?.[0]?.seq as number | undefined) ?? 0) + 1;
  const { data: inserted, error: iErr } = await supabase
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
  if (iErr) throw iErr;
  return { id: inserted!.id as string, created: true };
}

/**
 * "Add to Action Plan" — creates an Action Plan item from a Next Move / SOP step
 * (deduped by source_move_key), then offers "Open plan" to hand off into the
 * Action Plan tab for owner/date assignment (not the legacy employee_tasks flow).
 */
export function AddToPlanButton({
  clientId,
  moveKey,
  title,
  outcomeWhy,
  onAssign,
  variant = "owner",
  tone,
}: Props) {
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");

  const add = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clientId) { toast.error("Link a client first to build an action plan"); return; }
    setState("adding");
    try {
      const saved = await ensureMoveActionItem({ clientId, moveKey, title, outcomeWhy });
      if (saved.created) toast.success("Added to Action Plan");
      else toast.info("Already in your Action Plan");
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
        title="Open in Action Plan to assign an owner"
        className={
          variant === "studio"
            ? tone === "strip"
              ? STRIP_GOLD_BTN
              : "btn ghost mini"
            : "inline-flex items-center gap-1 rounded-md border border-slate-300 bg-transparent px-1.5 py-1 text-[10px] text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        }
      >
        <span className="font-bold uppercase tracking-wider">Open plan</span>
        <ArrowRight className="h-3 w-3" />
      </button>
    );
  }

  return (
    <button
      onClick={add}
      disabled={state === "adding"}
      title="Add to Action Plan"
      className={
        variant === "studio"
          ? tone === "strip"
            ? STRIP_GOLD_BTN
            : tone === "quiet"
              ? "btn ghost mini"
              : "btn gold mini"
          : "inline-flex items-center gap-1 rounded-md border border-slate-300 bg-transparent px-1.5 py-1 text-[10px] text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      }
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
