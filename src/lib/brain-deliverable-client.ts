import { supabase } from "@/integrations/supabase/client";

export type BrainDeliverableResult = {
  draftInserted: boolean;
  skippedReason?: "ai_not_configured" | "empty_context" | "similar_open" | "empty_draft";
};

export async function invokeBrainDeliverableDraft(clientId: string): Promise<BrainDeliverableResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Supabase URL is not configured");
  const res = await fetch(`${base}/functions/v1/brain-deliverable-draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ clientId }),
  });
  const body = (await res.json().catch(() => ({}))) as BrainDeliverableResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Draft failed (${res.status})`);
  }
  return {
    draftInserted: Boolean(body.draftInserted),
    skippedReason: body.skippedReason,
  };
}
