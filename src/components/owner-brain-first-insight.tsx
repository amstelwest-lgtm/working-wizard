/**
 * Surfaces the first Client Brain proposed next steps on the owner Health board
 * without opening MilonBot or the accountant Summary tab.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingBrainRelation, type ProposedNextStep } from "@/lib/client-brain";

export function OwnerBrainFirstInsight({
  clientId,
  reloadToken = 0,
}: {
  clientId: string | null;
  reloadToken?: number;
}) {
  const [steps, setSteps] = useState<ProposedNextStep[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) {
      setSteps([]);
      setReady(false);
      return;
    }
    const { data, error } = await supabase
      .from("proposed_next_steps")
      .select("id, client_id, title, rationale, assumptions, status, created_at, updated_at")
      .eq("client_id", clientId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(3);
    if (isMissingBrainRelation(error)) {
      setSteps([]);
      setReady(true);
      return;
    }
    setSteps((data ?? []) as ProposedNextStep[]);
    setReady(true);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  if (!clientId || !ready || steps.length === 0) return null;

  return (
    <div
      id="owner-brain-first-insight"
      className="flex flex-col gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-3 text-sm"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
        From your Client Brain
      </p>
      <ul className="space-y-2.5">
        {steps.map((step) => (
          <li key={step.id} className="min-w-0">
            <p className="font-medium text-slate-800 dark:text-slate-100">{step.title}</p>
            {step.rationale ? (
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {step.rationale}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
