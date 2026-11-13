/**
 * Last Financial Manager line for one user, firm, and client, so a warm
 * reload can paint it before the client row returns. Another user, firm,
 * or client does not reuse it. Live rows still wait for auth and RLS.
 */

const PREFIX = "milon-warm-boot-card:";
const memory = new Map<string, string>();
const written = new Set<string>();

export type WarmBootCardScope = {
  userId: string;
  firmId: string;
  clientId: string;
};

export function warmBootCardKey(scope: WarmBootCardScope): string {
  return `${PREFIX}${scope.userId}:${scope.firmId}:${scope.clientId}`;
}

/** Supabase stores `expires_at` in seconds. A missing or past stamp does not paint. */
export function sessionStillCurrent(
  expiresAt: number | null | undefined,
  now: number,
): boolean {
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  const expMs = exp > 10_000_000_000 ? exp : exp * 1000;
  return expMs > now;
}

/**
 * The cash line paints only for this user, this firm, and a session that has
 * not expired. A stored card for someone else stays in the tab and is not shown.
 */
export function mayPaintWarmCard(input: {
  userId: string | null | undefined;
  firmId: string | null | undefined;
  sessionUserId: string | null | undefined;
  expiresAt: number | null | undefined;
  activeFirmId: string | null | undefined;
  now: number;
}): boolean {
  const userId = input.userId?.trim() ?? "";
  const firmId = input.firmId?.trim() ?? "";
  const sessionUserId = input.sessionUserId?.trim() ?? "";
  const activeFirmId = input.activeFirmId?.trim() ?? "";
  if (!userId || !firmId || !sessionUserId || !activeFirmId) return false;
  if (sessionUserId !== userId) return false;
  if (activeFirmId !== firmId) return false;
  return sessionStillCurrent(input.expiresAt, input.now);
}

function scopeReady(scope: WarmBootCardScope): boolean {
  return Boolean(scope.userId.trim() && scope.firmId.trim() && scope.clientId.trim());
}

export function rememberWarmBootCard(scope: WarmBootCardScope, line: string): void {
  const text = line.replace(/\s+/g, " ").trim();
  if (!scopeReady(scope) || !text) return;
  if (text === "Checking…" || text === "Checking action points." || text.startsWith("Couldn't load")) return;
  const key = warmBootCardKey(scope);
  memory.set(key, text);
  written.add(key);
  try {
    sessionStorage.setItem(key, text);
  } catch {
    // Private mode still has the in-memory line for this page.
  }
}

export function readWarmBootCard(input: {
  userId: string | null | undefined;
  firmId: string | null | undefined;
  clientId: string | null | undefined;
  sessionUserId: string | null | undefined;
  expiresAt: number | null | undefined;
  activeFirmId: string | null | undefined;
  now?: number;
}): string | null {
  const clientId = input.clientId?.trim() ?? "";
  const userId = input.userId?.trim() ?? "";
  const firmId = input.firmId?.trim() ?? "";
  if (!clientId || !userId || !firmId) return null;
  if (
    !mayPaintWarmCard({
      userId,
      firmId,
      sessionUserId: input.sessionUserId,
      expiresAt: input.expiresAt,
      activeFirmId: input.activeFirmId,
      now: input.now ?? Date.now(),
    })
  ) {
    return null;
  }
  const key = warmBootCardKey({ userId, firmId, clientId });
  try {
    const stored = sessionStorage.getItem(key);
    const text = stored?.replace(/\s+/g, " ").trim() ?? "";
    if (text) {
      memory.set(key, text);
      return text;
    }
  } catch {
    // sessionStorage can be blocked. The in-memory line still covers this page.
  }
  return memory.get(key) ?? null;
}

/** Sign-out drops every cached line in this tab, including other firms. */
export function clearAllWarmBootCards(): void {
  memory.clear();
  const keys = new Set(written);
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.add(key);
    }
  } catch {
    // The keys this tab wrote are still in `written`.
  }
  for (const key of keys) {
    written.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // The memory map is already empty.
    }
  }
}

export function clearWarmBootCardsForTests(): void {
  clearAllWarmBootCards();
}
