import { sessionStillCurrent } from "@/lib/warm-boot-cards";

/**
 * A client file may mount before getSession and before the entitlement
 * server function, when this tab already holds that user's unexpired session.
 * The cash line has its own user and firm check. Live rows still wait.
 */
export function earlyClientFileOpen(input: {
  isClientFile: boolean;
  userId: string | null | undefined;
  expiresAt: number | null | undefined;
  now: number;
}): boolean {
  if (!input.isClientFile) return false;
  const userId = input.userId?.trim() ?? "";
  if (!userId) return false;
  return sessionStillCurrent(input.expiresAt, input.now);
}
