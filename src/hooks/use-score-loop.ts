import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { decodeFrozenProjection } from "@/lib/action-projection";
import {
  compareScoreProjection,
  driverKeyFromMoveKey,
  type FrozenScoreProjection,
  type ScoreProjectionCompare,
} from "@/lib/score-projection";
import type { HealthPillarId } from "@/lib/health-score";

export type ScoreLoopItem = {
  id: string;
  title: string;
  status: string;
  source_move_key: string | null;
  driver_key: string | null;
  outcome_why: string | null;
  projection: FrozenScoreProjection | null;
};

export function useScoreLoop(clientId: string | null | undefined) {
  const [items, setItems] = useState<ScoreLoopItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!clientId) {
      setItems([]);
      setLoaded(true);
      return;
    }
    const { data, error } = await supabase
      .from("action_items")
      .select("id,title,status,source_move_key,driver_key,outcome_why")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });
    if (error) {
      setItems([]);
      setLoaded(true);
      return;
    }
    setItems(
      (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        source_move_key: row.source_move_key,
        driver_key: row.driver_key,
        outcome_why: row.outcome_why,
        projection: decodeFrozenProjection(row.outcome_why),
      })),
    );
    setLoaded(true);
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const plannedDriverKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const it of items) {
      const key = it.driver_key || (it.source_move_key ? driverKeyFromMoveKey(it.source_move_key) : null);
      if (key) keys.add(key);
    }
    return keys;
  }, [items]);

  return { items, loaded, reload, plannedDriverKeys };
}

export function buildScoreLoopCompare(input: {
  items: ScoreLoopItem[];
  driverKey: string;
  currentRatios: Record<string, number>;
  currentOverall: number | null;
  currentPillars: Array<{ id: HealthPillarId; score: number | null }>;
  currentFinancialsUpdatedAt?: string | null;
}): { projection: FrozenScoreProjection; compare: ScoreProjectionCompare; items: ScoreLoopItem[] } | null {
  const group = input.items.filter((it) => {
    const key = it.driver_key || (it.source_move_key ? driverKeyFromMoveKey(it.source_move_key) : "");
    return key === input.driverKey;
  });
  if (!group.length) return null;
  const projection = group.find((it) => it.projection)?.projection ?? null;
  if (!projection) return null;
  const compare = compareScoreProjection({
    projection,
    currentRatios: input.currentRatios,
    currentOverall: input.currentOverall,
    currentPillars: input.currentPillars,
    currentFinancialsUpdatedAt: input.currentFinancialsUpdatedAt,
    plannedCount: group.length,
    doneCount: group.filter((it) => it.status === "done").length,
  });
  return { projection, compare, items: group };
}
