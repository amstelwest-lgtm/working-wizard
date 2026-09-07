import { supabase } from "@/integrations/supabase/client";

export type MilonBotAudience = "accountant" | "owner";
export type MilonBotToolStatus = "ok" | "empty" | "error";

export type MilonBotResult = {
  answer: string;
  tools: Array<{ name: string; status: MilonBotToolStatus }>;
  skippedReason?: "ai_not_configured";
};

export async function invokeMilonBot(input: {
  clientId: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  audience: MilonBotAudience;
}): Promise<MilonBotResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Supabase URL is not configured");
  const res = await fetch(`${base}/functions/v1/milon-bot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      clientId: input.clientId,
      message: input.message,
      history: input.history,
      audience: input.audience,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as MilonBotResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Milōn bot failed (${res.status})`);
  }
  return {
    answer: body.answer ?? "",
    tools: Array.isArray(body.tools) ? body.tools : [],
    skippedReason: body.skippedReason,
  };
}
