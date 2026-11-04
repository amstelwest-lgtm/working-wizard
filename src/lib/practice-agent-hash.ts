import type { StageAgentKey } from "@/lib/tax-specialist/agents";

const ASK_HASH: Record<string, StageAgentKey> = {
  "ask-financial-manager": "financial_manager",
  "ask-analyst": "analyst",
  "ask-advisor": "advisor",
  "ask-tax-specialist": "tax_specialist",
};

/** Practice Home hashes that open an agent stage. */
export function practiceAgentFromHash(hash: string | null | undefined): StageAgentKey | null {
  const bare = (hash ?? "").replace(/^#/, "");
  return ASK_HASH[bare] ?? null;
}

export function practiceAgentHash(agent: StageAgentKey): string {
  return `ask-${agent.replace(/_/g, "-")}`;
}
