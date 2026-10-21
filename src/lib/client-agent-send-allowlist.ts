/**
 * Firms that may mint or open a Send an agent link.
 * My practice only. The server checks this before any read or write.
 */
export const SEND_AGENT_FIRM_ALLOWLIST = [
  "fca0f102-a597-4ec6-8f45-825c57f78797",
] as const;

export function sendAgentFirmAllowed(firmId: string | null | undefined): boolean {
  if (!firmId) return false;
  return (SEND_AGENT_FIRM_ALLOWLIST as readonly string[]).includes(firmId);
}
