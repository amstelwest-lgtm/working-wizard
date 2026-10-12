import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useMilonTeamFeed } from "@/hooks/use-milon-team-feed";
import type { ApprovedDraftTarget } from "@/components/owner-draft-card";
import type { AgentKey } from "@/lib/milon-team-feed";
import { MilonTeamDesk } from "./milon-team-desk";

export function MilonTeamPane({
  clientId,
  agent = null,
  onOpenApproved,
  onInvite,
}: {
  clientId: string;
  /** Home Ask opens this agent's thread. The feed stays off the card stage. */
  agent?: AgentKey | null;
  onOpenApproved?: (target: ApprovedDraftTarget) => void;
  onInvite?: () => void;
}) {
  const feed = useMilonTeamFeed(clientId);
  const live = useAgentActivity(clientId);
  return (
    <MilonTeamDesk
      feed={feed}
      live={live}
      initialFilter={agent ?? "all"}
      onOpenApproved={onOpenApproved}
      onInvite={onInvite}
      onRefreshDrafts={live.refresh}
    />
  );
}
