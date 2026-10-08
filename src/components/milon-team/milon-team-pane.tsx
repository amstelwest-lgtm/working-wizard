import type { ReactNode } from "react";
import type { MilonTeamFeedApi } from "./types";
import { MilonTeamDesk } from "./milon-team-desk";

/**
 * Production seam. Eng1's hook will live in src/hooks/use-milon-team-feed.ts.
 * Swap the body for `return useMilonTeamFeed(clientId)` when that file lands.
 * Until then the full feed cannot be built without re-implementing Eng1's
 * agent mapping, so the caller keeps the current Bot panel.
 */
export function useProductionTeamFeed(clientId: string): MilonTeamFeedApi | null {
  void clientId;
  return null;
}

export function MilonTeamPane({ clientId, fallback }: { clientId: string; fallback: ReactNode }) {
  const feed = useProductionTeamFeed(clientId);
  if (!feed) return fallback;
  return <MilonTeamDesk feed={feed} />;
}
