import type { AgentKey } from "@/lib/milon-team-feed";

const ASK_HASH: Record<string, AgentKey> = {
  "ask-financial-manager": "financial_manager",
  "ask-analyst": "analyst",
  "ask-advisor": "advisor",
};

/** Practice Home hashes that open an agent stage. */
export function practiceAgentFromHash(hash: string | null | undefined): AgentKey | null {
  const bare = (hash ?? "").replace(/^#/, "");
  return ASK_HASH[bare] ?? null;
}

export function practiceAgentHash(agent: AgentKey): string {
  return `ask-${agent.replace(/_/g, "-")}`;
}
