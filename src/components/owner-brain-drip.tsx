/**
 * Light owner-facing prompt shell for the slow-drip outstanding question.
 * Not an Ask AI / Claude chat rewrite.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingBrainRelation, type ClientBrainQuestion } from "@/lib/client-brain";
import {
  operatingProfileQuestionStates,
  productLineQuestionStates,
} from "@/lib/client-brain-questions";
import { useBrainDrip } from "@/hooks/use-brain-drip";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import type { ProductMix } from "@/lib/product-mix";
import { emptyProductMix } from "@/lib/product-mix";
import type { WeeklyInputs } from "@/lib/weekly-inputs";
import { emptyWeeklyInputs } from "@/lib/weekly-inputs";

export function OwnerBrainDrip({
  clientId,
  operatingProfile,
  productMix,
  weeklyInputs,
}: {
  clientId: string | null;
  operatingProfile?: ClientOperatingProfile | null;
  productMix?: ProductMix;
  weeklyInputs?: WeeklyInputs;
}) {
  const [stored, setStored] = useState<ClientBrainQuestion[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) {
      setStored([]);
      setReady(false);
      return;
    }
    const { data, error } = await supabase
      .from("client_brain_questions")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(80);
    setStored(isMissingBrainRelation(error) ? [] : ((data ?? []) as ClientBrainQuestion[]));
    setReady(true);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const derived = useMemo(
    () => [
      ...operatingProfileQuestionStates(operatingProfile ?? null),
      ...productLineQuestionStates(productMix ?? emptyProductMix(), weeklyInputs ?? emptyWeeklyInputs()),
    ],
    [operatingProfile, productMix, weeklyInputs],
  );

  const drip = useBrainDrip({
    clientId,
    derived,
    stored,
    enabled: Boolean(clientId) && ready,
    onStamped: () => {
      void load();
    },
  });

  if (!drip) return null;

  return (
    <div
      id="owner-brain-drip"
      className="flex flex-col gap-1.5 rounded-xl border border-[#d4a550]/30 bg-[#d4a550]/[0.06] px-3.5 py-2.5 text-sm"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b] dark:text-[#d4a550]">
        One question
      </p>
      <p className="text-slate-700 dark:text-slate-200">{drip.prompt}</p>
    </div>
  );
}
