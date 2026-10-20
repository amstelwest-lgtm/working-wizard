/**
 * Browser call to the prospect-talk edge function.
 * The publishable key identifies the project. The function does not trust it
 * as a user session. Writes happen inside the function with the service role.
 */
export type ProspectTalkResponse = {
  ok: boolean;
  error?: string;
  silent?: boolean;
  sessionToken?: string;
  reply?: string;
  askLead?: boolean;
  visitorTurns?: number;
  country?: "US" | "ZA";
  already?: boolean;
  sampleNonce?: string;
};

export async function postProspectTalk(
  body: Record<string, unknown>,
): Promise<ProspectTalkResponse> {
  const base = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!base) return { ok: false, error: "The conversation isn't available right now." };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) {
    headers.apikey = key;
    headers.authorization = `Bearer ${key}`;
  }
  const res = await fetch(`${base}/functions/v1/prospect-talk`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ProspectTalkResponse;
  if (!res.ok && json.ok !== false) {
    return { ok: false, error: "The conversation isn't available right now." };
  }
  return json;
}
