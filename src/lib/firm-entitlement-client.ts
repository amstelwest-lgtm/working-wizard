/**
 * One entitlement read per minute for this tab.
 * The billing gate and the post-insight card used to each call the server function.
 */

export type CachedFirmEntitlement = { entitled: boolean };

const TTL_MS = 60_000;

let cached: { at: number; value: CachedFirmEntitlement } | null = null;
let inflight: Promise<CachedFirmEntitlement> | null = null;

export function readCachedFirmEntitlement<T extends CachedFirmEntitlement>(
  load: (input: { data: { refresh?: boolean } }) => Promise<T>,
  refresh = false,
): Promise<T> {
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.value as T);
  }
  if (!refresh && inflight) return inflight as Promise<T>;
  const pending = load({ data: refresh ? { refresh: true } : {} }).then(
    (value) => {
      cached = { at: Date.now(), value };
      inflight = null;
      return value;
    },
    (err: unknown) => {
      inflight = null;
      throw err;
    },
  );
  inflight = pending;
  return pending;
}

export function clearCachedFirmEntitlement(): void {
  cached = null;
  inflight = null;
}
