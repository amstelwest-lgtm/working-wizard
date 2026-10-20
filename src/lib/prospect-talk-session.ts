/**
 * First send on /talk. The stored session token is read after the page
 * paints. A message sent in that gap stays queued and goes out once the
 * token is known. This file does not call the network.
 */

export type TalkSessionGate = {
  ready: boolean;
  token: string;
  queued: string[];
};

export function initialTalkSession(): TalkSessionGate {
  return { ready: false, token: "", queued: [] };
}

/** Keep a message that arrives before the session token is known. */
export function queueTalkMessage(gate: TalkSessionGate, text: string): TalkSessionGate {
  const trimmed = text.trim();
  if (!trimmed || gate.ready) return gate;
  return { ...gate, queued: [...gate.queued, trimmed] };
}

/**
 * Mark the session ready and return every message that was waiting.
 * A second open does not send them again.
 */
export function openTalkSession(
  gate: TalkSessionGate,
  token: string,
): { gate: TalkSessionGate; deliver: string[] } {
  if (gate.ready) return { gate: { ...gate, token }, deliver: [] };
  return {
    gate: { ready: true, token, queued: [] },
    deliver: [...gate.queued],
  };
}
