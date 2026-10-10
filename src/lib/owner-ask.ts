/**
 * One owner question, sent as that agent.
 * Numbers stay on ask-ai. Brain jobs stay on milon-bot. The existing router decides.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseAskAiBody } from "@/lib/ask-ai-response";
import { invokeMilonBot } from "@/lib/milon-bot-client";
import { routeMilonIntent } from "@/lib/milon-bot-copy";
import type { AgentKey } from "@/lib/milon-team-feed";

export type OwnerAskResult = { ok: true; answer: string } | { ok: false; error: string };

export async function askOwnerAgent(input: {
  clientId: string;
  agent: AgentKey;
  question: string;
}): Promise<OwnerAskResult> {
  const question = input.question.trim();
  if (!question) return { ok: false, error: "Type a question first." };
  if (routeMilonIntent(question) === "milon-bot") {
    try {
      const result = await invokeMilonBot({
        clientId: input.clientId,
        message: question,
        audience: "owner",
        mode: "chat",
      });
      const answer = result.answer.trim();
      return answer ? { ok: true, answer } : { ok: false, error: "No answer came back." };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "The question did not send.",
      };
    }
  }

  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, error: "Not signed in." };
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return { ok: false, error: "Supabase URL is not configured." };
  const res = await fetch(`${base}/functions/v1/ask-ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      clientId: input.clientId,
      question,
      audience: "owner",
      agent: input.agent,
    }),
  });
  const body: unknown = await res.json().catch(() => null);
  const turn = parseAskAiBody(res.status, body, res.ok);
  return turn.ok ? { ok: true, answer: turn.answer } : turn;
}
