/**
 * The Tax Specialist as a fourth agent page. ZA market only, gated the same
 * way as the sample. Keep form names out of this file: it is in the US bundle.
 */
import { agentDisplayName, agentJobLine, agentShortName } from "@/lib/milon-team";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import { taxSampleEnabled } from "./enabled";

export type TaxAgentKey = "tax_specialist";
export type StageAgentKey = AgentKey | TaxAgentKey;

export const TAX_AGENT: TaxAgentKey = "tax_specialist";
export const ZA_AGENT_KEYS: readonly StageAgentKey[] = [...AGENT_KEYS, TAX_AGENT];

export const TAX_AGENT_NAME = "Milōn Tax Specialist";
export const TAX_AGENT_SHORT_NAME = "Tax Specialist";
export const TAX_AGENT_ROLE = "Prepares SARS forms and tax workings for you to check and file.";

export function isTaxAgent(agent: StageAgentKey | null | undefined): agent is TaxAgentKey {
  return agent === TAX_AGENT;
}

/** Agents with a page for this market. */
export function stageAgentKeys(country: string | null | undefined): readonly StageAgentKey[] {
  return taxSampleEnabled(country) ? ZA_AGENT_KEYS : AGENT_KEYS;
}

/** `?agent=` read against the market. The Tax Specialist is dropped outside ZA. */
export function parseStageAgent(
  value: unknown,
  country: string | null | undefined,
): StageAgentKey | null {
  if (typeof value !== "string") return null;
  return (stageAgentKeys(country) as readonly string[]).includes(value)
    ? (value as StageAgentKey)
    : null;
}

export function stageAgentDisplayName(agent: StageAgentKey): string {
  return isTaxAgent(agent) ? TAX_AGENT_NAME : agentDisplayName(agent);
}

export function stageAgentShortName(agent: StageAgentKey): string {
  return isTaxAgent(agent) ? TAX_AGENT_SHORT_NAME : agentShortName(agent);
}

export function stageAgentJobLine(agent: StageAgentKey): string {
  return isTaxAgent(agent) ? TAX_AGENT_ROLE : agentJobLine(agent);
}
