import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useMilonTeamFeed } from "@/hooks/use-milon-team-feed";
import type { ApprovedDraftTarget } from "@/components/owner-draft-card";
import { MilonTeamDesk } from "./milon-team-desk";

export function MilonTeamPane({
  clientId,
  onOpenApproved,
  onInvite,
}: {
  clientId: string;
  onOpenApproved?: (target: ApprovedDraftTarget) => void;
  onInvite?: () => void;
}) {
  const feed = useMilonTeamFeed(clientId);
  const live = useAgentActivity(clientId);
  return (
    <MilonTeamDesk
      feed={feed}
      live={live}
      onOpenApproved={onOpenApproved}
      onInvite={onInvite}
      onRefreshDrafts={live.refresh}
    />
  );
}
