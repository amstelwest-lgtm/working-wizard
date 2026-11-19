/**
 * Firms that may enable desktop folder sync (QA: Ben test firm only).
 * Server enforces before any read or write.
 */
export const DESKTOP_SYNC_FIRM_ALLOWLIST = ["e8f7a440-a541-422c-8e4f-82ba33dd0604"] as const;

export function desktopSyncFirmAllowed(firmId: string | null | undefined): boolean {
  if (!firmId) return false;
  return (DESKTOP_SYNC_FIRM_ALLOWLIST as readonly string[]).includes(firmId);
}