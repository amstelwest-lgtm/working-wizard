/**
 * Invite preview errors shown on /join/:token.
 * Short tokens fail Zod before the resolver, and that JSON must never reach the page.
 */

export const INVITE_LINK_INVALID = "Invite link is invalid.";

export function isRawValidationError(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (text.startsWith("[") || text.startsWith("{")) return true;
  if (/"code"\s*:\s*"(?:too_small|too_big|invalid_type|invalid_format)"/.test(text)) return true;
  if (/\bZodError\b/.test(text)) return true;
  return false;
}

/** Map a thrown preview/accept error onto copy that is safe to render. */
export function sanitizeInviteError(message: string, fallback = INVITE_LINK_INVALID): string {
  const text = message.trim();
  if (!text || isRawValidationError(text)) return fallback;
  return text;
}

export function inviteTokenShapeOk(token: string): boolean {
  const trimmed = token.trim();
  return trimmed.length >= 8 && trimmed.length <= 80;
}
