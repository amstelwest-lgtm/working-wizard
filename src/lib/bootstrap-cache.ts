/**
 * One cold load shares firm, role, and IT reads.
 * The billing gate and the practice board used to each start a fresh chain,
 * and the stay check dropped its promise as soon as it settled, so the board
 * paid for the same reads again.
 */

type Entry = { at: number; pending: Promise<unknown> };

const box = new Map<string, Entry>();

/** Long enough for the gate and the board to share one cold load. */
export const BOOTSTRAP_CACHE_TTL_MS = 20_000;

export function firmsCacheKey(userId: string): string {
  return `firms:${userId}`;
}

export function once<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs = BOOTSTRAP_CACHE_TTL_MS,
): Promise<T> {
  const hit = box.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.pending as Promise<T>;
  const pending = Promise.resolve()
    .then(load)
    .catch((err: unknown) => {
      const current = box.get(key);
      if (current?.pending === pending) box.delete(key);
      throw err;
    });
  box.set(key, { at: Date.now(), pending });
  return pending;
}

export function forgetOnce(key: string): void {
  box.delete(key);
}

/** Tests and sign-out. A new user id is already a different key. */
export function clearBootstrapCache(): void {
  box.clear();
}
