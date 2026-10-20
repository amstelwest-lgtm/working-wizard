/**
 * One entitlement read per user for this tab.
 * A paid result lasts a minute. An unpaid result lasts a few seconds, so a
 * card that just went through is not bounced for the rest of the minute.
 * The billing gate and the post-insight card share the in-flight read.
 */

export type CachedFirmEntitlement = { entitled: boolean };

export const FIRM_ENTITLEMENT_TTL_MS = 60_000;
export const FIRM_ENTITLEMENT_NEGATIVE_TTL_MS = 5_000;

type Slot = { at: number; userId: string; value: CachedFirmEntitlement };

let cached: Slot | null = null;
let inflightUser: string | null = null;
let inflight: Promise<CachedFirmEntitlement> | null = null;

function ttlFor(value: CachedFirmEntitlement): number {
  return value.entitled ? FIRM_ENTITLEMENT_TTL_MS : FIRM_ENTITLEMENT_NEGATIVE_TTL_MS;
}

function fresh(userId: string): boolean {
  return Boolean(cached && cached.userId === userId && Date.now() - cached.at < ttlFor(cached.value));
}

export function readCachedFirmEntitlement<T extends CachedFirmEntitlement>(
  userId: string,
  load: (input: { data: { refresh?: boolean } }) => Promise<T>,
  refresh = false,
): Promise<T> {
  if (!refresh && fresh(userId)) {
    return Promise.resolve(cached!.value as T);
  }
  if (!refresh && inflight && inflightUser === userId) return inflight as Promise<T>;
  const pending = load({ data: refresh ? { refresh: true } : {} }).then(
    (value) => {
      noteFirmEntitlement(userId, value);
      if (inflightUser === userId) {
        inflight = null;
        inflightUser = null;
      }
      return value;
    },
    (err: unknown) => {
      if (inflightUser === userId) {
        inflight = null;
        inflightUser = null;
      }
      throw err;
    },
  );
  inflightUser = userId;
  inflight = pending;
  return pending;
}

/** A refresh that learned the firm is paid replaces any unpaid tab result. */
export function noteFirmEntitlement(userId: string, value: CachedFirmEntitlement): void {
  if (!userId) return;
  cached = { at: Date.now(), userId, value };
}

export function clearCachedFirmEntitlement(): void {
  cached = null;
  inflight = null;
  inflightUser = null;
}
