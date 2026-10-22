/**
 * One owner question, sent as that agent.
 * Numbers stay on ask-ai. Brain jobs stay on milon-bot. The existing router decides.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseAskAiBody } from "@/lib/ask-ai-response";
import { authRetryPlanFromResponse } from "@/lib/edge-auth-retry";
import { invokeMilonBot } from "@/lib/milon-bot-client";
import { routeMilonIntent } from "@/lib/milon-bot-copy";
import type { AgentKey } from "@/lib/milon-team-feed";
import type { OwnerAskHistoryTurn } from "@/lib/owner-chat-thread";

export type OwnerAskResult =
  | { ok: true; answer: string }
  | { ok: false; error: string; code?: string };

export function ownerAskPayload(input: {
  clientId: string;
  agent: AgentKey;
  question: string;
  history: OwnerAskHistoryTurn[];
  route: "ask-ai" | "milon-bot";
}): Record<string, unknown> {
  const history = input.history
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && turn.content.trim())
    .slice(-8)
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, 1500) }));
  if (input.route === "milon-bot") {
    return {
      clientId: input.clientId,
      message: input.question,
      audience: "owner",
      agent: input.agent,
      history,
    };
  }
  return {
    clientId: input.clientId,
    question: input.question,
    audience: "owner",
    agent: input.agent,
    history,
  };
}

export async function askOwnerAgent(input: {
  clientId: string;
  agent: AgentKey;
  question: string;
  history?: OwnerAskHistoryTurn[];
}): Promise<OwnerAskResult> {
  const question = input.question.trim();
  const history = input.history ?? [];
  if (!question) return { ok: false, error: "Type a question first." };
  if (routeMilonIntent(question) === "milon-bot") {
    const payload = ownerAskPayload({
      clientId: input.clientId,
      agent: input.agent,
      question,
      history,
      route: "milon-bot",
    });
    try {
      const result = await invokeMilonBot({
        clientId: input.clientId,
        message: question,
        audience: "owner",
        mode: "chat",
        history: payload.history as OwnerAskHistoryTurn[],
        agent: input.agent,
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
  let token = sess.session?.access_token;
  if (!token) return { ok: false, error: "Not signed in." };
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return { ok: false, error: "Supabase URL is not configured." };
  const payload = JSON.stringify(
    ownerAskPayload({
      clientId: input.clientId,
      agent: input.agent,
      question,
      history,
      route: "ask-ai",
    }),
  );
  const send = (bearer: string) =>
    fetch(`${base}/functions/v1/ask-ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: payload,
    });
  let res = await send(token);
  const plan = await authRetryPlanFromResponse(res);
  if (plan) {
    if (plan === "refresh") {
      const { data } = await supabase.auth.refreshSession();
      token = data.session?.access_token || token;
    }
    res = await send(token);
  }
  const body: unknown = await res.json().catch(() => null);
  const turn = parseAskAiBody(res.status, body, res.ok);
  if (turn.ok) return { ok: true, answer: turn.answer };
  return { ok: false, error: turn.error, ...(turn.code ? { code: turn.code } : {}) };
}
