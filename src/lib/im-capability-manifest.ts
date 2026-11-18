/**
 * Capability manifest built from the agent tool registries and the ledger
 * status shape. There is no second handwritten capability list.
 */
import { ADVISOR_TOOL_LABELS } from "@/lib/agent-advisor.ts";
import { ANALYST_TOOL_LABELS } from "@/lib/agent-analyst.ts";
import { FM_TOOL_LABELS } from "@/lib/agent-financial-manager.ts";
import { AGENT_KEYS } from "@/lib/milon-team-feed.ts";
import type { SetupPartnerLedgerStatus } from "@/lib/setup-partner.ts";

export type ManifestTool = {
  name: string;
  label: string;
  agent: string;
};

export type Capability = {
  id: string;
  label: string;
  agent: string;
  kind: "tool" | "connector" | "agent";
  tokens: string[];
};

export type CapabilityManifest = {
  agents: readonly string[];
  connectors: readonly string[];
  tools: readonly ManifestTool[];
  capabilities: readonly Capability[];
};

const STOP = new Set(["with", "from", "that", "this", "week", "each", "only"]);

export function manifestTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length < 5 || STOP.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

function toolsFromLabels(agent: string, labels: Record<string, string>): ManifestTool[] {
  return Object.entries(labels).map(([name, label]) => ({ name, label, agent }));
}

/** Ledger ids are the keys of the setup-partner ledger status, minus the upload flag. */
export function ledgerConnectorIds(): string[] {
  const blank = { connected: false, sync_status: null, last_synced_at: null };
  const status: SetupPartnerLedgerStatus = {
    xero: blank,
    qbo: blank,
    sage: blank,
    hasUpload: false,
  };
  return Object.keys(status).filter((key) => key !== "hasUpload");
}

export function defaultManifestTools(): ManifestTool[] {
  return [
    ...toolsFromLabels("financial_manager", FM_TOOL_LABELS),
    ...toolsFromLabels("analyst", ANALYST_TOOL_LABELS),
    ...toolsFromLabels("advisor", ADVISOR_TOOL_LABELS),
  ];
}

export function buildCapabilityManifest(input?: {
  tools?: readonly ManifestTool[];
  connectors?: readonly string[];
}): CapabilityManifest {
  const tools = input?.tools ?? defaultManifestTools();
  const connectors = input?.connectors ?? ledgerConnectorIds();
  const agents = [...AGENT_KEYS];
  const capabilities: Capability[] = [
    ...agents.map((agent) => ({
      id: agent,
      label: agent.replace(/_/g, " "),
      agent,
      kind: "agent" as const,
      tokens: manifestTokens(agent.replace(/_/g, " ")),
    })),
    ...connectors.map((id) => ({
      id,
      label: id === "qbo" ? "QuickBooks" : id,
      agent: "financial_manager",
      kind: "connector" as const,
      tokens: manifestTokens(id === "qbo" ? "QuickBooks" : id),
    })),
    ...tools.map((tool) => ({
      id: tool.name,
      label: tool.label,
      agent: tool.agent,
      kind: "tool" as const,
      tokens: manifestTokens(`${tool.name} ${tool.label}`),
    })),
  ];
  return { agents, connectors, tools, capabilities };
}

/** Longest token that appears as a word in the step. A fixture tool changes this. */
export function matchCapability(step: string, manifest: CapabilityManifest): Capability | null {
  const words = new Set(manifestTokens(step));
  let best: Capability | null = null;
  let bestLen = 0;
  for (const capability of manifest.capabilities) {
    if (capability.kind === "agent") continue;
    for (const token of capability.tokens) {
      if (!words.has(token) || token.length < bestLen) continue;
      if (token.length === bestLen && best && best.kind === "tool") continue;
      best = capability;
      bestLen = token.length;
    }
  }
  return best;
}
