import { supabase } from "@/integrations/supabase/client";

export type BrainProposeResult = {
  stepsInserted: number;
  gapDrafts: number;
  competitorDrafts: number;
  drip: { key: string; prompt: string } | null;
  skippedReason?: "ai_not_configured" | "similar_open" | "empty_context";
};

export async function invokeBrainPropose(
  clientId: string,
  outstanding?: Array<{ key: string; prompt: string; audience: string }>,
): Promise<BrainProposeResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Supabase URL is not configured");
  const res = await fetch(`${base}/functions/v1/brain-propose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ clientId, outstanding }),
  });
  const body = (await res.json().catch(() => ({}))) as BrainProposeResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Propose failed (${res.status})`);
  }
  return {
    stepsInserted: body.stepsInserted ?? 0,
    gapDrafts: body.gapDrafts ?? 0,
    competitorDrafts: body.competitorDrafts ?? 0,
    drip: body.drip ?? null,
    skippedReason: body.skippedReason,
  };
}
