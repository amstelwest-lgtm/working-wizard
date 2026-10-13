import { accountantClientTabSearch } from "@/lib/client-route-search";
import type { AgentKey } from "@/lib/milon-team-feed";

const ASK_HASH_TO_AGENT: Record<string, AgentKey> = {
  "ask-financial-manager": "financial_manager",
  "ask-analyst": "analyst",
  "ask-advisor": "advisor",
};

/** `#ask-financial-manager` and the same id without the hash mark. */
export function askAgentFromHash(hash: string | null | undefined): AgentKey | null {
  const bare = (hash ?? "").replace(/^#+/, "").split("?")[0].trim().toLowerCase();
  return ASK_HASH_TO_AGENT[bare] ?? null;
}

export function askHashForAgent(agent: AgentKey): string {
  return `ask-${agent.replace(/_/g, "-")}`;
}

/** Home search with this agent's thread open. Tab search drops `agent`, so set it after. */
export function searchWithAskAgent<T extends object>(prev: T, agent: AgentKey): T {
  const next = accountantClientTabSearch(prev, "home") as Record<string, unknown>;
  next.agent = agent;
  return next as T;
}
