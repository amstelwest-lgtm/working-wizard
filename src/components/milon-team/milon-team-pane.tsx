import { useMemo } from "react";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useMilonTeamFeed } from "@/hooks/use-milon-team-feed";
import type { ApprovedDraftTarget } from "@/components/owner-draft-card";
import {
  findingFigureEntries,
  findingSentence,
  isVisibleAgentFinding,
} from "@/lib/milon-team-activity";
import type { AgentKey } from "@/lib/milon-team-feed";
import { AgentStage } from "./agent-stage";
import { MilonTeamDesk } from "./milon-team-desk";

export function MilonTeamPane({
  clientId,
  agent = null,
  findingFallback = null,
  onOpenApproved,
  onInvite,
  onSelectAgent,
}: {
  clientId: string;
  /** Home Ask opens this agent's thread. The feed stays off the card stage. */
  agent?: AgentKey | null;
  /** Home sentence for this agent when no run finding is on file. */
  findingFallback?: string | null;
  onOpenApproved?: (target: ApprovedDraftTarget) => void;
  onInvite?: () => void;
  /** Landing cards and the stage switcher both land here. */
  onSelectAgent?: (agent: AgentKey) => void;
}) {
  const feed = useMilonTeamFeed(clientId);
  const live = useAgentActivity(clientId);
  const finding = useMemo(() => {
    if (!agent) return "";
    const rows = live.findings
      .filter((row) => row.agent === agent && isVisibleAgentFinding(row))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const newest = rows[0];
    if (!newest) return "";
    return findingSentence({
      title: newest.title,
      detail: newest.detail,
      figures: findingFigureEntries(newest.evidence),
      market: live.market,
    });
  }, [agent, live.findings, live.market]);
  const desk = (
    <MilonTeamDesk
      feed={feed}
      live={live}
      initialFilter={agent ?? "all"}
      presentation={agent ? "agent" : "team"}
      onOpenApproved={onOpenApproved}
      onInvite={onInvite}
      onOpenAgent={onSelectAgent}
      onRefreshDrafts={live.refresh}
    />
  );
  if (!agent) return desk;
  return (
    <AgentStage
      agent={agent}
      finding={finding || findingFallback?.trim() || null}
      onSelect={(next) => onSelectAgent?.(next)}
    >
      {desk}
    </AgentStage>
  );
}
