import { accountantClientTabSearch } from "@/lib/client-route-search";
import type { StageAgentKey } from "@/lib/tax-specialist/agents";

const ASK_HASH_TO_AGENT: Record<string, StageAgentKey> = {
  "ask-financial-manager": "financial_manager",
  "ask-analyst": "analyst",
  "ask-advisor": "advisor",
  "ask-tax-specialist": "tax_specialist",
};

/** `#ask-financial-manager` and the same id without the hash mark. */
export function askAgentFromHash(hash: string | null | undefined): StageAgentKey | null {
  const bare = (hash ?? "").replace(/^#+/, "").split("?")[0].trim().toLowerCase();
  return ASK_HASH_TO_AGENT[bare] ?? null;
}

export function askHashForAgent(agent: StageAgentKey): string {
  return `ask-${agent.replace(/_/g, "-")}`;
}

/** Home search with this agent's thread open. Tab search drops `agent`, so set it after. */
export function searchWithAskAgent<T extends object>(prev: T, agent: StageAgentKey): T {
  const next = accountantClientTabSearch(prev, "home") as Record<string, unknown>;
  next.agent = agent;
  return next as T;
}
