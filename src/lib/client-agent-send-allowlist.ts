/**
 * Firms that may mint or open a Send an agent link.
 * Locked defaults always stay allowed. SEND_AGENT_FIRM_ALLOWLIST may add
 * firm ids. It cannot remove a locked default. No firm row is read.
 */
export const SEND_AGENT_FIRM_ALLOWLIST = [
  "fca0f102-a597-4ec6-8f45-825c57f78797",
  "e8f7a440-a541-422c-8e4f-82ba33dd0604",
] as const;

const ENV_KEY = "SEND_AGENT_FIRM_ALLOWLIST";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function envFirmIds(): string[] {
  const raw =
    typeof process !== "undefined" && process.env && typeof process.env[ENV_KEY] === "string"
      ? process.env[ENV_KEY]
      : "";
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const id = part.trim();
    if (!UUID.test(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

/** Locked defaults first, then any extra ids from the environment. */
export function sendAgentFirmAllowlist(): string[] {
  const locked = [...SEND_AGENT_FIRM_ALLOWLIST];
  const have = new Set(locked.map((id) => id.toLowerCase()));
  const extra = envFirmIds().filter((id) => !have.has(id.toLowerCase()));
  return [...locked, ...extra];
}

export function sendAgentFirmAllowed(firmId: string | null | undefined): boolean {
  if (!firmId) return false;
  const wanted = firmId.trim().toLowerCase();
  return sendAgentFirmAllowlist().some((id) => id.toLowerCase() === wanted);
}
