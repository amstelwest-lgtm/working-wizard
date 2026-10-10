import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useMilonTeamFeed } from "@/hooks/use-milon-team-feed";
import { MilonTeamDesk } from "./milon-team-desk";

export function MilonTeamPane({ clientId }: { clientId: string }) {
  const feed = useMilonTeamFeed(clientId);
  const live = useAgentActivity(clientId);
  return <MilonTeamDesk feed={feed} live={live} />;
}
