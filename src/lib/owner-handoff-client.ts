import { supabase } from "@/integrations/supabase/client";
import type { AgentKey } from "@/lib/milon-team-feed";

export type OwnerHandoffResult =
  | { ok: true; runId: string; status: string }
  | { ok: false; error: string };

export async function requestOwnerHandoff(input: {
  clientId: string;
  actionItemId: string;
  agent: AgentKey;
}): Promise<OwnerHandoffResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, error: "Not signed in." };
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return { ok: false, error: "Supabase URL is not configured." };
  const res = await fetch(`${base}/functions/v1/owner-handoff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      clientId: input.clientId,
      actionItemId: input.actionItemId,
      agent: input.agent,
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    runId?: string;
    status?: string;
    error?: string;
    missing?: string;
  } | null;
  if (body?.missing) return { ok: false, error: body.missing };
  if (!res.ok || !body?.ok || !body.runId) {
    return { ok: false, error: body?.missing || body?.error || "The hand-off did not start." };
  }
  return { ok: true, runId: body.runId, status: body.status ?? "queued" };
}
