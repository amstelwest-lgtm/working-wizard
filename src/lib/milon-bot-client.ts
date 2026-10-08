import { supabase } from "@/integrations/supabase/client";

export type MilonBotAudience = "accountant" | "owner";
export type MilonBotToolStatus = "ok" | "empty" | "error";

export type MilonBotTraceStep = {
  iteration: number;
  label: string;
  tool: string | null;
  status: string;
  verified: boolean | null;
  happened: boolean;
  detail: string;
};

export type MilonBotRun = {
  id: string | null;
  objective: string;
  status: string;
  outcomeLabel: string;
  summary: string;
  claimRejected: boolean;
  escalationReason: string | null;
  questions: string[];
  trace: MilonBotTraceStep[];
};

export type MilonBotResult = {
  answer: string;
  tools: Array<{ name: string; status: MilonBotToolStatus }>;
  skippedReason?: "ai_not_configured";
  run?: MilonBotRun;
};

export async function invokeMilonBot(input: {
  clientId: string;
  message?: string;
  objective?: string;
  mode?: "chat" | "agent";
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
    body: JSON.stringify(
      input.mode === "agent"
        ? {
            clientId: input.clientId,
            mode: "agent",
            objective: input.objective,
            audience: input.audience,
          }
        : {
            clientId: input.clientId,
            message: input.message,
            history: input.history,
            audience: input.audience,
          },
    ),
  });
  const body = (await res.json().catch(() => ({}))) as MilonBotResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Milōn bot failed (${res.status})`);
  }
  return {
    answer: body.answer ?? "",
    tools: Array.isArray(body.tools) ? body.tools : [],
    skippedReason: body.skippedReason,
    run: body.run,
  };
}
