import { useMilonTeamFeed } from "@/hooks/use-milon-team-feed";
import { MilonTeamDesk } from "./milon-team-desk";

export function MilonTeamPane({ clientId }: { clientId: string }) {
  const feed = useMilonTeamFeed(clientId);
  return <MilonTeamDesk feed={feed} />;
}
